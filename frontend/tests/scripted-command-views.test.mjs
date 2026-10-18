import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = read("../../data/scenario.json");
const supplied = read("../../data/scripted/watershed_beta.json");
const reference = read("../../data/reference.json");
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    imports.set(
      spec,
      spec.startsWith(".") && /\.tsx$/.test(spec)
        ? await compile(new URL(spec, url))
        : spec.startsWith(".")
          ? new URL(/\.[cm]?[jt]s$/.test(spec) ? spec : `${spec}.ts`, url).href
          : import.meta.resolve(spec),
    );
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_m, spec) => `from ${JSON.stringify(imports.get(spec))}`,
  );
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, result);
  return result;
}
const Component = (
  await import(
    await compile(new URL("../src/ScriptedCommandViews.tsx", import.meta.url))
  )
).default;
const model = await import("../src/scriptedCommandModel.ts");
const Integrated = (
  await import(
    await compile(new URL("../src/CommandCenterViews.tsx", import.meta.url))
  )
).default;
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
function records(open = true) {
  const r = structuredClone(supplied);
  r.statewideIncidents = r.incidents.filter(
    (i) => open || i.status !== "from_case",
  );
  r.responseTasks = r.tasks;
  r.now = "2026-10-13T08:30:00Z";
  if (open) {
    r.statewideIncidents[0].caseId = "saved-a";
    r.statewideIncidents[0].status = "open";
  }
  return r;
}
function saved() {
  return {
    id: "saved-a",
    version: 1,
    title: "Live authored case",
    status: "open",
    priority: "high",
    createdAt: "2026-10-13T08:00:00Z",
    updatedAt: "2026-10-13T08:10:00Z",
    eventId: data.events[0].id,
    eventSnapshot: data.events[0],
    contextSnapshot: {
      event: data.events[0],
      provider: data.entities.find((e) => e.id === "utility-a"),
      serviceArea: data.entities.find((e) => e.id === "area-a"),
      warnings: [],
      sourceRefs: [],
      downstreamDependencies: [],
    },
    tasks: [],
    decisions: [],
    notes: [],
    activity: [
      {
        id: "act",
        kind: "note",
        message: "Actual analyst update",
        createdAt: "2026-10-13T08:10:00Z",
      },
    ],
    runSnapshot: null,
    runId: null,
  };
}
const render = (view, r = records(), s = saved(), ref = reference, d = data) =>
  renderToStaticMarkup(
    createElement(Component, {
      data: d,
      incidents: s ? [s] : [],
      selected: s,
      records: r,
      reference: ref,
      view,
      onSelect() {},
      onOpenAnalyst() {},
      onNavigate() {},
    }),
  );
