import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import { commandNavigation, analystNavigation } from "../src/commandTypes.ts";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const verifier = readFileSync(
  new URL("../../scripts/verify_command_ui.py", import.meta.url),
  "utf8",
);
const expectedCommand = [
  ["command", "C1", "Command Overview", ""],
  ["cop", "C2", "Incident View", ""],
  ["cyber", "C3", "Attack Picture", "CTIC"],
  ["consequence", "C4", "Consequences", ""],
  ["uctf", "C5", "Response Teams", "UCTF"],
  ["leadership", "C6", "Leadership Brief", ""],
  ["federation", "C7", "Partner and Stakeholder Coordination", ""],
];
const expectedAnalyst = [
  ["command", "A1", "Case Queue", ""],
  ["cop", "A2", "Investigation Map", ""],
  ["cyber", "A3", "Cyber Evidence", "CTIC"],
  ["consequence", "A4", "Consequence Analysis", ""],
  ["coordination", "A5", "Who Acts First", ""],
  ["uctf", "A6", "Response Tasks", "UCTF"],
];
const fields = (items) =>
  items.map(({ id, code, label, unit }) => [id, code, label, unit]);

test("all thirteen destinations use the supplied names and units without changing IDs, codes or colors", () => {
  assert.deepEqual(fields(commandNavigation), expectedCommand);
  assert.deepEqual(fields(analystNavigation), expectedAnalyst);
  assert.deepEqual(
    commandNavigation.map(({ color }) => color),
    [
      "#60a5fa",
      "#fb923c",
      "#34d399",
      "#a78bfa",
      "#f472b6",
      "#22d3ee",
      "#cbd5e1",
    ],
  );
  assert.deepEqual(
    analystNavigation.map(({ color }) => color),
    ["#60a5fa", "#fb923c", "#34d399", "#a78bfa", "#fbbf24", "#f472b6"],
  );
});

// Render the actual heading JSX in isolation: no app startup, API calls or browser needed.
const headingJsx = app.match(/<h1>[\s\S]*?<\/h1>/)?.[0];
assert.ok(headingJsx, "the page heading exists");
const compiled = await transformWithOxc(
  `function Heading({ commandView, view, title }) { return (${headingJsx}); }`,
  "heading.tsx",
  {
    jsx: { runtime: "classic" },
  },
);
const Heading = new Function("React", `${compiled.code}; return Heading;`)(
  createRequire(import.meta.url)("react"),
);
const render = (props) => renderToStaticMarkup(createElement(Heading, props));

test("page headings repeat code and canonical label, with any unit in a separate muted suffix", () => {
  for (const [id, code, label, unit] of [
    ...expectedCommand,
    ...expectedAnalyst,
  ]) {
    const html = render({
      commandView: { id, code, label, unit },
      view: id,
      title: label,
    });
    assert.equal(
      html.replace(/<[^>]*>/g, ""),
      `${code} · ${label}${unit ? ` ${unit}` : ""}`,
    );
    if (unit)
      assert.match(
        html,
        new RegExp(`<span class="muted-text"> ?${unit}</span>`),
      );
    else assert.doesNotMatch(html, /muted-text/);
  }
});

test("detail and Advanced titles do not acquire screen prefixes; all eight tool names stay unchanged", () => {
  for (const label of ["Case File", "Entity Profile"]) {
    assert.equal(
      render({ commandView: { label }, view: "case-file", title: label }),
      `<h1>${label}</h1>`,
    );
  }
  const tools = [
    "Situation overview",
    "Incident → decision",
    "Relationship model",
    "Ontology blueprint",
    "Ontology reasoning",
    "Scenario lab",
    "Event evidence",
    "Sources & assumptions",
  ];
  for (const label of tools) {
    assert.ok(app.includes(`label: "${label}"`), label);
    assert.equal(
      render({ view: "lab", title: label }),
      `<h1>${label.replaceAll("&", "&amp;")}</h1>`,
    );
  }
  assert.equal(
    render({ view: "overview", title: "Situation overview" }),
    "<h1>From incident to downstream impact</h1>",
  );
});

test("sidebar has one mode heading and no repeated policy footer", () => {
  const sidebar = app.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? "";
  assert.equal(
    (sidebar.match(/className="shell-nav-heading"/g) ?? []).length,
    1,
  );
  assert.match(sidebar, /mode === "command" \? "COMMAND CENTER" : "ANALYST"/);
  assert.doesNotMatch(
    sidebar,
    /className="nav-label"|Human review required|SITUATIONAL AWARENESS|ANALYST WORKFLOW/,
  );
});

test("one static sample status lives in the existing header context mount without replacing subtitles or controls", () => {
  const header =
    app.match(
      /<header className="topbar shell-header">([\s\S]*?)<\/header>/,
    )?.[1] ?? "";
  const mount =
    header.match(
      /<div id="workspace-header-context"[^>]*>([\s\S]*?)<\/div>/,
    )?.[1] ?? "";
  const status = "Sample data · not connected to live systems";
  assert.match(mount, /<span className="sample-data">/);
  assert.ok(mount.includes(status));
  assert.equal(app.split(status).length - 1, 1);
  assert.doesNotMatch(header, /READ-ONLY PICTURE|className="badge simulation"/);
  for (const text of [
    "Texas Cyber Command · Statewide Command Center",
    "Analyst workspace · CTIC watch floor",
    'aria-label="Reload model"',
  ])
    assert.ok(header.includes(text), text);
  assert.ok(!header.includes("Baseline r"));
  assert.ok(app.includes("Baseline r{data?.baselineRevision"));
});

test("isolated QA verifier uses the current C/A names and Advanced tools, with workflows on analyst routes", () => {
  assert.doesNotMatch(
    verifier,
    /S[1-8] (?:Command|Service|Cyber|Coordination|Task|Consequence|Leadership|Organizations)/,
  );
  for (const [, code, label, unit] of [...expectedCommand, ...expectedAnalyst])
    assert.ok(
      verifier.includes(`${code} ${label}${unit ? ` ${unit}` : ""}`),
      `${code} ${label}`,
    );
  assert.ok(verifier.includes('"Advanced tools"'));
  for (const name of [
    "A1 Case Queue",
    "A4 Consequence Analysis",
    "A5 Who Acts First",
    "A6 Response Tasks UCTF",
  ])
    assert.ok(verifier.includes(`nav("${name}")`), name);
});
