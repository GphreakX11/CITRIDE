import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import {
  Droplet,
  Zap,
  Hospital,
  RadioTower,
  Landmark,
  Truck,
  Factory,
  Flame,
  Shield,
  Building2,
} from "lucide-react";
import {
  infrastructureKind,
  infrastructureLabel,
} from "../src/infrastructureIcons.ts";
import { idtSectorName } from "../src/idt.ts";

// Compile TSX in memory and resolve real package imports, as c2-footprint does.
async function compile(url) {
  let { code } = await transformWithOxc(
    readFileSync(url, "utf8"),
    url.pathname,
    {
      jsx: { runtime: "automatic" },
    },
  );
  const imports = new Map();
  for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    imports.set(
      specifier,
      specifier.startsWith(".")
        ? /\.tsx$/.test(specifier)
          ? await compile(new URL(specifier, url))
          : new URL(specifier, url).href
        : import.meta.resolve(specifier),
    );
  }
  code = code.replace(
    /from\s+["']([^"']+)["']/g,
    (_match, specifier) => `from ${JSON.stringify(imports.get(specifier))}`,
  );
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const iconModule = await import(
  await compile(new URL("../src/InfrastructureIcon.tsx", import.meta.url))
);
const { InfrastructureIcon } = iconModule;
const render = (props) =>
  renderToStaticMarkup(createElement(InfrastructureIcon, props));

const supplied = JSON.parse(
  readFileSync(
    new URL("../../data/scripted/watershed_beta.json", import.meta.url),
    "utf8",
  ),
);
test("supplied statewide incident subjects determine their infrastructure icons", () => {
  assert.deepEqual(supplied.incidents.map(infrastructureKind), [
    "water",
    "government",
    "communications",
    "health",
    "government",
  ]);
});

const cases = [
  [
    "water incident overrides downstream health sector",
    { title: "Water utility cyber attack", sectors: ["12", "10"] },
    "water",
  ],
  [
    "hospital outage",
    { title: "Hospital system IT outage", sectors: ["10"] },
    "health",
  ],
  [
    "city ransomware",
    {
      title: "Ransomware on city network",
      incidentType: "Ransomware",
      sectors: ["15"],
    },
    "government",
  ],
  [
    "county emergency alert",
    { title: "DDoS on county emergency-alert site", sectors: ["6"] },
    "communications",
  ],
  [
    "state agency phishing",
    { title: "Phishing at a state agency", sectors: ["15"] },
    "government",
  ],
  [
    "hospital losing water remains healthcare",
    {
      title: "Hospital losing water service",
      summary: "Water utility outage",
      sectors: ["12", "10"],
    },
    "health",
  ],
  [
    "hospital summary water does not override",
    {
      title: "Hospital network outage",
      summary: "Water outage downstream",
      sectors: ["12"],
    },
    "health",
  ],
  [
    "power station ignores water summary",
    {
      title: "Power station outage",
      summary: "Loss of water to hospital",
      sectors: ["12", "10"],
    },
    "power",
  ],
  [
    "generic unrelated summary ignored",
    {
      title: "Unclassified incident",
      summary: "Water, hospital, power and telecom",
      relatedNote: "Water utility",
      sectors: [],
    },
    "facility",
  ],
  [
    "title has priority over other subject fields",
    {
      title: "Water service incident",
      name: "Hospital Y",
      label: "Power station",
      sectors: ["10"],
    },
    "water",
  ],
  [
    "type resolves linked utility marker",
    {
      title: "Utility A · probed",
      name: "Utility A",
      type: "WaterServiceProvider",
    },
    "water",
  ],
  [
    "generic utility names are not invented water evidence",
    { title: "Utility A · probed" },
    "facility",
  ],
  ["short primary name", { short: "Water treatment" }, "water"],
  [
    "incident type subject",
    {
      title: "Incident 42",
      incidentType: "Cyber attack on a water utility",
      sectors: ["10"],
    },
    "water",
  ],
  ["water provider", { type: "WaterServiceProvider" }, "water"],
  ["treatment plant", { type: "TreatmentPlant" }, "water"],
  ["wastewater provider", { name: "Wastewater provider" }, "water"],
  ["electric substation", { type: "ElectricSubstation" }, "power"],
  ["electric supply", { type: "ElectricSupplyFacility" }, "power"],
  ["gas provider", { type: "GasProvider", sectors: ["5"] }, "gas"],
  ["natural gas", { title: "Natural gas pipeline outage" }, "gas"],
  ["hospital type", { type: "Hospital" }, "health"],
  ["health facility", { type: "HealthcareFacility" }, "health"],
  ["dialysis", { type: "DialysisCenter" }, "health"],
  ["nursing home", { type: "NursingHome" }, "health"],
  ["telecom", { name: "Telecommunications carrier" }, "communications"],
  ["radio tower", { type: "RadioTower" }, "communications"],
  ["city network", { label: "City network" }, "government"],
  ["municipal", { name: "Municipal services" }, "government"],
  ["highway", { title: "Highway control outage" }, "transport"],
  ["transportation", { type: "TransportationFacility" }, "transport"],
  ["factory", { name: "Factory network" }, "industry"],
  ["manufacturing", { type: "ManufacturingFacility" }, "industry"],
  ["ransomware without a subject", { title: "Ransomware detected" }, "cyber"],
  ["IT as a word", { title: "IT outage" }, "cyber"],
  [
    "no broad it substring",
    { title: "Critical site visibility incident" },
    "facility",
  ],
  ["no broad gas substring", { name: "Las Vegas facility" }, "facility"],
  ["empty record", {}, "facility"],
];
for (const [name, item, expected] of cases) {
  test(`classification: ${name}`, () => {
    const before = structuredClone(item);
    Object.freeze(item.sectors);
    Object.freeze(item);
    assert.equal(infrastructureKind(item), expected);
    assert.deepEqual(item, before);
  });
}

