import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import {
  infrastructureKind,
  infrastructureLabel,
} from "../src/infrastructureIcons.ts";
import {
  graphEdges,
  infrastructureIds,
  mapPositions,
} from "../src/texasGraph.ts";
import { serviceConnections } from "../src/relationshipStory.ts";
import { utilityMapStatus } from "../src/whoActsFirst.ts";
import { texasContainsMarker } from "../src/texasMapLayout.ts";

const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const hooks = `data:text/javascript,${encodeURIComponent('export const useEffect=f=>globalThis.__analystInfrastructureEffects?.push(f);export const useId=()=>"icons";export const useMemo=f=>f();export const useRef=value=>({current:value});')}`;
const cache = new Map();
async function compile(url, harness = false) {
  const key = `${url.href}:${harness}`;
  if (cache.has(key)) return cache.get(key);
  let { code } = await transformWithOxc(
    readFileSync(url, "utf8"),
    url.pathname,
    { jsx: { runtime: "automatic" } },
  );
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    let target = specifier.startsWith(".") ? new URL(specifier, url) : null;
    if (target && !/\.[a-z]+$/i.test(target.pathname)) {
      target = new URL(`${specifier}.ts`, url);
      try {
        readFileSync(target);
      } catch {
        target = new URL(`${specifier}.tsx`, url);
      }
    }
    imports.set(
      specifier,
      harness && specifier === "react"
        ? hooks
        : target?.pathname.endsWith(".tsx")
          ? await compile(target, harness)
          : (target?.href ?? import.meta.resolve(specifier)),
    );
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_, specifier) => `from ${JSON.stringify(imports.get(specifier))}`,
  );
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(key, result);
  return result;
}
const source = new URL("../src/TexasInfrastructureMap.tsx", import.meta.url);
const { default: MapComponent, infrastructureSymbolPositions } = await import(await compile(source));
test("Analyst sector glyphs stay separate at the maximum responsive marker scale without moving source anchors", () => {
  const ids = new Set(infrastructureIds(data));
  const original = new Map([...mapPositions(data.entities)].filter(([id]) => ids.has(id)));
  const before = structuredClone([...original]);
  const symbols = infrastructureSymbolPositions(original);
  assert.deepEqual([...original], before);
  assert.deepEqual([...symbols.keys()].sort(), [...original.keys()].sort());
  const points = [...symbols.values()];
  for (const point of points) assert.ok(texasContainsMarker(point, 1000, 700, 72), "full responsive glyph footprint stays inside Texas");
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    assert.ok(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) >= 75.9, "responsive glyph circles must not overlap");
  }
  assert.deepEqual([...infrastructureSymbolPositions(original)], [...symbols]);
});
test("optional dense ownership/cyber symbols remain separate, inside Texas and source-preserving", () => {
  const source = mapPositions(data.entities);
  const before = structuredClone([...source]);
  const symbols = infrastructureSymbolPositions(source);
  assert.equal(symbols.size, source.size);
  assert.deepEqual([...source], before);
  const points = [...symbols.values()];
  for (const p of points) assert.ok(texasContainsMarker(p, 1000, 700, 36));
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) assert.ok(Math.hypot(points[i].x-points[j].x, points[i].y-points[j].y) >= 39.9);
});
const CallbackMap = (await import(await compile(source, true))).default;
const view = {
  areaId: "all",
  query: "",
  focusOnly: false,
  structural: false,
  zoom: 1,
  center: { x: 480, y: 360 },
  direction: "all",
};
const incident = {
  id: "icon-case",
  status: "open",
  contextSnapshot: { provider: { id: "utility-a" } },
  eventSnapshot: data.events.find((event) => event.id === "event-dosing"),
  eventId: "event-dosing",
};
const props = (overrides = {}) => ({
  data,
  incidents: [incident],
  selectedId: null,
  onSelectEntity() {},
  onOpenEntity() {},
  onMapStateChange() {},
  mapState: { ...view },
  ...overrides,
});
const elements = (node) =>
  Array.isArray(node)
    ? node.flatMap(elements)
    : isValidElement(node)
      ? [node, ...elements(node.props.children)]
      : [];
const nodes = (tree) =>
  elements(tree).filter((node) => node.props["data-node-id"]);
const markup = (node) => renderToStaticMarkup(createElement("svg", null, node));
const legendKinds = (tree) => {
  const legend = elements(tree).find(
    (node) => node.props["aria-label"] === "Visible infrastructure types",
  );
  assert.ok(legend, "visible infrastructure legend is separately labelled");
  return elements(legend)
    .filter((node) => node.props["data-infrastructure-kind"])
    .map((node) => node.props["data-infrastructure-kind"]);
};
function assertLegendMatches(tree) {
  assert.deepEqual(
    legendKinds(tree).sort(),
    [
      ...new Set(
        nodes(tree).map((node) => node.props["data-infrastructure-kind"]),
      ),
    ].sort(),
  );
}

