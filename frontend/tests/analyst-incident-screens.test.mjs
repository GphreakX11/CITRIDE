import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "./json-module-transform.mjs";
import {
  analystIncidentScreenModel,
  handlesAnalystIncidentView,
  incidentEventTechniques,
} from "../src/AnalystIncidentScreensModel.ts";

const cache = new Map();
const contextStub = `data:text/javascript;base64,${Buffer.from("export function useAnalystIncident(){return globalThis.__analystIncidentScreenTestContext ?? null}").toString("base64")}`;
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const name = match[1];
    let target;
    if (name.endsWith("/analystIncidentContext.ts")) target = contextStub;
    else if (name.startsWith(".")) {
      let path = new URL(name, url);
      if (!existsSync(path))
        path =
          [".ts", ".tsx"]
            .map((extension) => new URL(name + extension, url))
            .find((candidate) => existsSync(candidate)) ?? path;
      target = await compile(path);
    } else target = import.meta.resolve(name);
    imports.set(name, target);
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_, name) => `from ${JSON.stringify(imports.get(name))}`,
  );
  const out = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, out);
  return out;
}
const screens = await import(
  await compile(new URL("../src/AnalystIncidentScreens.tsx", import.meta.url))
);
const EntityProfile = (
  await import(
    await compile(new URL("../src/AnalystEntityProfile.tsx", import.meta.url))
  )
).default;
const entity = (id, extra = {}) => ({
  id,
  label: `Asset ${id}`,
  type: "Facility",
  sourceRefs: [],
  ...extra,
});
const dependency = (id, provider, dependent) => ({
  id,
  provider,
  dependent,
  requiredService: "cargo",
  dependencyType: "service",
  propagationDelayMinHours: 1,
  propagationDelayMaxHours: 3,
  lossTypes: [],
  validForLossTypes: [],
  sourceRefs: [],
  assumptionNote: "Actual dependency assumption",
});
function fixture(prefix = "third") {
  const incident = {
    id: `${prefix}-incident`,
    title: `${prefix} title`,
    linkedEventIds: [`${prefix}-event`],
  };
  const mainStore = {
    baselineRevision: 8,
    modelVersion: "fixture",
    entities: [
      entity("sensor", { hostedBy: "site" }),
      entity("site", { operatedBy: "shared-op", locatedIn: "region" }),
      entity("downstream"),
      entity("foreign", { operatedBy: "shared-op", locatedIn: "region" }),
    ],
    dependencies: [
      dependency("supply", "site", "downstream"),
      dependency("cycle", "downstream", "site"),
    ],
    serviceFunctions: [],
    events: [
      {
        id: `${prefix}-event`,
        label: `${prefix} actual event`,
        seenOn: "sensor",
        relativeTimeHours: 0,
        attackTechniques: [
          {
            id: "T-GENERIC",
            name: "Actual technique",
            tactic: "Recorded tactic",
          },
        ],
      },
      { id: "foreign-event", label: "FOREIGN EVENT", seenOn: "foreign" },
    ],
    sources: [],
    assumptions: [],
    assessments: [],
    scenarios: [],
    defaultScenarioId: "",
  };
  return {
    selectedIncident: incident,
    selectedIncidentId: incident.id,
    activeCase: null,
    mainStore,
    cases: [],
    records: {},
    matchingOpenCases: [],
    openIncidents: [incident],
    reference: null,
    telemetry: null,
    locked: false,
    projection: null,
    projectionLoading: false,
    projectionError: "",
    eventTimestamp: () => "2026-10-19T16:00:00Z",
    selectCase() {
      throw Error("No writes");
    },
    selectIncident() {
      throw Error("No selection mutation");
    },
  };
}
const render = (Component, props) =>
  renderToStaticMarkup(createElement(Component, props));
const props = (context) => ({ context, onOpenAlerts() {}, onOpenEntity() {} });
function elements(node) {
  if (!isValidElement(node)) return [];
  if (typeof node.type === "function") return elements(node.type(node.props));
  return [node, ...[node.props.children].flat(Infinity).flatMap(elements)];
}

