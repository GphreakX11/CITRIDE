import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import {
  networkStreams,
  orderedFields,
  visibleRecords,
  networkSource,
  ctTime,
  jsonlExport,
  huntEvidence,
  evidenceRefs,
} from "../src/networkEvidence.ts";

const write = {
  id: "write",
  ts: 1791874800,
  "id.orig_h": "192.0.2.240",
  address: 40011,
  values: [4],
  relativeTimeHours: 0,
  utilityId: "utility-a",
  origin: "simulated",
  unexpected: { preserve: true },
};
const events = [
  {
    id: "event-dosing",
    label: "Dosing change",
    timestamp: "2026-10-13T07:00:00Z",
    rawRef: { streamId: "controller", recordId: "audit" },
    networkEvidenceRefs: [
      { streamId: "corelight/modbus_detailed", recordId: "write" },
    ],
  },
];
const stream = {
  id: "corelight/modbus_detailed",
  label: "Detailed",
  sourceRef: "src-network",
  origin: "simulated",
  records: [
    ...Array.from({ length: 220 }, (_, i) => ({
      id: `normal-${i}`,
      ts: 1791874800,
    })),
    write,
  ],
};
test("all eleven selectors and standard/unknown/CITRIDE ordering preserve raw data", () => {
  assert.equal(networkStreams.length, 11);
  assert.deepEqual(
    networkStreams.map((s) => s.id),
    [
      "corelight/conn",
      "corelight/ssl",
      "corelight/http",
      "corelight/dns",
      "corelight/modbus",
      "corelight/modbus_detailed",
      "corelight/notice",
      "corelight/vpn",
      "controller",
      "sensors",
      "enterprise",
    ],
  );
  assert.deepEqual(orderedFields(stream), [
    "ts",
    "id.orig_h",
    "address",
    "values",
    "unexpected",
    "id",
    "relativeTimeHours",
    "utilityId",
    "origin",
  ]);
  assert.deepEqual(evidenceRefs(events[0]), [
    events[0].rawRef,
    ...events[0].networkEvidenceRefs,
  ]);
});
test("late linked writes are highlighted/reachable before cap and full JSONL retains all fields", () => {
  const rows = visibleRecords(stream, events, 200);
  assert.equal(rows.length, 200);
  assert.equal(rows[0].record, write);
  assert.equal(rows[0].linked, true);
  const exported = jsonlExport(stream);
  const parsed = exported.contents.trim().split("\n").map(JSON.parse);
  assert.equal(parsed.length, 221);
  assert.deepEqual(parsed.at(-1), write);
  assert.match(exported.filename, /\.jsonl$/);
  assert.match(ctTime("2026-10-13T07:00:00Z"), /02:00.*CT/);
});
test("metadata-free real rows never inherit simulated provenance or asset mapping", () => {
  assert.equal(
    networkSource(stream, { ts: 1791874800 }),
    "Network · Corelight format · provenance unknown",
  );
  assert.equal(
    networkSource(stream, write),
    "Network · Corelight format (simulated)",
  );
  assert.equal(
    networkSource({ id: "corelight/vpn" }, { origin: "simulated" }),
    "VPN log (simulated)",
  );
});
const conn = (id, utilityId, source, state) => ({
  id,
  utilityId,
  "id.orig_h": source,
  conn_state: state,
  ts: 1791874800,
});
const telemetry = {
  streams: [
    {
      id: "corelight/conn",
      records: [
        conn("a", "utility-a", "203.0.113.250", "SF"),
        conn("b", "utility-b", "203.0.113.250", "S0"),
        conn("c", "utility-c", "203.0.113.250", "REJ"),
        conn("normal", "utility-b", "192.0.2.22", "SF"),
      ],
    },
    {
      id: "corelight/vpn",
      records: [
        {
          id: "vpn",
          user: "vendor-v-support",
          source_ip: "203.0.113.250",
          ts: 1791874800,
          utilityId: "utility-a",
        },
        {
          id: "day",
          user: "vendor-v-support",
          source_ip: "203.0.113.250",
          timestamp: "2026-10-13T18:00:00Z",
        },
      ],
    },
  ],
};
test("hunts evaluate actual rows and exclude background SF from completed attacker sessions", () => {
  const source = huntEvidence(telemetry, "shared-source");
  assert.equal(source.results.length, 5);
  assert.deepEqual(
    source.utilities.map((u) => [u.utilityId, u.completed, u.probes]),
    [
      ["utility-a", 1, 0],
      ["utility-b", 0, 1],
      ["utility-c", 0, 1],
    ],
  );
  assert.equal(huntEvidence(telemetry, "vendor-account").results.length, 2);
  assert.equal(huntEvidence(telemetry, "off-hours").results.length, 4);
  assert.equal(
    huntEvidence({ streams: [] }, "shared-source").results.length,
    0,
  );
});
test("generated supplied streams resolve detailed 02:00 write and preserve A-completed/B+C-probe distinction", () => {
  const data = JSON.parse(
    readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
  );
  const streams = networkStreams
    .filter((stream) => stream.id.startsWith("corelight/"))
    .map((stream) => ({
      ...stream,
      sourceRef: "src-network",
      records: JSON.parse(
        readFileSync(
          new URL(`../../data/telemetry/${stream.id}.json`, import.meta.url),
          "utf8",
        ),
      ),
    }));
  const detailed = streams.find(
    (stream) => stream.id === "corelight/modbus_detailed",
  );
  const linked = visibleRecords(detailed, data.events).find(
    (row) => row.linked && row.record.address === 40011,
  );
  assert.ok(linked);
  assert.equal(ctTime(linked.record.ts), "02:00 CT");
  assert.deepEqual(linked.record.values, [4]);
  const result = huntEvidence({ streams }, "shared-source");
  assert.ok(
    result.utilities.find((utility) => utility.utilityId === "utility-a")
      .completed > 0,
  );
  for (const id of ["utility-b", "utility-c"]) {
    const utility = result.utilities.find(
      (utility) => utility.utilityId === id,
    );
    assert.equal(utility.completed, 0);
    assert.ok(utility.probes > 0);
  }
  assert.ok(huntEvidence({ streams }, "vendor-account").results.length > 0);
  assert.ok(huntEvidence({ streams }, "off-hours").results.length > 0);
});
async function loadComponent() {
  let code = (
    await transformWithOxc(
      readFileSync(
        new URL("../src/NetworkEvidence.tsx", import.meta.url),
        "utf8",
      ),
      "NetworkEvidence.tsx",
      { jsx: { runtime: "automatic" } },
    )
  ).code;
  code = code
    .replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "")
    .replace(
      /from\s+["']([^"']+)["']/g,
      (_m, s) =>
        `from ${JSON.stringify(s.startsWith(".") ? new URL(s, new URL("../src/NetworkEvidence.tsx", import.meta.url)).href : import.meta.resolve(s))}`,
    );
  return (
    await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    )
  ).default;
}
test("actual component renders supplied timeline, raw write, all selectors and computed hunt", async () => {
  const Component = await loadComponent();
  const data = { events, incidentOrigin: "2026-10-13T07:00:00Z" };
  const render = (initialTab, t = { streams: [stream] }) =>
    renderToStaticMarkup(
      createElement(Component, {
        data,
        telemetry: t,
        initialTab,
        initialStreamId: stream.id,
      }),
    );
  assert.match(render("timeline"), /Dosing change/);
  assert.match(render("timeline"), /02:00 CT/);
  const raw = render("raw");
  assert.match(raw, /aria-label="Event-linked records"/);
  assert.match(raw, /Address 40011/);
  assert.match(raw, /Values \[4\]/);
  assert.match(raw, /40011/);
  assert.match(raw, /data-event-linked="true"/);
  assert.match(raw, /221 records/);
  assert.match(raw, /provenance unknown/);
  assert.match(raw, /Unmapped/);
  assert.equal((raw.match(/<option/g) || []).length, 11);
  assert.match(render("hunt", telemetry), /utility-a.*1 completed/s);
  assert.match(render("hunt", telemetry), /utility-b.*0 completed.*1 probes/s);
});