test('C2 replaces the statewide register with a selected incident schematic and read-only searches',()=>{
 const html=render('cop');
 assert.match(html,/data-incident-schematic/);
 assert.match(html,/What it touches/);
 assert.match(html,/Facilities/);
 assert.match(html,/Source/);
 assert.match(html,/sf-recorded-footprints/);
 assert.doesNotMatch(html,/All Statewide Incidents|TX-26-0398/);
 assert.doesNotMatch(html,/<(?:select|textarea|form)\b/);
});
test("C1 reflects four before case opening, five after, and alternate sixth incident", () => {
  assert.equal(model.statewideRows(records(false), []).length, 4);
  assert.equal(model.statewideRows(records(), [saved()]).length, 5);
  const r = records();
  r.statewideIncidents.push({
    ...r.statewideIncidents[1],
    id: "alt-6",
    title: "Authored sixth incident",
  });
  const html = render("command", freeze(r));
  assert.match(html, /Authored sixth incident/);
  assert.match(html, /Actual analyst update/);
  assert.match(html, /Government/);
  assert.doesNotMatch(html, /not supplied/);
});
test("actual alternate assessment, deployments, options, products and contact status render without originals", () => {
  const r = records();
  r.teams[0].name = "Authored mobile team";
  r.assessments[0].actorLabel = "Authored actor";
  r.contacts[0].partnerRole = "Authored partner";
  r.contacts[0].status = "engaged";
  r.contactStatusLabels.engaged = "Authored engagement";
  r.partnerProducts[0].label = "Authored partner product";
  const ref = structuredClone(reference);
  ref.responseOptions[0].title = "Authored response option";
  freeze(r);
  freeze(ref);
  for (const [view, pattern] of [
    ["cyber", /Authored actor/],
    ["uctf", /Authored mobile team/],
    ["leadership", /Authored response option/],
    ["federation", /Authored engagement/],
  ])
    assert.match(render(view, r, saved(), ref), pattern);
  assert.doesNotMatch(render("uctf", r), /CIRU Team Alpha/);
  assert.match(render("leadership", r), /Authored partner product/);
  assert.match(render("federation", r), /CITRIDE does not send notifications/);
  assert.equal(
    (render("federation", r).match(/data-audience=/g) || []).length,
    4,
  );
});
test("option windows match function IDs, never unrelated earliest impacts; clock follows story time", () => {
  const s = saved();
  s.runSnapshot = {
    id: "run",
    baselineSnapshot: data,
    impacts: [
      {
        id: "unrelated",
        entityId: "plant-a",
        functionId: "unrelated",
        windowHours: [0.1, 1],
      },
      {
        id: "health",
        entityId: "nursing-z",
        functionId: "nursing-safe-water",
        windowHours: [7, 9],
      },
    ],
  };
  const cards = model.optionCards(reference, s);
  assert.deepEqual(
    cards.find((c) => c.option.id === reference.responseOptions[0].id).window,
    [7, 9],
  );
  assert.equal(model.responseClock(records(), reference, s).elapsedMinutes, 30);
  const later = records();
  later.now = "2026-10-13T09:40:00Z";
  assert.equal(model.responseClock(later, reference, s).tone, "red");
});
test("closed statewide summaries stay read-only and do not fabricate captured runs", () => {
  const html = render("leadership");
  assert.match(html, /TX-26-0398/);
  assert.match(html, /Read-only summary/);
  assert.match(html, /Credential phishing contained/);
  assert.doesNotMatch(html, /Chief response-option decisions.*not supplied/);
  const r = records();
  const s = saved();
  s.status = "closed";
  assert.match(render("leadership", r, s), /Closed case/);
});
test("attack telemetry labels remain exact and authored techniques and calculated durations appear", () => {
  const d = structuredClone(data);
  d.events = [
    {
      id: "vpn",
      label: "Entry",
      relativeTimeHours: -0.5,
      observation: "vendor_vpn_login_off_hours",
      attackTechniques: ["Authored technique"],
    },
    {
      id: "plant",
      label: "Plant access",
      relativeTimeHours: 0,
      observation: "unauthorized_controller_login",
    },
    {
      id: "change",
      label: "Changed setpoint",
      relativeTimeHours: 0.1,
      observation: "dosing_parameter_change",
    },
  ];
  const html = render("cyber", records(), null, reference, d);
  assert.match(html, /Authored technique/);
  assert.match(html, /How far the attack got/);
  assert.match(html, /class="sc-stage-cards"/);
  assert.doesNotMatch(html, /<h[1-6][^>]*>Network · Corelight/);
  assert.match(html, /30m/);
  assert.match(html, /6m/);
});
test("optional integration delegates populated screens and retains C2 infrastructure with one header", () => {
  const r = freeze(records());
  const s = freeze(saved());
  for (const view of [
    "command",
    "cyber",
    "uctf",
    "leadership",
    "federation",
    "cop",
  ]) {
    const html = renderToStaticMarkup(
      createElement(Integrated, {
        data,
        incidents: [s],
        selected: s,
        records: r,
        reference,
        view,
        onSelect() {},
        onOpenAnalyst() {},
        onNavigate() {},
      }),
    );
    assert.equal((html.match(/class="cc-page-heading"/g) || []).length, 0, view);
    if (view === "cop") {
      assert.match(html, /Incident view/);
      assert.match(html, /data-incident-schematic/);
      assert.doesNotMatch(html, /All Statewide Incidents|sf-state-map/);
    } else
      assert.doesNotMatch(
        html,
        /records are not supplied|Team, deployment|Contact-status and partner-role records are not supplied/,
      );
  }
  assert.equal(r.statewideIncidents[0].status, "open");
  assert.equal(s.status, "open");
});
test("command source has no copied authored display strings or network mutations", () => {
  const src =
    readFileSync(
      new URL("../src/ScriptedCommandViews.tsx", import.meta.url),
      "utf8",
    ) +
    readFileSync(
      new URL("../src/scriptedCommandModel.ts", import.meta.url),
      "utf8",
    );
  for (const str of [
    supplied.teams[0].name,
    supplied.assessments[0].actorLabel,
    supplied.hunts[0].label,
    supplied.incidents[1].title,
    supplied.partnerProducts[0].label,
  ])
    assert.equal(src.includes(str), false, str);
  assert.doesNotMatch(src, /\bfetch\s*\(|onMutate|method:\s*["']POST/);
});