test("every actual Analyst node uses the shared kind and SVG pictogram without moving source positions", () => {
  const before = structuredClone(data);
  const tree = CallbackMap(props());
  const positions = mapPositions(data.entities);
  assert.deepEqual(
    nodes(tree).map((node) => node.props["data-node-id"]),
    infrastructureIds(data),
  );
  for (const node of nodes(tree)) {
    const entity = data.entities.find(
      (item) => item.id === node.props["data-node-id"],
    );
    const kind = infrastructureKind(entity);
    assert.equal(node.props["data-infrastructure-kind"], kind, entity.id);
    const html = markup(node);
    assert.match(html, new RegExp(`data-infrastructure-icon="${kind}"`));
    assert.match(html, /aria-hidden="true"/);
    const target = elements(node).find(
      (item) => item.props.className === "texas-node-target",
    );
    assert.equal(target.props.cx, positions.get(entity.id).x);
    assert.equal(target.props.cy, positions.get(entity.id).y);
    assert.equal(node.props.role, "button");
    assert.equal(node.props.tabIndex, 0);
    assert.match(html, /class="texas-node-label"/);
    assert.match(html, /<title>/);
  }
  const html = renderToStaticMarkup(createElement(MapComponent, props()));
  assert.match(html, /data-infrastructure-icon="water"/);
  assert.match(html, /data-infrastructure-icon="power"/);
  assert.match(html, /data-infrastructure-icon="health"/);
  assertLegendMatches(tree);
  assert.deepEqual(data, before);
});

test("all shared infrastructure kinds render representative icons and matching legend labels", () => {
  const subjects = {
    water: "Water treatment",
    power: "Electric substation",
    health: "Hospital",
    government: "County courthouse",
    cyber: "Cyber security",
    communications: "Radio tower",
    transport: "Railway",
    industry: "Manufacturing",
    gas: "Natural gas",
    facility: "Unclassified building",
  };
  const fixtures = Object.entries(subjects).map(([kind, label]) => ({
    id: `icon-${kind}`,
    type: "Facility",
    label: `Icon fixture ${label}`,
  }));
  const input = { ...data, entities: [...data.entities, ...fixtures] };
  const inputProps = props({
    data: input,
    mapState: { ...view, query: "Icon fixture" },
  });
  const tree = CallbackMap(inputProps);
  assert.equal(nodes(tree).length, fixtures.length);
  const html = renderToStaticMarkup(createElement(MapComponent, inputProps));
  for (const kind of Object.keys(subjects)) {
    const node = nodes(tree).find(
      (item) => item.props["data-node-id"] === `icon-${kind}`,
    );
    assert.equal(node.props["data-infrastructure-kind"], kind);
    assert.match(
      markup(node),
      new RegExp(`data-infrastructure-icon="${kind}"`),
    );
    assert.ok(html.includes(infrastructureLabel(kind)));
  }
  assertLegendMatches(tree);
  assert.match(html, /Service dependency →/);
  assert.match(html, /Structure \/ ownership/);
});

test("visible-kind legend follows search, service-area, and directional dependency filters", () => {
  for (const mapState of [
    { ...view, query: "Hospital" },
    { ...view, areaId: "area-a" },
    { ...view, query: "not-an-infrastructure-match" },
  ])
    assertLegendMatches(CallbackMap(props({ mapState })));
  const searched = CallbackMap(
    props({ mapState: { ...view, query: "Hospital" } }),
  );
  assert.deepEqual(legendKinds(searched), ["health"]);
  for (const direction of ["suppliers", "dependents"]) {
    const mapState = { ...view, direction };
    const tree = CallbackMap(props({ selectedId: "utility-a", mapState }));
    assertLegendMatches(tree);
    const expected = serviceConnections(
      graphEdges(data),
      "utility-a",
      direction,
    ).map((edge) => edge.id);
    const drawn = elements(tree)
      .filter((node) => node.props["data-edge-id"])
      .map((node) => node.props["data-edge-id"]);
    assert.deepEqual(drawn, expected);
  }
});

