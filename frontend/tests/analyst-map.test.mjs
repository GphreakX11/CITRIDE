import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import * as evidence from "../src/whoActsFirst.ts";
import { relationshipStory } from "../src/relationshipStory.ts";
import { graphEdges } from "../src/texasGraph.ts";
const data = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);
const freeze = (x) => {
  if (x && typeof x === "object") {
    Object.values(x).forEach(freeze);
    Object.freeze(x);
  }
  return x;
};
const incident = (utilityId = "utility-a", status = "open") => ({
  id: `${utilityId}-${status}`,
  status,
  contextSnapshot: { provider: { id: utilityId } },
  eventSnapshot: data.events.find((e) => e.id === "event-dosing"),
  eventId: "event-dosing",
});
const hookUrl = `data:text/javascript,${encodeURIComponent('export const useEffect=()=>{};export const useId=()=>"test";export const useMemo=f=>f();export const useRef=()=>({current:null});')}`;
async function compile(url, harness = false) {
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const s = m[1];
    let target = s.startsWith(".") ? new URL(s, url) : null;
    if (target && !/\.[a-z]+$/i.test(target.pathname)) {
      target = new URL(s + ".ts", url);
      try {
        readFileSync(target);
      } catch {
        target = new URL(s + ".tsx", url);
      }
    }
    imports.set(
      s,
      harness && s === "react"
        ? hookUrl
        : target?.pathname.endsWith(".tsx")
          ? await compile(target, harness)
          : (target?.href ?? import.meta.resolve(s)),
    );
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_, s) => `from ${JSON.stringify(imports.get(s))}`,
  );
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const url = new URL("../src/TexasInfrastructureMap.tsx", import.meta.url);
const MapComponent = (await import(await compile(url))).default;
const CallbackMap = (await import(await compile(url, true))).default;
const props = (overrides = {}) => ({
  data,
  incidents: [incident()],
  selectedId: "utility-a",
  onSelectEntity() {},
  onOpenEntity() {},
  onOpenEntityProfile() {},
  mapState: {
    areaId: "all",
    query: "",
    focusOnly: false,
    structural: false,
    zoom: 1,
    center: { x: 480, y: 360 },
    direction: "all",
  },
  onMapStateChange() {},
  ...overrides,
});
const elements = (n) =>
  Array.isArray(n)
    ? n.flatMap(elements)
    : isValidElement(n)
      ? [n, ...elements(n.props.children)]
      : [];
const text = (n) =>
  Array.isArray(n)
    ? n.map(text).join("")
    : isValidElement(n)
      ? text(n.props.children)
      : typeof n === "string" || typeof n === "number"
        ? String(n)
        : "";

