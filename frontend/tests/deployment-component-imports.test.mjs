import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const [host, component] of [
  ["App.tsx", "NetworkEvidence"],
  ["App.tsx", "OntologyBlueprint"],
  ["CommandReadouts.tsx", "NetworkEvidence"],
  ["CommandReadouts.tsx", "AnalystAlerts"],
]) {
  test(`${host} explicitly resolves ${component} as a TSX component`, () => {
    const source = readFileSync(new URL(`../src/${host}`, import.meta.url), "utf8");
    assert.match(
      source,
      new RegExp(`import ${component} from ["']\\./${component}\\.tsx["']`),
    );
    const componentSource = readFileSync(
      new URL(`../src/${component}.tsx`, import.meta.url),
      "utf8",
    );
    assert.match(componentSource, new RegExp(`export default function ${component}\\(`));
  });
}