const sectors = [
  ["5", "Energy", "power"],
  ["6", "Emergency Services", "facility"],
  ["7", "Information Technology", "cyber"],
  ["8", "Communications", "communications"],
  ["9", "Postal and Shipping", "transport"],
  ["10", "Healthcare and Public Health", "health"],
  ["11", "Transportation", "transport"],
  ["12", "Water", "water"],
  ["15", "Government Facilities", "government"],
  ["18", "Manufacturing", "industry"],
];
for (const [sector, label, expected] of sectors) {
  test(`verified IDT sector fallback: ${sector} ${label}`, () => {
    assert.equal(idtSectorName(sector), label);
    assert.equal(
      infrastructureKind({ title: "Unclassified incident", sectors: [sector] }),
      expected,
    );
  });
}
test("sector subject wins over a generic cyber incident type", () => {
  assert.equal(
    infrastructureKind({ title: "Phishing", sectors: ["15"] }),
    "government",
  );
  assert.equal(
    infrastructureKind({ title: "Ransomware", sectors: ["12"] }),
    "water",
  );
  assert.equal(infrastructureKind({ sectors: ["999"] }), "facility");
});

const icons = {
  water: [Droplet, "Water"],
  power: [Zap, "Power"],
  health: [Hospital, "Healthcare"],
  communications: [RadioTower, "Communications"],
  government: [Landmark, "Government"],
  transport: [Truck, "Transportation"],
  industry: [Factory, "Industry"],
  gas: [Flame, "Gas"],
  cyber: [Shield, "Cybersecurity"],
  facility: [Building2, "Facility"],
};
for (const [kind, [Icon, label]] of Object.entries(icons)) {
  test(`real SSR: ${kind} renders its local Lucide SVG at 24px`, () => {
    assert.equal(infrastructureLabel(kind), label);
    const html = render({ kind });
    const expected = renderToStaticMarkup(
      createElement(Icon, {
        size: 24,
        className: "infrastructure-icon",
        "aria-hidden": true,
        focusable: false,
        "data-infrastructure-icon": kind,
      }),
    );
    assert.equal(html, expected);
    assert.match(html, /^<svg\s/);
    assert.match(html, /width="24"/);
    assert.match(html, /height="24"/);
    assert.match(html, /viewBox="0 0 24 24"/);
    assert.match(html, /stroke="currentColor"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /focusable="false"/);
    assert.match(html, /<(?:path|circle|rect|line|polyline|polygon)\s/);
    assert.doesNotMatch(
      html,
      /<(?:img|image|use|foreignObject)\b|\b(?:href|src)=/,
    );
  });
}
test("custom size and class preserve base styling and icon metadata", () => {
  const html = render({
    kind: "water",
    size: 18,
    className: "map-symbol accent",
  });
  assert.match(html, /width="18"/);
  assert.match(html, /height="18"/);
  assert.match(html, /class="[^"]*infrastructure-icon map-symbol accent/);
  assert.match(html, /data-infrastructure-icon="water"/);
});
test("icons can render as nested SVGs in a map marker", () => {
  const html = renderToStaticMarkup(
    createElement(
      "svg",
      { viewBox: "0 0 44 44" },
      createElement(
        "g",
        { transform: "translate(10 10)" },
        createElement(InfrastructureIcon, { kind: "power" }),
      ),
    ),
  );
  assert.equal((html.match(/<svg\b/g) ?? []).length, 2);
  assert.match(html, /<g transform="translate\(10 10\)"><svg/);
  assert.match(html, /data-infrastructure-icon="power"/);
});
