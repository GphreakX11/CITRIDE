import test from "node:test";
import assert from "node:assert/strict";
import { nodeLabels } from "../src/texasLabels.ts";
import { mapPositions, infrastructureIds } from "../src/texasGraph.ts";
import { TEXAS_PATH } from "../src/texasOutline.ts";
import { readFileSync } from "node:fs";

const seed = JSON.parse(
  readFileSync(new URL("../../data/scenario.json", import.meta.url), "utf8"),
);

test("labels avoid overlapping rows without altering source nodes", () => {
  const nodes = Object.freeze([
    Object.freeze({ id: "nursing", x: 395, y: 225, label: "Nursing Home Z" }),
    Object.freeze({
      id: "dialysis",
      x: 505,
      y: 230,
      label: "Dialysis Center X",
    }),
    Object.freeze({
      id: "plant-c",
      x: 695,
      y: 455,
      label: "Treatment Plant C",
    }),
    Object.freeze({ id: "utility-c", x: 785, y: 460, label: "Utility C" }),
  ]);
  const first = nodeLabels(nodes),
    second = nodeLabels([...nodes].reverse());
  assert.deepEqual([...first], [...second]);
  const labels = [...first.values()];
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i],
        b = labels[j];
      assert.ok(
        Math.abs(a.x - b.x) * 2 >= a.width + b.width ||
          Math.abs(a.y - b.y) * 2 >= a.height + b.height,
      );
    }
  assert.equal(nodes[0].y, 225);
});

test("selected label has priority, long names remain bounded with full record unchanged", () => {
  const nodes = [
    {
      id: "long",
      x: 20,
      y: 5,
      label: "Very long infrastructure entity name with original provenance",
    },
    { id: "other", x: 20, y: 5, label: "Other entity" },
  ];
  const labels = nodeLabels(nodes, "long");
  assert.equal([...labels.keys()][0], "long");
  assert.ok(labels.get("long").text.endsWith("…"));
  for (const label of labels.values()) {
    assert.ok(Number.isFinite(label.x) && Number.isFinite(label.y));
    assert.ok(
      label.x - label.width / 2 >= 0 && label.x + label.width / 2 <= 960,
    );
    assert.ok(label.y >= 0 && label.y <= 720);
  }
  assert.equal(
    nodes[0].label,
    "Very long infrastructure entity name with original provenance",
  );
});

test("all reference infrastructure display centers lie within real Texas outline", () => {
  const polygon = [...TEXAS_PATH.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(
    (m) => [Number(m[1]), Number(m[2])],
  );
  assert.equal(polygon.length, 152);
  const inside = (x, y) => {
    let hit = false,
      j = polygon.length - 1;
    for (let i = 0; i < polygon.length; i++) {
      const [xi, yi] = polygon[i],
        [xj, yj] = polygon[j];
      if (yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        hit = !hit;
      j = i;
    }
    return hit;
  };
  const positions = mapPositions(seed.entities);
  for (const id of infrastructureIds(seed)) {
    const point = positions.get(id);
    assert.ok(
      inside(point.x, point.y),
      `Illustrative display center ${id} should be over Texas`,
    );
  }
});
