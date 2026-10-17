import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";

const source = (name) =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
test("status chips keep whole labels on one line instead of splitting state words", () => {
  assert.match(source("shared-components.css"), /white-space:\s*nowrap/);
  assert.match(
    source("shared-components.css"),
    /font-family:\s*var\(--font-sans\)/,
  );
});
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
const component = async (name) =>
  (await import(await compile(new URL(`../src/${name}.tsx`, import.meta.url))))
    .default;
const render = (Component, props) =>
  renderToStaticMarkup(createElement(Component, props));

test("real command and analyst record screens render shared status spans without changing authored labels", async () => {
  const read = (path) =>
    JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const data = read("../../data/scenario.json");
  const supplied = read("../../data/scripted/watershed_beta.json");
  const reference = read("../../data/reference.json");
  const records = {
    ...supplied,
    statewideIncidents: supplied.incidents,
    responseTasks: supplied.tasks,
    storyNow: "2026-10-13T08:30:00Z",
  };
  const selected = {
    id: "visual-case",
    title: "Authored case title",
    status: "open",
    priority: "high",
    createdAt: "2026-10-13T08:00:00Z",
    eventSnapshot: data.events[0],
    contextSnapshot: {
      event: data.events[0],
      warnings: [],
      sourceRefs: [],
      downstreamDependencies: [],
    },
    tasks: [],
    decisions: [],
    notes: [],
    activity: [],
    runSnapshot: null,
  };
  const Command = await component("ScriptedCommandViews");
  const analystModule = await import(
    await compile(new URL("../src/ScriptedAnalystViews.tsx", import.meta.url))
  );
  const Analyst = analystModule.default;
  for (const collection of [
    "assetStatuses",
    "hunts",
    "contacts",
    "partnerProducts",
    "teams",
    "responseTasks",
  ])
    records[collection] = records[collection].map((item) => ({
      ...item,
      incidentId: selected.id,
    }));
  records.contacts[0] = { ...records.contacts[0], status: "engaged" };
  records.contactStatusLabels.engaged = "Authored mixed-case engagement";
  const props = {
    data,
    incidents: [selected],
    selected,
    records,
    reference,
    onSelect() {},
    onOpenAnalyst() {},
    onNavigate() {},
    onRefresh() {},
    onMutate: async () => {},
  };
  for (const view of [
    "command",
    "cop",
    "cyber",
    "uctf",
    "leadership",
    "federation",
  ]) {
    const html = render(Command, { ...props, view });
    assert.match(html, /status-chip/);
    assert.equal((html.match(/class="cc-page-heading"/g) || []).length, 0);
  }
  assert.match(
    render(Command, { ...props, view: "federation" }),
    /Authored mixed-case engagement/,
  );
  for (const view of ["cyber", "uctf", "coordination"]) {
    const html = render(Analyst, { ...props, view });
    assert.match(html, /status-chip/);
  }
  const Network = await component("NetworkEvidence");
  const networkHtml = render(Network, {
    data,
    telemetry: null,
    incident: selected,
    records,
    initialTab: "hunts",
    onMutate: async () => {},
  });
  assert.match(
    networkHtml,
    /Cyber evidence|Network evidence|Telemetry unavailable/i,
  );
});

test("central status table covers real data label maps, backend actions/validation, and frontend literal states", async () => {
  const { statusTone, STATUS_TONES } = await import("../src/statusTone.ts");
  const data = JSON.parse(
    readFileSync(
      new URL("../../data/scripted/watershed_beta.json", import.meta.url),
      "utf8",
    ),
  );
  const values = new Set();
  function walk(value) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value)) {
        if (
          /^(status|severity|state|priority|decision)$/.test(key) &&
          typeof item === "string"
        )
          values.add(item);
        if (/Labels$/.test(key) && item && typeof item === "object")
          Object.keys(item).forEach((label) => values.add(label));
        walk(item);
      }
  }
  walk(data);
  const backendValues = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `import ast,json,pathlib
root=pathlib.Path(${JSON.stringify(new URL("../../", import.meta.url).pathname)})
values=set()
for name in ('command_requests.py','scripted_validation.py'):
 tree=ast.parse((root/'backend/citride'/name).read_text())
 for node in ast.walk(tree):
  if isinstance(node,ast.AnnAssign) and isinstance(node.target,ast.Name) and node.target.id in ('status','priority','decision','confidence'):
   if isinstance(node.annotation,ast.Subscript):
    for child in ast.walk(node.annotation.slice):
     if isinstance(child,ast.Constant) and isinstance(child.value,str): values.add(child.value)
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='STATUS_LABELS' for t in node.targets):
   for mapping in ast.literal_eval(node.value).values(): values.update(mapping)
print(json.dumps(sorted(values)))`,
      ],
      { encoding: "utf8" },
    ),
  );
  backendValues.forEach((value) => values.add(value));
  for (const match of source("commandTypes.ts").matchAll(
    /(?:IncidentPriority|IncidentStatus)\s*=([^;]+);/g,
  ))
    for (const value of match[1].matchAll(/"([^"]+)"/g)) values.add(value[1]);
  for (const value of [
    "under_attack",
    "compromised",
    "suspected",
    "probed",
    "probing_only",
    "at_risk",
    "normal",
    "done",
    "in_progress",
    "waiting",
    "late",
    "not_started",
    "queued",
    "reviewed",
    "needs_review",
    "open",
    "monitoring",
    "closed",
    ...values,
  ]) {
    assert.ok(
      Object.hasOwn(STATUS_TONES, value),
      `missing explicit status: ${value}`,
    );
    assert.ok(
      ["red", "amber", "green", "blue", "grey"].includes(statusTone(value)),
      value,
    );
  }
  for (const value of [
    "under_attack",
    "compromised",
    "confirmed",
    "critical",
    "high",
    "late",
    "findings",
  ])
    assert.equal(statusTone(value), "red", value);
  for (const value of [
    "suspected",
    "probed",
    "probing_only",
    "waiting",
    "needs_review",
    "medium",
  ])
    assert.equal(statusTone(value), "amber", value);
  for (const value of ["at_risk", "queued", "informational"])
    assert.equal(statusTone(value), "blue", value);
  for (const value of ["normal", "done", "reviewed", "no_findings"])
    assert.equal(statusTone(value), "green", value);
  for (const value of [
    undefined,
    null,
    "",
    "unexpected authored state",
    "toString",
    "__proto__",
  ])
    assert.equal(statusTone(value), "grey");
  assert.equal(statusTone("under-attack"), "red");
});

