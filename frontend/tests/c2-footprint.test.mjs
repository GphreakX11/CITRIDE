import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import { statewideFootprint } from "../src/statewideFootprint.ts";
import { incidentMarkerLayout } from "../src/incidentMarkerLayout.ts";
import { fittedTexasMarkerLayout } from "../src/fittedTexasMap.ts";
import { infrastructureKind } from "../src/infrastructureIcons.ts";
const read = (p) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const data = read("../../data/scenario.json");
const supplied = read("../../data/scripted/watershed_beta.json");
const reference = read("../../data/reference.json");
// Exercise the real engine, not an authored approximation of its output.
const run = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      "import sys,json; sys.path.insert(0,'backend'); from citride.engine import compute_run; d=json.load(open('data/scenario.json')); print(json.dumps(compute_run(d,{'scenarioId':'unsafe-water','evaluationHour':1,'horizonHours':12,'overrides':[]},'c2-captured-run')))",
    ],
    { cwd: new URL("../../", import.meta.url), encoding: "utf8" },
  ),
);
run.baselineSnapshot ??= structuredClone(data);
function props() {
  const records = structuredClone(supplied);
  records.statewideIncidents = records.incidents;
  records.responseTasks = records.tasks;
  records.storyNow = "2026-10-13T08:42:00Z";
  records.statewideIncidents[0].caseId = "case-a";
  records.statewideIncidents[0].status = "open";
  const selected = {
    id: "case-a",
    title: "Saved Watershed case",
    status: "open",
    priority: "high",
    createdAt: "2026-10-13T08:00:00Z",
    eventId: "event-dosing",
    eventSnapshot: data.events.find((e) => e.id === "event-dosing"),
    contextSnapshot: {
      provider: data.entities.find((e) => e.id === "utility-a"),
      serviceArea: data.entities.find((e) => e.id === "area-a"),
    },
    runId: run.id,
    runSnapshot: structuredClone(run),
    decisions: [],
    tasks: [],
    activity: [],
  };
  return {
    data: structuredClone(data),
    records,
    reference: structuredClone(reference),
    incidents: [selected],
    selected,
    onOpenAnalyst() {},
  };
}
function freeze(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g))
    imports.set(
      m[1],
      m[1].startsWith(".")
        ? /\.tsx$/.test(m[1])
          ? await compile(new URL(m[1], url))
          : new URL(m[1], url).href
        : import.meta.resolve(m[1]),
    );
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_m, s) => `from ${JSON.stringify(imports.get(s))}`,
  );
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, result);
  return result;
}
const { default: Component, StatewideFootprintView } = await import(
  await compile(new URL("../src/StatewideFootprint.tsx", import.meta.url))
);
const html = (p = props()) => renderToStaticMarkup(createElement(Component, p));
function elements(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...[node.props?.children]
      .flat(Infinity)
      .flatMap((c) => elements(c, predicate)),
  ];
}
test("C2 infrastructure icons match the list and retain complete accessible incident names", () => {
  const p = props();
  const model = statewideFootprint(p);
  const tree = StatewideFootprintView({
    model,
    onPick() {},
    onOpenAnalyst() {},
  });
  const pins = elements(tree, (e) => e.props?.["data-incident-pin"]);
  const nav = elements(
    tree,
    (e) => e.props?.["aria-label"] === "Statewide incidents",
  )[0];
  const buttons = elements(nav, (e) => e.type === "button");
  assert.equal(pins.length, model.rows.length);
  pins.forEach((pin, index) => {
    const item = model.rows[index];
    assert.match(pin.props["aria-label"], new RegExp(item.title));
    assert.ok(pin.props["aria-label"].includes(item.id));
    for (const target of [pin, buttons[index]]) {
      const marker = elements(
        target,
        (e) => typeof e.type === "function" && e.props?.kind,
      )[0];
      assert.equal(marker.props.kind, infrastructureKind(item));
    }
    assert.equal(pin.props["data-infrastructure-kind"], infrastructureKind(item));
    const marker = fittedTexasMarkerLayout(model.rows.map(row => ({ id: row.id, ...row.location.schematic })), 640, 448).markers[index];
    assert.equal(pin.props.style.left, `${marker.x}px`);
    assert.equal(pin.props.style.top, `${marker.y}px`);
    assert.equal(pin.props.style.transform, "translate(-50%, -50%)");
  });
  const rendered = html(p);
  assert.match(rendered, /data-infrastructure-icon="water"/);
  assert.match(rendered, /data-infrastructure-icon="health"/);
  assert.match(rendered, /data-infrastructure-icon="communications"/);
  assert.match(rendered, /data-infrastructure-icon="government"/);
  assert.doesNotMatch(rendered, /sf-pin-number|Illustrative positions|Not precise locations/);
});

