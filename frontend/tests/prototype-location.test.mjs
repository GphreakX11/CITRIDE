import test from "node:test";
import assert from "node:assert/strict";
import {
  prototypeLocation,
  readPrototypeLocation,
} from "../src/prototypeLocation.ts";
import { modeForView, modeLanding, advancedViews } from "../src/navigation.ts";
import { commandNavigation, analystNavigation } from "../src/commandTypes.ts";
test("command-only Brief and partner destinations normalize from Analyst mode", () => {
  for (const view of ["leadership", "federation"]) {
    assert.equal(modeForView(view, "analyst"), "command");
    const explicit = readPrototypeLocation(
      `/?mode=analyst&view=${view}&case=case-a&entity=utility-a&focus=1`,
    );
    assert.equal(explicit.mode, "command");
    assert.equal(explicit.view, view);
    assert.equal(explicit.caseId, "case-a");
    const next = readPrototypeLocation(
      prototypeLocation(
        "/?existing=keep",
        view,
        "utility-a",
        "case-a",
        "analyst",
      ),
    );
    assert.equal(next.mode, "command");
    assert.equal(next.entityId, "utility-a");
  }
});
test("all allowed destinations resolve to a renderer in their normalized mode", () => {
  const analystDetails = ["case-file", "entity-profile"];
  for (const mode of ["analyst", "command"]) {
    for (const view of [
      ...new Set([...commandNavigation, ...analystNavigation].map((n) => n.id)),
      ...analystDetails,
      ...advancedViews,
    ]) {
      const normalized = modeForView(view, mode);
      const renderers =
        normalized === "command"
          ? commandNavigation.map((n) => n.id)
          : [
              ...analystNavigation.map((n) => n.id),
              ...analystDetails,
              ...advancedViews,
            ];
      assert.ok(
        renderers.includes(view),
        `${mode}:${view} normalized to ${normalized} without a renderer`,
      );
    }
  }
});
test("view, mode and explicit focus roundtrip without losing unrelated URL fields", () => {
  const url = prototypeLocation(
    "https://local.invalid/?existing=keep",
    "consequence",
    "plant-a",
    "case:123",
    "analyst",
  );
  assert.deepEqual(readPrototypeLocation(url), {
    view: "consequence",
    mode: "analyst",
    entityId: "plant-a",
    caseId: "case:123",
    explicitFocus: true,
  });
  assert.ok(url.includes("existing=keep"));
});
test("clear focus is explicit and malformed ids/views are rejected", () => {
  assert.deepEqual(
    readPrototypeLocation(
      prototypeLocation(
        "/?case=old&entity=old",
        "cyber",
        null,
        null,
        "analyst",
      ),
    ),
    {
      view: "cyber",
      mode: "analyst",
      entityId: null,
      caseId: null,
      explicitFocus: true,
    },
  );
  assert.equal(
    readPrototypeLocation(
      "/?view=malicious&entity=%3Cscript%3E&case=" + "x".repeat(129),
    ).caseId,
    null,
  );
  assert.equal(readPrototypeLocation("/?view=malicious").view, "command");
});
test("command mode is default and incompatible deep links select analyst without hiding tools", () => {
  assert.equal(readPrototypeLocation("/").mode, "command");
  for (const view of advancedViews)
    assert.equal(
      readPrototypeLocation(`/?view=${view}&mode=command`).mode,
      "analyst",
    );
  for (const view of ["case-file", "entity-profile", "coordination"])
    assert.equal(modeForView(view, "command"), "analyst");
  assert.equal(readPrototypeLocation("/?mode=bogus").mode, "command");
});
test("each mode has its own sidebar and a safe landing when switching", () => {
  assert.deepEqual(
    commandNavigation.map((n) => n.code),
    ["C1", "C2", "C3", "C4", "C5", "C6", "C7"],
  );
  assert.deepEqual(
    analystNavigation.map((n) => n.code),
    ["A1", "A2", "A3", "A4", "A5", "A6"],
  );
  assert.equal(modeLanding("command", "lab", true), "command");
  assert.equal(modeLanding("analyst", "leadership", true), "case-file");
  assert.equal(modeLanding("analyst", "federation", false), "command");
  for (const v of ["command", "cop", "cyber", "consequence", "uctf"])
    assert.equal(modeLanding("analyst", v, true), v);
});