test("register event links and directed dependencies scope three arbitrary incidents without mutation or shared-operator leakage", () => {
  for (const prefix of ["alpha", "beta", "customer-three"]) {
    const context = fixture(prefix);
    const before = JSON.stringify(context.mainStore);
    const model = analystIncidentScreenModel(
      context.mainStore,
      context.selectedIncident,
    );
    assert.deepEqual(
      model.events.map((event) => event.id),
      [`${prefix}-event`],
    );
    assert.deepEqual(
      model.entities.map((entity) => entity.id),
      ["sensor", "site", "downstream"],
    );
    assert.deepEqual(
      model.dependencies.map((dep) => dep.id),
      ["supply", "cycle"],
    );
    assert.equal(JSON.stringify(context.mainStore), before);
  }
});

test("authored water and port data render their own linked events/assets from combined main store", () => {
  const water = JSON.parse(
    readFileSync(new URL("../../data/scenario.json", import.meta.url)),
  );
  const port = JSON.parse(
    readFileSync(
      new URL("../../data/scripted/port_houston.json", import.meta.url),
    ),
  );
  const records = JSON.parse(
    readFileSync(
      new URL("../../data/scripted/watershed_beta.json", import.meta.url),
    ),
  );
  const mainStore = {
    ...water,
    entities: [...water.entities, ...port.entities],
    dependencies: [...water.dependencies, ...port.dependencies],
    events: [...water.events, ...port.events],
  };
  for (const selectedIncident of [records.incidents[0], port.incident]) {
    const context = {
      ...fixture(),
      selectedIncident,
      selectedIncidentId: selectedIncident.id,
      mainStore,
    };
    const model = analystIncidentScreenModel(mainStore, selectedIncident);
    assert.deepEqual(
      model.events.map((event) => event.id).sort(),
      [...selectedIncident.linkedEventIds].sort(),
    );
    assert.ok(model.entities.length > 0);
    assert.ok(model.dependencies.length > 0);
    const html = render(screens.AnalystIncidentCyberEvidence, props(context));
    for (const event of model.events) assert.ok(html.includes(event.label));
    const foreignEvents =
      selectedIncident === port.incident ? water.events : port.events;
    for (const event of foreignEvents) assert.ok(!html.includes(event.label));
    assert.match(
      render(screens.AnalystIncidentInvestigationMap, props(context)),
      /Directed dependencies/,
    );
  }
});

test("absent or dangling linked events never fall back to the first event or all inventory", () => {
  const context = fixture();
  assert.equal(
    analystIncidentScreenModel(context.mainStore, null).events.length,
    0,
  );
  const model = analystIncidentScreenModel(context.mainStore, {
    id: "empty",
    linkedEventIds: ["missing"],
  });
  assert.deepEqual(model.missingEventIds, ["missing"]);
  assert.equal(model.entities.length, 0);
});

test("A2 renders actual assets and dependency provenance and Entity Profile navigation is explicit and locked", () => {
  const context = fixture();
  let clicked = [];
  const p = { ...props(context), onOpenEntity: (id) => clicked.push(id) };
  const html = render(screens.AnalystIncidentInvestigationMap, p);
  assert.match(html, /Asset downstream/);
  assert.match(html, /Actual dependency assumption/);
  assert.doesNotMatch(html, /Asset foreign/);
  const button = elements(screens.AnalystIncidentInvestigationMap(p)).find(
    (node) => node.type === "button",
  );
  button.props.onClick();
  assert.deepEqual(clicked, ["sensor"]);
  context.locked = true;
  elements(screens.AnalystIncidentInvestigationMap(p))
    .find((node) => node.type === "button")
    .props.onClick();
  assert.deepEqual(clicked, ["sensor"]);
});

test("A3 renders only actual incident events, recorded techniques and shared formatted timestamps", () => {
  const context = fixture();
  const html = render(screens.AnalystIncidentCyberEvidence, props(context));
  assert.match(html, /third actual event/);
  assert.match(html, /Actual technique/);
  assert.match(html, /Recorded tactic/);
  assert.doesNotMatch(html, /FOREIGN EVENT|Time unavailable/);
  assert.deepEqual(incidentEventTechniques({ id: "none" }), []);
  assert.match(html, /<time dateTime="2026-10-19T16:00:00Z">/);
});