test("shared overview map honors controlled register selection without adding a duplicate sidebar", () => {
  const p = props();
  const picked = p.records.statewideIncidents.find(row => !row.caseId && row.status !== "closed");
  assert.ok(picked);
  const out = html({ ...p, compact: true, activeOnly: true, pickedIncidentId: picked.id });
  assert.equal(out.match(/data-incident-pin="([^"]+)"[^>]*aria-pressed="true"/)?.[1], picked.id);
  assert.match(out, /sf-statewide sf-compact/);
  assert.match(out, /Active infrastructure incidents/);
  assert.doesNotMatch(out, /class="sf-summary"/);
  assert.match(out, /Recorded service footprints/);
});

test("C2 phone maps use fixed touch targets instead of clipping long absolute-positioned labels", () => {
  const css = readFileSync(
    new URL("../src/statewide-footprint.css", import.meta.url),
    "utf8",
  );
  const mobile = css.slice(css.indexOf("@media (max-width: 560px)"));
  assert.match(mobile, /\.sf-incident-pin\s*\{[^}]*width:\s*44px/);
  assert.match(mobile, /\.sf-incident-pin\s*\{[^}]*height:\s*44px/);
  assert.match(mobile, /\.sf-incident-pin\s*\{[^}]*min-width:\s*44px/);
  assert.match(
    mobile,
    /\.sf-incident-pin\s+\.sf-pin-label\s*\{\s*display:\s*none/,
  );
  assert.match(
    mobile,
    /\.sf-incident-pin\s+\.sf-pin-number[^}]*display:\s*inline-flex/,
  );
  assert.match(
    mobile,
    /\.sf-incident-nav\s+\.sf-pin-number[^}]*display:\s*inline-flex/,
  );
});

test("C2 desktop schematic uses non-overlapping compact targets and the vendored state boundary", () => {
  const css = readFileSync(
    new URL("../src/statewide-footprint.css", import.meta.url),
    "utf8",
  );
  const desktop = css.slice(0, css.indexOf("@media"));
  assert.match(desktop, /\.sf-incident-pin\s*\{[^}]*width:\s*44px/);
  assert.match(desktop, /\.sf-incident-pin\s*\{[^}]*height:\s*44px/);
  assert.match(
    desktop,
    /\.sf-incident-pin\s+\.sf-pin-label\s*\{\s*display:\s*none/,
  );
  assert.match(desktop, /\.sf-pin-number[^}]*display:\s*inline-flex/);
  const rendered = html();
  assert.match(rendered, /data-state-boundary="texas"/);
  assert.match(rendered, /PublicaMundi/);
  for (const incident of props().records.statewideIncidents)
    assert.ok(rendered.includes(incident.title));
});

test("C2 five incident markers keep authored anchors but avoid dense-label collisions at every viewport", () => {
  const points = statewideFootprint(props()).rows.map((r) => ({
    id: r.id,
    ...r.location.schematic,
  }));
  const before = JSON.stringify(points);
  for (const width of [216, 268, 650, 794]) {
    const placed = incidentMarkerLayout(points, width, 370);
    assert.equal(placed.length, 5);
    placed.forEach((p, i) => {
      assert.equal(p.sourceX, (points[i].x * width) / 100);
      assert.equal(p.sourceY, (points[i].y * 370) / 100);
      assert.ok(p.x >= 22 && p.x <= width - 22 && p.y >= 22 && p.y <= 348);
      for (const other of placed.slice(0, i))
        assert.ok(
          Math.abs(p.x - other.x) >= 44 || Math.abs(p.y - other.y) >= 44,
        );
    });
    assert.deepEqual(incidentMarkerLayout(points, width, 370), placed);
    assert.ok(placed.some((p) => p.offsetX || p.offsetY));
  }
  assert.equal(JSON.stringify(points), before);
});

test("C2 coincident and edge markers remain independently selectable without mutating recorded positions", () => {
  const points = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    x: 2,
    y: 2,
  }));
  const placed = incidentMarkerLayout(points, 216, 370);
  placed.forEach((p, i) => {
    assert.ok(p.x >= 22 && p.x <= 194 && p.y >= 22 && p.y <= 348);
    for (const other of placed.slice(0, i))
      assert.ok(Math.abs(p.x - other.x) >= 44 || Math.abs(p.y - other.y) >= 44);
  });
  assert.ok(points.every((p) => p.x === 2 && p.y === 2));
});