test("exported evidence classification preserves A5 status and rejects geography as attribution", () => {
  assert.equal(typeof evidence.utilityEvidenceStatus, "function");
  assert.equal(
    evidence.utilityEvidenceStatus("utility-a", data),
    "effect_observed",
  );
  for (const id of ["utility-b", "utility-c"])
    assert.equal(evidence.utilityEvidenceStatus(id, data), "probing_only");
  assert.equal(evidence.utilityEvidenceStatus("unrelated", data), "none");
  const suspect = structuredClone(data);
  suspect.scenarios = [];
  assert.equal(
    evidence.utilityEvidenceStatus("utility-a", suspect),
    "compromise_suspected",
  );
  const geo = structuredClone(data);
  geo.events = [
    { id: "geo", seenOn: "facility-q", observation: "dosing_parameter_change" },
  ];
  geo.scenarios = [];
  assert.equal(evidence.utilityEvidenceStatus("utility-a", geo), "none");
});
test("effect and suspected compromise need open or monitoring cases; probes never become compromise", () => {
  assert.equal(typeof evidence.utilityMapStatus, "function");
  for (const input of [data, { ...data, scenarios: [] }]) {
    for (const status of ["open", "monitoring"])
      assert.equal(
        evidence.utilityMapStatus("utility-a", input, [
          incident("utility-a", status),
        ]).label,
        "Under attack",
      );
    for (const cases of [
      [],
      [incident("utility-a", "closed")],
      [incident("utility-b")],
    ])
      assert.equal(
        evidence.utilityMapStatus("utility-a", input, cases).label,
        null,
      );
  }
  for (const id of ["utility-b", "utility-c"])
    for (const cases of [[], [incident(id)], [incident(id, "closed")]])
      assert.equal(evidence.utilityMapStatus(id, data, cases).label, "Probed");
  assert.equal(
    evidence.utilityMapStatus("unrelated", data, [incident()]).label,
    null,
  );
  const probing = structuredClone(data);
  probing.events = probing.events.filter(
    (e) => e.observation === "probing_only",
  );
  assert.equal(
    evidence.utilityMapStatus("utility-a", probing, [incident()]).label,
    null,
  );
  const frozen = freeze(structuredClone(data));
  const cases = freeze([
    incident(),
    incident("utility-a", "monitoring"),
    incident("utility-a", "closed"),
  ]);
  assert.equal(
    evidence.utilityMapStatus("utility-a", frozen, cases).openCaseCount,
    2,
  );
  assert.deepEqual(frozen, data);
});
test("A/Q/Fire service summaries are derived, bounded upstream and retain raw advanced counts", () => {
  const edges = graphEdges(data);
  const story = relationshipStory(
    edges,
    "utility-a",
    data.entities,
    data.serviceFunctions,
  );
  assert.equal(
    story.summary,
    "Utility A supplies treated water to 4 facilities: Dialysis Center X, Hospital Y, Nursing Home Z and Fire Service F. It gets treated water from Treatment Plant A, which runs on power from Electric Supply E.",
  );
  assert.match(story.advancedSummary, /1 recorded direct supplier/);
  assert.match(story.advancedSummary, /directly supports 4 entities/);
  assert.equal(
    relationshipStory(edges, "facility-q", data.entities, data.serviceFunctions)
      .summary,
    "Facility Q is inside Service Area A, but no service dependency is recorded.",
  );
  assert.match(
    relationshipStory(edges, "fire-f", data.entities, data.serviceFunctions)
      .summary,
    /needs water pressure; unsafe water alone does not affect fire flow/,
  );
  assert.equal(story.dependentRows.length, 4);
  assert.equal(
    story.dependentRows[0].summary,
    "Dialysis Center X · dialysis treatment · about 2 h of clean-water reserve",
  );
  assert.match(
    story.dependentRows.find((r) => r.entityId === "fire-f").summary,
    /needs water pressure; unsafe water alone does not affect fire flow/,
  );
  const alternate = structuredClone(data);
  alternate.entities.forEach((e) => (e.label = "Alternate " + e.label));
  alternate.serviceFunctions.find((f) => f.id === "dialysis-treatment").label =
    "Custom treatment";
  const before = structuredClone(alternate);
  freeze(alternate);
  const alt = relationshipStory(
    graphEdges(alternate),
    "utility-a",
    alternate.entities,
    alternate.serviceFunctions,
  );
  assert.match(alt.summary, /Alternate Utility A supplies/);
  assert.match(alt.summary, /Alternate Electric Supply E/);
  assert.match(alt.dependentRows[0].summary, /custom treatment/);
  assert.deepEqual(alternate, before);
  const changed = structuredClone(data);
  changed.dependencies
    .find((d) => d.id === "dep-a-f")
    .lossTypes.push("unsafe_water");
  assert.doesNotMatch(
    relationshipStory(
      graphEdges(changed),
      "fire-f",
      changed.entities,
      changed.serviceFunctions,
    ).summary,
    /unsafe water alone does not affect/,
  );
});
test("map renders status legend, matching area chips and singular active-case count with record details in Advanced", () => {
  const html = renderToStaticMarkup(createElement(MapComponent, props()));
  assert.match(html, /Under attack/);
  assert.match(html, /Probed/);
  assert.match(html, /1 case\b/);
  assert.doesNotMatch(html, /1 cases/);
  assert.match(html, /Advanced · IDs and raw links/);
  assert.match(html, /1 recorded direct supplier/);
  assert.match(html, /data-utility-status="under-attack"/);
  assert.match(html, /data-utility-status="probed"/);
  assert.match(html, /unsafe water alone does not affect fire flow/);
  assert.match(html, /data-service-area="area-a"/);
  const closed = renderToStaticMarkup(
    createElement(
      MapComponent,
      props({ incidents: [incident("utility-a", "closed")] }),
    ),
  );
  assert.doesNotMatch(
    closed,
    /data-node-id="utility-a"[^>]*data-utility-status="under-attack"/,
  );
});
test("every service-area named record and selected profile button calls exact entity profile callback; chain still explores", () => {
  const opened = [];
  const selected = [];
  const tree = CallbackMap(
    props({
      onOpenEntityProfile: (id) => opened.push(id),
      onSelectEntity: (id) => selected.push(id),
      onOpenEntity: () =>
        assert.fail("legacy graph callback must not override profile"),
    }),
  );
  const all = elements(tree);
  const profile = all.find(
    (e) => e.type === "button" && text(e) === "Open entity profile",
  );
  assert.ok(profile);
  profile.props.onClick();
  assert.deepEqual(opened, ["utility-a"]);
  const area = all.find((e) => e.props["data-service-area"] === "area-a");
  assert.ok(area);
  for (const id of [
    "area-a",
    "utility-a",
    "dialysis-x",
    "hospital-y",
    "nursing-z",
    "fire-f",
    "facility-q",
    "plc-a",
    "cyber-plc-a",
  ]) {
    const b = elements(area).find(
      (e) => e.type === "button" && e.props["data-entity-profile"] === id,
    );
    assert.ok(b, id);
    b.props.onClick();
    assert.equal(opened.at(-1), id);
  }
  const advanced = all.find(
    (e) =>
      e.type === "details" &&
      text(e).startsWith("Advanced · IDs and raw links"),
  );
  assert.match(text(advanced), /Applies to recorded loss types/);
  assert.match(text(advanced), /Usable backup/);
  assert.match(text(advanced), /Evidence:/);
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const chain = all.find(
    (e) => e.type === "button" && e.props.className === "texas-neighbor",
  );
  chain.props.onClick();
  assert.equal(selected.at(-1), "plant-a");
});