test("icon nodes retain selection, keyboard, evidence status, zoom, pan and search controls", () => {
  const selected = [],
    changed = [];
  const previousWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  try {
    const tree = CallbackMap(
      props({
        selectedId: "utility-a",
        onSelectEntity: (id) => selected.push(id),
        onMapStateChange: (state) => changed.push(state),
      }),
    );
    const all = elements(tree);
    for (const id of ["utility-a", "utility-b", "utility-c"]) {
      const node = nodes(tree).find(
        (item) => item.props["data-node-id"] === id,
      );
      assert.equal(
        node.props["data-utility-status"],
        utilityMapStatus(id, data, [incident]).status,
      );
      assert.equal(node.props["data-infrastructure-kind"], "water");
      assert.equal(node.props["aria-pressed"], id === "utility-a");
      assert.match(markup(node), /data-infrastructure-icon="water"/);
      assert.match(
        markup(node),
        id === "utility-a" ? /Under attack/ : /Probed/,
      );
    }
    const hospital = nodes(tree).find(
      (node) => node.props["data-node-id"] === "hospital-y",
    );
    hospital.props.onClick();
    for (const key of ["Enter", " "]) {
      let prevented = false;
      hospital.props.onKeyDown({
        key,
        preventDefault() {
          prevented = true;
        },
      });
      assert.ok(prevented);
    }
    assert.deepEqual(selected, ["hospital-y", "hospital-y", "hospital-y"]);
    all
      .find((node) => node.props["aria-label"] === "Zoom in map")
      .props.onClick();
    assert.equal(changed.at(-1).zoom, 1.5);
    all
      .find((node) => node.props["aria-label"] === "Find infrastructure entity")
      .props.onChange({ target: { value: "power" } });
    assert.equal(changed.at(-1).query, "power");
    assert.equal(selected.at(-1), null);
    all
      .find((node) => node.props["aria-label"] === "Service area filter")
      .props.onChange({ target: { value: "area-b" } });
    assert.equal(changed.at(-1).areaId, "area-b");
    const zoomed = CallbackMap(
      props({
        mapState: { ...view, zoom: 2 },
        onMapStateChange: (state) => changed.push(state),
      }),
    );
    const svg = elements(zoomed).find(
      (node) => node.props.className === "texas-map",
    );
    assert.equal(svg.props.viewBox, "240 180 480 360");
    const currentTarget = {
      getBoundingClientRect: () => ({ width: 480 }),
      setPointerCapture() {},
      hasPointerCapture: () => true,
      releasePointerCapture() {},
    };
    svg.props.onPointerDown({
      target: { closest: () => null },
      currentTarget,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    svg.props.onPointerMove({ clientX: 120, clientY: 110 });
    assert.deepEqual(changed.at(-1).center, { x: 460, y: 350 });
    svg.props.onPointerUp({ currentTarget, pointerId: 1 });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("Analyst marker styling consumes shared palette and keeps pictogram geometry unfilled", () => {
  const css = readFileSync(
    new URL("../src/texas-map.css", import.meta.url),
    "utf8",
  );
  const component = readFileSync(source, "utf8");
  assert.match(component, /import "\.\/infrastructure-map\.css"/);
  assert.doesNotMatch(component, /const typeColor/);
  assert.match(css, /var\(--infrastructure-(?:accent|color)/);
  assert.match(
    css,
    /\.texas-node[^{}]*\.infrastructure-icon\s+:is\(path, circle, line, polyline, polygon, rect\)\s*\{[^}]*fill:\s*none;[^}]*stroke:\s*currentColor;/,
  );
  assert.match(
    css,
    /\.texas-node-symbol\s*\{[^}]*scale\(var\(--texas-marker-scale/,
  );
  assert.match(component, /ResizeObserver/);
});

test("marker compensation follows mobile/desktop viewport and zoom, with observer cleanup", () => {
  const previousObserver = globalThis.ResizeObserver;
  const previousEffects = globalThis.__analystInfrastructureEffects;
  const observed = [],
    scales = [];
  let resized,
    disconnected = 0;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resized = callback;
    }
    observe(map) {
      observed.push(map);
    }
    disconnect() {
      disconnected++;
    }
  };
  let width = 360;
  const map = {
    getBoundingClientRect: () => ({
      width,
      height: Math.max(330, width * 0.75),
    }),
    style: {
      setProperty(name, value) {
        assert.equal(name, "--texas-marker-scale");
        scales.push(Number(value));
      },
    },
  };
  try {
    for (const zoom of [1, 2, 3]) {
      globalThis.__analystInfrastructureEffects = [];
      const tree = CallbackMap(props({ mapState: { ...view, zoom } }));
      const svg = elements(tree).find(
        (node) => node.props.className === "texas-map",
      );
      svg.props.ref.current = map;
      const cleanup = globalThis.__analystInfrastructureEffects[1]();
      assert.equal(observed.at(-1), map);
      for (width of [320, 375, 760, 1200]) {
        resized();
        const scale = scales.at(-1);
        assert.ok(scale >= 1 && scale <= 1.8);
        const glyphPixels = 26 * scale * (width / 960) * zoom;
        assert.ok(
          glyphPixels >= 15,
          `${width}px viewport at ${zoom}× retains readable glyph geometry`,
        );
      }
      cleanup();
    }
    assert.equal(disconnected, 3);
    globalThis.ResizeObserver = undefined;
    globalThis.__analystInfrastructureEffects = [];
    const tree = CallbackMap(props());
    elements(tree).find(
      (node) => node.props.className === "texas-map",
    ).props.ref.current = map;
    assert.doesNotThrow(() => globalThis.__analystInfrastructureEffects[1]());
  } finally {
    if (previousObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousObserver;
    if (previousEffects === undefined)
      delete globalThis.__analystInfrastructureEffects;
    else globalThis.__analystInfrastructureEffects = previousEffects;
  }
});