test("C2 real captured run has exactly three windows and excluded fire service", () => {
  const m = statewideFootprint(props());
  assert.equal(m.active.id, "TX-26-0412");
  assert.deepEqual(
    m.facilities.map((f) => [f.id, f.windowHours]),
    [
      ["nursing-z", [1, 4]],
      ["dialysis-x", [2, 4]],
      ["hospital-y", [4, 8]],
    ],
  );
  assert.ok(m.excluded.some((f) => f.id === "fire-f"));
  assert.equal(m.people, 18000);
  assert.equal(m.utility.status, "under-attack");
  assert.equal(m.utility.label, "Utility A");
  assert.deepEqual(
    m.probed.map((u) => u.label),
    ["Utility B", "Utility C"],
  );
  assert.deepEqual(
    m.probed.map((u) => [u.id, u.status]),
    [
      ["utility-b", "probed"],
      ["utility-c", "probed"],
    ],
  );
  assert.equal(m.probedPeople, 21000);
  assert.equal(m.rows.length, 5);
  assert.ok(m.boilWaterRule);
});
test("C2 positions and outline come from recorded schematic/geometry, never invented risk", () => {
  const p = props(),
    m = statewideFootprint(p);
  assert.deepEqual(m.active.location.schematic, { x: 52, y: 58 });
  assert.deepEqual(
    m.serviceAreas[0].geometry,
    p.data.entities.find((e) => e.id === "area-a").geometry,
  );
  assert.deepEqual(m.facilities[0].coordinates, [0.03, 0.075]);
});
test("C2 other-pin selection only changes panel; original footprint and all incident pins remain", () => {
  const p = props(),
    before = statewideFootprint(p),
    after = statewideFootprint(p, "TX-26-0409");
  assert.equal(after.active.id, "TX-26-0409");
  assert.equal(after.caseRecord, null);
  assert.deepEqual(after.rows, before.rows);
  assert.deepEqual(after.layers, before.layers);
  assert.equal(after.facilities.length, 0);
  assert.equal(after.boilWaterRule, null);
  assert.equal(after.rows.filter((r) => r.id !== after.active.id).length, 4);
});
test("C2 no captured run means not yet modeled and no potential-run windows", () => {
  const p = props();
  p.selected.runSnapshot = null;
  p.data.runs = [run];
  const m = statewideFootprint(p);
  assert.equal(m.run, null);
  assert.deepEqual(m.facilities, []);
  assert.equal(m.boilWaterRule, null);
  const rendered = html(p);
  assert.match(rendered, /Not yet modeled/);
  assert.doesNotMatch(rendered, /\d+–\d+ h/);
});
test("C2 immutable captured baseline wins over live labels, geometry, populations and scenario edits", () => {
  const p = props();
  p.data.entities.find((e) => e.id === "nursing-z").label = "LIVE REPAIR";
  p.data.entities.find((e) => e.id === "population-a").count = 999;
  const before = JSON.stringify(p);
  const m = statewideFootprint(freeze(p));
  assert.equal(m.facilities[0].label, "Nursing Home Z");
  assert.equal(m.people, 18000);
  assert.equal(JSON.stringify(p), before);
  const altered = props();
  altered.selected.runSnapshot.impacts.find(
    (i) => i.entityId === "nursing-z",
  ).windowHours = [7, 11];
  assert.deepEqual(
    statewideFootprint(altered).facilities.find((f) => f.id === "nursing-z")
      .windowHours,
    [7, 11],
  );
});
test("C2 explicit case association beats shared event and selected case wins default; null records safe", () => {
  const p = props(),
    other = { ...structuredClone(p.selected), id: "other-case" };
  p.incidents.unshift(other);
  assert.equal(statewideFootprint(p).caseRecord.id, "case-a");
  assert.equal(statewideFootprint({ ...p, records: null }).rows.length, 2);
  assert.equal(
    statewideFootprint({ ...p, records: null, incidents: [], selected: null })
      .active,
    null,
  );
});
test("C2 notice requires a matching complete reference predicate and captured run", () => {
  const p = props();
  p.reference.boilWaterRules[0].when.minPersistHours = 1000;
  assert.equal(statewideFootprint(p).boilWaterRule, null);
  p.reference.boilWaterRules[0].when = {
    seedLossType: "unsafe_water",
    providerType: "WaterServiceProvider",
    minPersistHours: 1,
    unknown: true,
  };
  assert.equal(statewideFootprint(p).boilWaterRule, null);
});
test("C2 SSR includes legend, summary, story elapsed, three windows, excluded fire, no editable controls", () => {
  const rendered = html(freeze(props()));
  for (const pattern of [
    /Attacked utility/,
    /Probed utility/,
    /Facility at risk \(modeled\)/,
    /aria-label="Infrastructure types"/,
    /18,000/,
    /21,000/,
    /1–4 h/,
    /2–4 h/,
    /4–8 h/,
    /Fire Service F/,
    /not affected/,
    /Open in Analyst/,
    /elapsed/,
    /decisions waiting/,
    /TX-26-0412/,
  ])
    assert.match(rendered, pattern);
  assert.doesNotMatch(rendered, /<(?:input|textarea|select|form)\b/i);
  assert.equal((rendered.match(/data-incident-pin=/g) || []).length, 5);
});
test("C2 navigation click callbacks pick another record and open exactly its Analyst context", () => {
  const p = props();
  let picked = null;
  const opens = [];
  let model = statewideFootprint(p);
  const view = () =>
    StatewideFootprintView({
      model,
      onPick: (id) => {
        picked = id;
        model = statewideFootprint(p, id);
      },
      onOpenAnalyst: (...args) => opens.push(args),
    });
  const pin = elements(
    view(),
    (e) => e.props?.["data-incident-pin"] === "TX-26-0409",
  )[0];
  pin.props.onClick();
  assert.equal(picked, "TX-26-0409");
  assert.match(renderToStaticMarkup(view()), /Ransomware on city network/);
  const open = elements(view(), (e) => e.props?.["data-open-analyst"])[0];
  open.props.onClick();
  assert.deepEqual(opens, [["cop", undefined, undefined]]);
  model = statewideFootprint(p);
  elements(view(), (e) => e.props?.["data-open-analyst"])[0].props.onClick();
  assert.deepEqual(opens[1], ["cop", "case-a", "utility-a"]);
});