function projection(context) {
  return {
    incident: { id: context.selectedIncidentId, title: "Actual projection" },
    analysis: {
      kind: "preliminary",
      createdAt: "2026-10-19T15:00:00Z",
      modelVersion: "real-model",
    },
    source: { id: "site", name: "Projection source" },
    nodes: [
      {
        id: "downstream",
        name: "ACTUAL MODELED ASSET",
        sector: "Transport",
        status: "at_risk",
        windowHours: [2, 8],
      },
    ],
    sectors: [{ label: "Transport", windowHours: [2, 8], atRisk: 1 }],
    edges: [],
    now: "2026-10-19T16:00:00Z",
    incidents: [],
  };
}
test("A4 displays actual selected projection and never stale cross-incident data, including loading/error/empty states", () => {
  const context = fixture();
  context.projection = projection(context);
  let html = render(screens.AnalystIncidentConsequenceAnalysis, props(context));
  assert.match(html, /Preliminary estimate/);
  assert.match(html, /Open a case to review and capture/);
  assert.match(html, /ACTUAL MODELED ASSET/);
  assert.match(html, /2–8 h/);
  assert.match(html, /real-model/);
  context.projection.incident.id = "other";
  html = render(screens.AnalystIncidentConsequenceAnalysis, props(context));
  assert.doesNotMatch(html, /ACTUAL MODELED ASSET/);
  assert.match(html, /No automatic analysis available/);
  context.projectionLoading = true;
  assert.match(
    render(screens.AnalystIncidentConsequenceAnalysis, props(context)),
    /Loading automatic/,
  );
  context.projectionLoading = false;
  context.projectionError = "backend offline";
  assert.match(
    render(screens.AnalystIncidentConsequenceAnalysis, props(context)),
    /role="alert"/,
  );
});

test("A5/A6/Case File have honest empty states, no forms or writes, and navigation-only A1 CTA", () => {
  const context = fixture();
  let navigations = 0;
  for (const view of ["coordination", "uctf", "case-file"]) {
    const html = render(screens.default, { ...props(context), view });
    assert.match(html, /No case yet for this incident/);
    assert.match(html, /Open case from this incident’s alerts/);
    assert.doesNotMatch(html, /<form|<input|<textarea/);
  }
  const p = {
    ...props(context),
    title: "Case File",
    onOpenAlerts: () => navigations++,
  };
  elements(screens.AnalystIncidentNoCase(p))
    .find((node) => node.type === "button")
    .props.onClick();
  assert.equal(navigations, 1);
  context.locked = true;
  elements(screens.AnalystIncidentNoCase(p))
    .find((node) => node.type === "button")
    .props.onClick();
  assert.equal(navigations, 1);
});

test("dispatcher consumes provider and yields null for open/closed actual cases and unowned routes", () => {
  const context = fixture();
  globalThis.__analystIncidentScreenTestContext = context;
  assert.match(
    render(screens.default, {
      ...props(context),
      context: undefined,
      view: "cyber",
    }),
    /third actual event/,
  );
  for (const status of ["open", "closed"]) {
    context.activeCase = { id: "real", status };
    assert.equal(
      render(screens.default, { ...props(context), view: "cop" }),
      "",
    );
    assert.equal(handlesAnalystIncidentView("cop", context.activeCase), false);
  }
  context.activeCase = null;
  for (const view of ["command", "entity-profile", "unknown"])
    assert.equal(render(screens.default, { ...props(context), view }), "");
  globalThis.__analystIncidentScreenTestContext = null;
});

test("Entity Profile uses live main store without case, preserving supplied snapshot with an actual case", () => {
  const context = fixture();
  context.mainStore.entities[1].label = "CURRENT MAIN STORE SITE";
  const snapshot = structuredClone(context.mainStore);
  snapshot.entities[1].label = "CAPTURED CASE SITE";
  const p = {
    incidentContext: context,
    data: snapshot,
    entityId: "site",
    incidents: [],
    locked: false,
    onSelectEntity() {},
    onOpenCase() {},
    onOpenTool() {},
    onEditDependency() {},
    onBack() {},
  };
  globalThis.__analystIncidentScreenTestContext = context;
  assert.match(render(EntityProfile, p), /CURRENT MAIN STORE SITE/);
  assert.doesNotMatch(render(EntityProfile, p), /CAPTURED CASE SITE/);
  context.activeCase = { id: "actual-case" };
  assert.match(render(EntityProfile, p), /CAPTURED CASE SITE/);
  globalThis.__analystIncidentScreenTestContext = null;
});
