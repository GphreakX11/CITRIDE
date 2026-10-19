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
import { texasContainsMarker, TexasMarkerCapacityError } from "../src/texasMapLayout.ts";

const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const hooks = `data:text/javascript,${encodeURIComponent('export const useEffect=(f,deps)=>{globalThis.__analystInfrastructureEffects?.push(f);globalThis.__analystInfrastructureEffectDeps?.push(deps);};export const useId=()=>"icons";export const useMemo=f=>f();export const useRef=value=>({current:value});')}`;
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

const largeData = {
  ...data,
  entities: Array.from({ length: 328 }, (_, index) => ({
    id: `large-facility-${index}`,
    type: "Facility",
    label: `Large incident facility ${index}`,
    geometry: { type: "Point", coordinates: [-97.7, 30.3] },
    provenance: "synthetic_schematic",
  })),
  dependencies: [],
};

test("328-marker geometry retains its capacity guard rather than overlapping or inventing positions", () => {
  const source = mapPositions(largeData.entities);
  const before = structuredClone([...source]);
  assert.equal(source.size, 328);
  assert.throws(() => infrastructureSymbolPositions(source), (error) => {
    assert.ok(error instanceof TexasMarkerCapacityError);
    assert.equal(error.requested, 328);
    assert.equal(error.capacity, 111);
    return true;
  });
  assert.deepEqual([...source], before);
});

test("328-entity Analyst layer renders an honest complete list instead of crashing or partial map positions", () => {
  const before = structuredClone(largeData);
  const input = props({ data: largeData });
  const html = renderToStaticMarkup(createElement(MapComponent, input));
  assert.match(html, /328 entities shown as a list/);
  assert.match(html, /111 safely spaced markers/);
  assert.match(html, /No map positions or relationship lines are drawn/);
  assert.match(html, /Filter by name or service area/);
  assert.doesNotMatch(html, /data-node-id=|data-edge-id=/);
  assert.doesNotMatch(html, /aria-label="Zoom in map"/);
  const tree = CallbackMap(input);
  const list = elements(tree).find(node => node.props["aria-label"] === "Infrastructure entities list");
  assert.ok(list, "keyboard-accessible, labelled internal scroll region");
  assert.equal(list.props.tabIndex, 0);
  const rows = elements(list).filter(node => node.type === "li");
  assert.equal(rows.length, 328, "no truncation or hidden subset");
  assert.deepEqual(
    elements(list).filter(node => node.props["data-entity-profile"]).map(node => node.props["data-entity-profile"]),
    largeData.entities.map(entity => entity.id),
  );
  assert.deepEqual(largeData, before);
});

test("large-map fallback retains exact profile and connection callbacks and recovers the map when filtered", () => {
  const selected = [], opened = [], changed = [];
  const previousWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  try {
    const tree = CallbackMap(props({
      data: largeData,
      selectedId: "large-facility-327",
      onSelectEntity: id => selected.push(id),
      onOpenEntityProfile: id => opened.push(id),
      onOpenEntity: () => assert.fail("profile must not use legacy callback"),
      onMapStateChange: state => changed.push(state),
    }));
    const all = elements(tree);
    for (const entity of largeData.entities) {
      const button = all.find(node => node.props["aria-label"] === `Show connections for ${entity.label}`);
      assert.equal(button.type, "button");
      assert.equal(button.props["aria-pressed"], entity.id === "large-facility-327");
      button.props.onClick();
      assert.equal(selected.at(-1), entity.id);
      const profile = all.find(node => node.props["data-entity-profile"] === entity.id);
      profile.props.onClick();
      assert.equal(opened.at(-1), entity.id);
    }
    all.find(node => node.props["aria-label"] === "Find infrastructure entity").props.onChange({ target: { value: "facility 327" } });
    assert.equal(changed.at(-1).query, "facility 327");
    const filtered = CallbackMap(props({ data: largeData, mapState: changed.at(-1) }));
    assert.deepEqual(nodes(filtered).map(node => node.props["data-node-id"]), ["large-facility-327"]);
    assert.ok(!elements(filtered).some(node => node.props.className === "texas-capacity-fallback"));
    assert.ok(elements(filtered).some(node => node.props["aria-label"] === "Zoom in map"));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("list-to-map recovery reattaches marker sizing at unchanged zoom", () => {
  const previousEffects = globalThis.__analystInfrastructureEffects;
  const previousDeps = globalThis.__analystInfrastructureEffectDeps;
  const previousObserver = globalThis.ResizeObserver;
  const observed = [], scales = [];
  let disconnected = false;
  globalThis.ResizeObserver = class {
    observe(map) { observed.push(map); }
    disconnect() { disconnected = true; }
  };
  try {
    globalThis.__analystInfrastructureEffects = [];
    globalThis.__analystInfrastructureEffectDeps = [];
    CallbackMap(props({ data: largeData }));
    const listDeps = globalThis.__analystInfrastructureEffectDeps[1];
    assert.equal(globalThis.__analystInfrastructureEffects[1](), undefined);
    globalThis.__analystInfrastructureEffects = [];
    globalThis.__analystInfrastructureEffectDeps = [];
    const tree = CallbackMap(props({ data: largeData, mapState: { ...view, query: "facility 327" } }));
    const mapDeps = globalThis.__analystInfrastructureEffectDeps[1];
    assert.equal(listDeps[0], mapDeps[0], "zoom unchanged");
    assert.notDeepEqual(listDeps, mapDeps, "mounting a map must rerun the effect");
    const map = {
      getBoundingClientRect: () => ({ width: 320, height: 330 }),
      style: { setProperty: (name, value) => scales.push([name, value]) },
    };
    elements(tree).find(node => node.props.className === "texas-map").props.ref.current = map;
    const cleanup = globalThis.__analystInfrastructureEffects[1]();
    assert.deepEqual(observed, [map]);
    assert.equal(scales[0][0], "--texas-marker-scale");
    cleanup();
    assert.ok(disconnected);
  } finally {
    if (previousEffects === undefined) delete globalThis.__analystInfrastructureEffects;
    else globalThis.__analystInfrastructureEffects = previousEffects;
    if (previousDeps === undefined) delete globalThis.__analystInfrastructureEffectDeps;
    else globalThis.__analystInfrastructureEffectDeps = previousDeps;
    if (previousObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousObserver;
  }
});

test("capacity list is bounded and wraps long content rather than widening the page", () => {
  const css = readFileSync(new URL("../src/texas-map.css", import.meta.url), "utf8");
  assert.match(css, /\.texas-capacity-fallback\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(css, /\.texas-capacity-list\s*\{[^}]*max-height:\s*[^;]+;[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/);
  assert.match(css, /\.texas-capacity-list button\s*\{[^}]*white-space:\s*normal;/);
});

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
