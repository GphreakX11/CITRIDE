import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const cache = new Map();
async function compile(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let code = (
    await transformWithOxc(readFileSync(url, "utf8"), url.pathname, {
      jsx: { runtime: "automatic" },
    })
  ).code;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  const imports = new Map();
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const s = m[1];
    imports.set(
      s,
      s.startsWith(".")
        ? await compile(new URL(s, url))
        : import.meta.resolve(s),
    );
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_, s) => `from ${JSON.stringify(imports.get(s))}`,
  );
  const out = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  cache.set(url.href, out);
  return out;
}
const model = await import(
  await compile(new URL("../src/consequencesModel.ts", import.meta.url))
);
const { ConsequencesContent, default: ConsequencesView } = await import(
  await compile(new URL("../src/ConsequencesView.tsx", import.meta.url))
);
const { clockLabel } = await import(
  await compile(new URL("../src/useRealClock.ts", import.meta.url))
);
test("C4 SSR preserves captured analysis without window or a new projection", () => {
  const markup = renderToStaticMarkup(createElement(ConsequencesView, {
    selectedId: "legacy-case", captured: createElement("section", null, "Saved immutable graph"),
    onSelect() {}, onOpenAnalyst() {}, onNavigate() {},
  }));
  assert.match(markup, /Saved immutable graph/);
  assert.doesNotMatch(markup, /Loading consequence records/);
  assert.match(markup, /<time dateTime=/);
});
test("node tones are evidence driven and never default green", () => {
  const state = model.consequenceNodeState;
  assert.equal(state({ source: true }).tone, "red");
  assert.equal(state({ windowHours: [1, 4] }).tone, "red");
  assert.equal(state({ windowHours: [4, 8] }).tone, "amber");
  assert.equal(state({ notAffected: true }).line, "dashed");
  assert.equal(state({ inArea: true }).line, "dotted");
  assert.equal(state({ upstream: true }).tone, "green");
  assert.equal(state({ upstream: true, status: "degraded" }).tone, "grey");
  assert.equal(state({}).tone, "grey");
});
test("incident URL is authoritative and water is explicit default", () => {
  assert.equal(model.initialConsequenceIncident(""), "TX-26-0412");
  assert.equal(
    model.initialConsequenceIncident("?incidentId=port", "case"),
    "port",
  );
  assert.equal(model.initialConsequenceIncident("?incident=other"), "other");
});
test("operations clock follows Chicago daylight savings", () => {
  assert.match(clockLabel(Date.parse("2026-10-18T12:00:00Z")), /07:00:00.*CDT/);
  assert.equal(
    model.elapsedLabel(
      "2026-10-18T11:30:00Z",
      Date.parse("2026-10-18T12:00:00Z"),
    ),
    "30 min ago",
  );
});
const fixture = {
  now: "2026-10-18T12:00:00Z",
  operationsTimeZone: "America/Chicago",
  incident: { id: "OTHER-1", title: "Other jurisdiction" },
  incidents: [],
  analysis: {
    kind: "preliminary",
    createdAt: "2026-10-18T11:30:00Z",
    modelVersion: "interval-v1",
    seed: { lossType: "unsafe_water" },
  },
  source: { id: "source", name: "Other utility", type: "WaterServiceProvider" },
  people: 42,
  atRisk: 1,
  earliestWindow: [1, 4],
  nodes: [
    {
      id: "dependent",
      name: "Care center",
      sector: "Healthcare",
      type: "Hospital",
      windowHours: [1, 4],
      impactCount: 1,
      paths: [],
      reserves: [],
      sourceRefs: [],
      reserveLabel: "Clean-water reserve",
    },
  ],
  edges: [],
  sectors: [],
};
function render(value) {
  return renderToStaticMarkup(
    createElement(ConsequencesContent, {
      value,
      now: Date.parse(value.now),
      onAnalyst() {},
      onPartners() {},
    }),
  );
}
test("record-driven C4 includes missing-data, evidence, advisory and no place assumptions", () => {
  const html = render(fixture);
  for (const text of [
    "PRELIMINARY ESTIMATE",
    "42",
    "Critical infrastructure at risk",
    "1–4 h",
    "Not recorded for this asset",
    "Timeline and thresholds",
    "Workarounds",
    "Who owns the response",
    "Confidence:",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /Texas|Houston|14 facilities|Critical facilities|No incident selected/,
  );
  assert.match(html, /not yet reviewed by an analyst/);
});
test("reviewed banner and modeled colors are independent", () => {
  const html = render({
    ...fixture,
    analysis: { ...fixture.analysis, kind: "reviewed" },
  });
  assert.match(html, /ANALYSIS REVIEWED/);
  assert.doesNotMatch(html, /PRELIMINARY ESTIMATE/);
  assert.equal((html.match(/c4-tile tone-red/g) || []).length, 2);
});
test("unmodeled incident retains explicit development state", () => {
  const html = render({ ...fixture, analysis: null });
  assert.match(
    html,
    /Consequence view for this incident type is in development/,
  );
  assert.match(html, /Alerts in Analyst/);
});
if (process.env.C4_PROJECTIONS) {
  const projections = JSON.parse(
    readFileSync(process.env.C4_PROJECTIONS, "utf8"),
  );
  for (const value of projections)
    test(`actual backend projection renders ${value.incident.id}`, () => {
      const html = render(value);
      assert.match(html, /PRELIMINARY ESTIMATE/);
      assert.ok(html.includes(value.source.label || value.source.name));
      assert.ok(html.includes(String(value.atRisk)));
      assert.ok(html.includes("Who owns the response"));
    });
}
