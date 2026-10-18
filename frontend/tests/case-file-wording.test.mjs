import "./configured-time-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  caseDisplayId,
  caseFileHeader,
  caseFileTabs,
  recordNoun,
} from "../src/caseFilePresentation.ts";
import { activityDisplayText } from "../src/caseFilePresentation.ts";
test("generated activity copy is concise while recorded notes and source messages stay intact", () => {
  const raw =
    "Modeled consequence reviewed locally; authority not configured and formal gate not evaluated. PRIVATE NOTE";
  assert.equal(
    activityDisplayText(raw),
    "Impact review recorded. PRIVATE NOTE",
  );
  assert.equal(
    activityDisplayText(
      "Immutable conditional consequence analysis captured; no observed impact or formal gate pass is asserted.",
    ),
    "Analysis recorded.",
  );
  assert.equal(
    activityDisplayText("Authored update · keep exact wording"),
    "Authored update · keep exact wording",
  );
  assert.ok(raw.includes("authority not configured"));
});
const incident = {
  id: "private-internal-case",
  title: "Case title",
  version: 9,
  createdAt: "2026-10-13T03:05:00-05:00",
  eventId: "event-vpn-a",
  eventSnapshot: {
    id: "event-vpn-a",
    label: "Offsite vendor VPN login at Utility A",
    observation: "offsite_vpn_login",
  },
  decisions: [{ reviewed: true }, { reviewed: false }, { reviewed: false }],
  tasks: [{ completed: true }, { completed: false }],
};
const records = {
  statewideIncidents: [
    { id: "TX-26-0412", caseId: incident.id, linkedEventIds: ["event-vpn-a"] },
  ],
};
test("case header uses explicit public incident ID, actual version/opened time and source alert", () => {
  const before = JSON.stringify({ incident, records });
  assert.equal(caseDisplayId(incident, records), "TX-26-0412");
  assert.equal(
    caseFileHeader(incident, records),
    "CASE FILE · TX-26-0412 · version 9 · opened 03:05 CDT from the vendor VPN alert",
  );
  assert.ok(!caseFileHeader(incident, records).includes(incident.id));
  assert.equal(JSON.stringify({ incident, records }), before);
});
test("alternate IDs are not hardcoded and missing/foreign links never expose internal IDs", () => {
  assert.equal(
    caseDisplayId(incident, {
      statewideIncidents: [
        { ...records.statewideIncidents[0], id: "ALT-26-0123" },
      ],
    }),
    "ALT-26-0123",
  );
  assert.equal(
    caseDisplayId(incident, {
      statewideIncidents: [
        {
          id: "TX-26-9999",
          caseId: "another-case",
          linkedEventIds: ["event-vpn-a"],
        },
      ],
    }),
    null,
  );
  assert.equal(
    caseDisplayId(incident, {
      statewideIncidents: [{ id: "case:" + incident.id, caseId: incident.id }],
    }),
    null,
  );
  assert.ok(!caseFileHeader(incident, null).includes(incident.id));
});
test("section labels/counts derive from actual records and retain section IDs plus Case status", () => {
  const tabs = caseFileTabs(incident);
  assert.deepEqual(
    tabs.map((t) => t.id),
    [
      "context",
      "cyber",
      "consequence",
      "decisions",
      "tasks",
      "notes",
      "activity",
      "status",
      "advanced",
    ],
  );
  assert.deepEqual(
    tabs.map((t) => t.label),
    [
      "Context",
      "Cyber Evidence",
      "Consequences",
      "Reviews 1/3",
      "Tasks 1/2",
      "Notes",
      "Activity",
      "Case status",
      "Advanced",
    ],
  );
  assert.equal(
    caseFileTabs({ ...incident, decisions: [], tasks: [] }).find(
      (t) => t.id === "decisions",
    ).label,
    "Reviews 0/0",
  );
});
test("record nouns name the supplied type, not a generic entity or invented service", () => {
  for (const [type, label, want] of [
    ["WaterServiceProvider", "Utility A", "utility"],
    ["TreatmentPlant", "Plant A", "plant"],
    ["Hospital", "Hospital Y", "facility"],
    ["PhysicalOTAsset", "Dosing controller", "controller"],
  ])
    assert.equal(recordNoun({ type, label }), want);
});
