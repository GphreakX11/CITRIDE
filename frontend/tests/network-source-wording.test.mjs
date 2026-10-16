import test from "node:test";
import assert from "node:assert/strict";
import {
  networkSource,
  compactNetworkSource,
  streamSourceLabel,
} from "../src/networkEvidence.ts";
test("raw table states full origin once and keeps every per-record provenance distinction", () => {
  const stream = {
    id: "corelight/conn",
    label: "conn",
    sourceRef: "src-network",
    origin: "simulated",
    records: [
      { id: "a", origin: "simulated" },
      { id: "b", origin: "simulated" },
    ],
  };
  const before = JSON.stringify(stream);
  assert.equal(
    streamSourceLabel(stream),
    "Network · Corelight format (simulated)",
  );
  assert.equal(
    compactNetworkSource(stream, stream.records[0]),
    "Network (simulated)",
  );
  const missing = { id: "missing" };
  assert.equal(
    networkSource(stream, missing),
    "Network · Corelight format · provenance unknown",
  );
  assert.equal(
    compactNetworkSource(stream, missing),
    "Network · provenance unknown",
  );
  assert.equal(
    streamSourceLabel({ ...stream, records: [...stream.records, missing] }),
    "Mixed record provenance",
  );
  assert.equal(JSON.stringify(stream), before);
});
