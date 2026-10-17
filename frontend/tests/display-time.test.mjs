import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTimeCT,
  formatDuration,
  formatDueTime,
  formatElapsed,
} from "../src/displayTime.ts";

test("timestamps use Central time with midnight and daylight-saving handled", () => {
  assert.equal(formatTimeCT("2026-11-17T09:10:00Z"), "03:10 CT");
  assert.equal(formatTimeCT("2026-07-17T08:10:00Z"), "03:10 CT");
  assert.equal(formatTimeCT("2026-11-17T06:00:00Z"), "00:00 CT");
  for (const value of [
    null,
    undefined,
    "",
    "not-a-date",
    "03:10",
    "2026-11-17T03:10:00",
  ]) {
    assert.equal(formatTimeCT(value), "—");
  }
});

test("durations are compact and preserve unknown instead of inventing zero", () => {
  assert.equal(formatDuration(102), "1h 42m");
  assert.equal(formatDuration(1320), "22h");
  assert.equal(formatDuration(24), "24m");
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(1.9), "1m");
  for (const value of [null, undefined, NaN, Infinity, -1])
    assert.equal(formatDuration(value), "—");
});

test("elapsed and due times derive only from supplied source values", () => {
  assert.equal(
    formatElapsed("2026-11-17T07:30:00Z", "2026-11-17T09:12:00Z"),
    "1h 42m",
  );
  assert.equal(formatElapsed(null, "2026-11-17T09:12:00Z"), "—");
  assert.equal(
    formatElapsed("2026-11-17T09:12:00Z", "2026-11-17T07:30:00Z"),
    "—",
  );
  assert.equal(formatDueTime("2026-11-17T10:00:00Z"), "Due 04:00 CT");
  assert.equal(formatDueTime(null), "Due —");
});