test("StatusChip is a semantic span retaining exact caller text, attributes, arbitrary titles and children", async () => {
  const StatusChip = await component("StatusChip");
  const html = render(StatusChip, {
    status: "suspected",
    className: "sa-chip",
    title: "Authored title · not inferred",
    "data-record": "saved-a",
    "aria-label": "Recorded assessment",
    children: [
      "Authored engagement",
      createElement("small", { key: "note" }, " · unconfirmed"),
    ],
  });
  assert.match(html, /^<span\b/);
  assert.match(html, /class="[^"]*sa-chip/);
  assert.match(html, /status-chip--amber/);
  assert.match(html, /title="Authored title · not inferred"/);
  assert.match(html, /data-record="saved-a"/);
  assert.match(html, /aria-label="Recorded assessment"/);
  assert.match(html, /Authored engagement<small> · unconfirmed<\/small>/);
  assert.match(
    render(StatusChip, { status: "authored_state" }),
    /authored_state<\/span>/,
  );
});

test("TechniqueChip preserves existing ID/name copy and tactic tooltip; IDT keeps native disclosure", async () => {
  const TechniqueChip = await component("TechniqueChip");
  const html = render(TechniqueChip, {
    id: "T1234",
    name: "Authored technique",
    tactic: "Authored tactic",
    className: "network-chip network-attack",
  });
  assert.match(html, /^<span\b/);
  assert.match(html, /T1234 · Authored technique<\/span>/);
  assert.match(html, /title="Authored tactic"/);
  assert.match(html, /chip-mono/);
  assert.match(source("IdtChip.tsx"), /className="idt-chip chip-mono"/);
  assert.match(source("IdtChip.tsx"), /<details/);
  assert.match(source("IdtChip.tsx"), /<summary\s+title=\{title\}/);
});

test("cards/tiles preserve caller content and semantics without extra headers or headings", async () => {
  for (const name of ["VisualCard", "SummaryTile"]) {
    const Component = await component(name);
    const html = render(Component, {
      className: "original-card",
      "data-authored": "yes",
      children: createElement("p", null, "Original copy"),
    });
    assert.match(html, /^<(?:section|article)\b/);
    assert.match(html, /original-card/);
    assert.match(html, /data-authored="yes"/);
    assert.match(html, /<p>Original copy<\/p>/);
    assert.doesNotMatch(html, /<header|<h[1-6]/);
  }
});

test("shared styles use theme tokens and CSS-only status casing, with real-screen reuse", () => {
  const css = source("shared-components.css");
  assert.match(css, /\.status-chip\b[^}]*text-transform:\s*uppercase/s);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|font-size:\s*[\d.]+(?:px|rem|em)/i);
  for (const token of [
    "--fs-chip",
    "--fs-card-title",
    "--fs-number",
    "--fs-tile-label",
    "--fs-small",
  ])
    assert.ok(css.includes(`var(${token})`), token);
  for (const name of [
    "StatusChip.tsx",
    "TechniqueChip.tsx",
    "VisualCard.tsx",
    "SummaryTile.tsx",
  ])
    assert.doesNotMatch(source(name), /toUpperCase|toLocaleUpperCase/);
  for (const name of [
    "ScriptedCommandViews",
    "ScriptedAnalystViews",
    "NetworkEvidence",
    "AnalystConsequences",
    "StatewideFootprint",
    "CommandCenterViews",
    "CommandCasework",
    "AnalystEntityProfile",
    "PrototypeCaseViews",
  ])
    assert.match(source(`${name}.tsx`), /<StatusChip\b/, name);
  assert.match(source("NetworkEvidence.tsx"), /<TechniqueChip\b/);
  assert.match(source("ScriptedCommandViews.tsx"), /<VisualCard\b/);
  assert.match(source("CommandCenterViews.tsx"), /<SummaryTile\b/);
});