test("C2 missing captured entities and geometry are not repaired from current inventory", () => {
  const p = props();
  p.selected.runSnapshot.baselineSnapshot.entities =
    p.selected.runSnapshot.baselineSnapshot.entities.filter(
      (e) => !["nursing-z", "area-a"].includes(e.id),
    );
  const m = statewideFootprint(freeze(p));
  assert.ok(!m.facilities.some((f) => f.id === "nursing-z"));
  assert.deepEqual(m.serviceAreas, []);
  const q = props();
  q.data.entities.find((e) => e.id === "nursing-z").geometry.coordinates = [
    999, 999,
  ];
  q.data.entities.find((e) => e.id === "area-a").geometry.coordinates = [
    [
      [8, 8],
      [9, 8],
      [9, 9],
      [8, 8],
    ],
  ];
  const n = statewideFootprint(q);
  assert.deepEqual(
    n.facilities.find((f) => f.id === "nursing-z").coordinates,
    [0.03, 0.075],
  );
  assert.deepEqual(
    n.serviceAreas[0].geometry,
    data.entities.find((e) => e.id === "area-a").geometry,
  );
});

test("C2 elapsed uses the story clock and waiting decisions honor recorded choices", () => {
  const p = props();
  p.records.statewideIncidents[0].startedAt = "2026-10-13T08:00:00Z";
  assert.equal(statewideFootprint(p).elapsed, 42);
  const before = statewideFootprint(p).decisionsWaiting;
  assert.ok(before > 0);
  const option = p.reference.responseOptions.find((o) =>
    o.triggers.impactFunctions.includes("nursing-safe-water"),
  );
  p.records.decisions.push({
    id: "choice",
    caseId: "case-a",
    optionId: option.id,
    decision: "approved",
  });
  assert.equal(statewideFootprint(p).decisionsWaiting, before - 1);
  p.records.statewideIncidents[0].closedAt = "2026-10-13T08:10:00Z";
  assert.equal(statewideFootprint(p).elapsed, 10);
});
test("C2 keeps captured geometry and full incident narrative behind closed disclosures", () => {
  const p = freeze(props());
  const before = JSON.stringify(p);
  const out = html(p);
  assert.match(out, /<details class="sf-recorded-footprints" aria-label="Captured service footprints"><summary>Recorded service footprints/);
  assert.match(out, /<details class="sf-incident-detail"><summary>Recorded incident detail<\/summary>/);
  assert.match(out, /data-state-boundary="texas"/);
  assert.equal((out.match(/data-incident-pin=/g) ?? []).length, 5);
  assert.match(out, /data-modeled-facility="nursing-z"/);
  assert.match(out, /data-service-area="area-a"/);
  assert.equal(JSON.stringify(p), before);
});
