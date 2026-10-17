import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEXAS_PATH } from "../src/texasOutline.ts";
import {
  texasMarkerLayout,
  projectTexasPoint,
  containedTexasAnchor,
  texasContainsMarker,
  TexasMarkerCapacityError,
  incidentMarkerLayout,
} from "../src/incidentMarkerLayout.ts";

// Independent oracle reads the exact vendored polygon, then verifies all four
// expanded corners, samples its complete perimeter, and checks every boundary
// vertex/segment for intrusions. A bounding rectangle alone cannot pass this.
const outline = [...TEXAS_PATH.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(
  ([, x, y]) => ({ x: Number(x), y: Number(y) }),
);
function polygon(width, height) {
  const scale = Math.min(width / 1000, height / 700);
  return outline.map((p) => ({
    x: p.x * scale + (width - 1000 * scale) / 2,
    y: p.y * scale + (height - 700 * scale) / 2,
  }));
}
function inside(point, boundary) {
  let crossings = 0;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length];
    if (
      (a.y <= point.y && b.y > point.y) ||
      (b.y <= point.y && a.y > point.y)
    ) {
      if (a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x) > point.x)
        crossings++;
    }
  }
  return crossings % 2 === 1;
}
function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function properIntersection(a, b, c, d) {
  return (
    cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  );
}
function assertContained(point, width, height, markerSize = 44) {
  const boundary = polygon(width, height);
  const half = markerSize / 2 + 2;
  const corners = [
    { x: point.x - half, y: point.y - half },
    { x: point.x + half, y: point.y - half },
    { x: point.x + half, y: point.y + half },
    { x: point.x - half, y: point.y + half },
  ];
  for (let side = 0; side < 4; side++) {
    const a = corners[side],
      b = corners[(side + 1) % 4];
    for (let sample = 0; sample <= 48; sample++) {
      assert.ok(
        inside(
          {
            x: a.x + ((b.x - a.x) * sample) / 48,
            y: a.y + ((b.y - a.y) * sample) / 48,
          },
          boundary,
        ),
        `expanded marker perimeter outside Texas at ${point.x},${point.y}`,
      );
    }
    for (let i = 0; i < boundary.length; i++) {
      assert.equal(
        properIntersection(
          a,
          b,
          boundary[i],
          boundary[(i + 1) % boundary.length],
        ),
        false,
      );
    }
  }
  for (const vertex of boundary) {
    assert.equal(
      vertex.x > point.x - half &&
        vertex.x < point.x + half &&
        vertex.y > point.y - half &&
        vertex.y < point.y + half,
      false,
      "concave boundary enters square",
    );
  }
  assert.equal(texasContainsMarker(point, width, height, markerSize), true);
}
function assertLayout(points, width, height, markerSize = 44) {
  const placed = texasMarkerLayout(points, width, height, markerSize);
  assert.equal(placed.length, points.length);
  placed.forEach((marker, i) => {
    assert.equal(marker.id, points[i].id);
    for (const key of [
      "x",
      "y",
      "sourceX",
      "sourceY",
      "offsetX",
      "offsetY",
      "anchorX",
      "anchorY",
    ])
      assert.ok(Number.isFinite(marker[key]));
    const raw = projectTexasPoint(points[i], width, height);
    assert.equal(marker.sourceX, raw.x);
    assert.equal(marker.sourceY, raw.y);
    assert.equal(marker.offsetX, marker.x - raw.x);
    assert.equal(marker.offsetY, marker.y - raw.y);
    assert.equal(marker.indicative, true);
    assertContained(marker, width, height, markerSize);
    assertContained(
      { x: marker.anchorX, y: marker.anchorY },
      width,
      height,
      markerSize,
    );
    for (const other of placed.slice(0, i)) {
      assert.ok(
        Math.abs(marker.x - other.x) >= markerSize + 4 ||
          Math.abs(marker.y - other.y) >= markerSize + 4,
        "hit targets overlap or lose 4px spacing",
      );
    }
  });
  assert.deepEqual(
    texasMarkerLayout(points, width, height, markerSize),
    placed,
  );
  const reversed = texasMarkerLayout(
    [...points].reverse(),
    width,
    height,
    markerSize,
  );
  assert.deepEqual(
    [...reversed].reverse(),
    placed,
    "ID placement is independent of record order",
  );
  return placed;
}
const coincident = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `marker-${String(i).padStart(2, "0")}`,
    x: 50,
    y: 50,
  }));

test("uniform xMidYMid meet projection includes letterboxing instead of stretching percentages", () => {
  assert.deepEqual(projectTexasPoint({ x: 50, y: 50 }, 320, 300), {
    x: 160,
    y: 150,
  });
  assert.deepEqual(projectTexasPoint({ x: 0, y: 0 }, 320, 300), {
    x: 0,
    y: 38,
  });
  assert.deepEqual(projectTexasPoint({ x: 100, y: 100 }, 320, 300), {
    x: 320,
    y: 262,
  });
  const result = projectTexasPoint({ x: 30, y: 20 }, 900, 450);
  const scale = 450 / 700;
  assert.equal(result.x, (900 - 1000 * scale) / 2 + 30 * (10 * scale));
  assert.ok(Math.abs(result.y - 20 * (7 * scale)) < 1e-10);
});

test("five mobile incident markers fit the actual Texas polygon at 320×300", () => {
  const records = JSON.parse(
    readFileSync(
      new URL("../../data/scripted/watershed_beta.json", import.meta.url),
      "utf8",
    ),
  );
  const points = records.incidents.map((item) => ({
    id: item.id,
    ...(item.schematic ?? item.location?.schematic),
  }));
  assert.equal(points.length, 5);
  assertLayout(points, 320, 300);
  assertLayout(coincident(5), 320, 300);
});

test("seven coincident markers and fifteen incident/team markers fit at 900×450", () => {
  assertLayout(coincident(7), 900, 450);
  assertLayout(coincident(15), 900, 450);
});

test("outside and boundary source anchors stay immutable; safe indicative anchors replace misleading location dots", () => {
  const points = Object.freeze([
    Object.freeze({ id: "outside-west", x: -20, y: 50 }),
    Object.freeze({ id: "outside-east", x: 120, y: 60 }),
    Object.freeze({ id: "corner", x: 0, y: 0 }),
    Object.freeze({ id: "panhandle-boundary", x: 30.466, y: 6.54 }),
    Object.freeze({ id: "coast-boundary", x: 64.61, y: 643.95 / 7 }),
  ]);
  const before = structuredClone(points);
  for (const [width, height] of [
    [320, 300],
    [900, 450],
  ]) {
    const placed = assertLayout(points, width, height);
    assert.ok(placed.every((p) => p.sourceAdjusted));
    points.forEach((point, i) => {
      const safe = containedTexasAnchor(point, width, height);
      assert.equal(safe.adjusted, true);
      assert.equal(safe.indicative, true);
      assert.equal(safe.x, placed[i].anchorX);
      assert.equal(safe.y, placed[i].anchorY);
    });
  }
  assert.deepEqual(points, before);
});

test("already contained and spaced source points retain their exact raw projection", () => {
  const packed = texasMarkerLayout(coincident(3), 900, 450);
  const scale = 450 / 700,
    ox = (900 - 1000 * scale) / 2;
  const points = packed.map((p) => ({
    id: p.id,
    x: (p.x - ox) / scale / 10,
    y: p.y / scale / 7,
  }));
  const result = assertLayout(points, 900, 450);
  for (const marker of result) {
    assert.equal(marker.offsetX, 0);
    assert.equal(marker.offsetY, 0);
    assert.equal(marker.sourceAdjusted, false);
  }
});

test("impossible mobile density fails explicitly, never silently overlaps or drops records", () => {
  for (const count of [7, 15, 100]) {
    assert.throws(
      () => texasMarkerLayout(coincident(count), 320, 300),
      (error) => {
        assert.ok(error instanceof TexasMarkerCapacityError);
        assert.equal(error.requested, count);
        assert.equal(error.capacity, 5);
        assert.equal(error.width, 320);
        assert.equal(error.height, 300);
        assert.equal(error.markerSize, 44);
        assert.match(
          error.message,
          /Height alone cannot enlarge a width-limited state/,
        );
        return true;
      },
    );
  }
  assert.throws(
    () => texasMarkerLayout(coincident(7), 320, 900),
    TexasMarkerCapacityError,
  );
  assert.throws(
    () => texasMarkerLayout(coincident(1), 50, 50),
    TexasMarkerCapacityError,
  );
  assert.deepEqual(texasMarkerLayout([], 320, 300), []);
});

test("alternate marker sizes keep exact containment and requested spacing", () => {
  assertLayout(coincident(7), 320, 300, 24);
  assertLayout(coincident(7), 900, 450, 52);
});

test("the geometric predicate rejects Texas bounding-box space and partial-square boundary crossings", () => {
  assert.equal(
    texasContainsMarker(
      projectTexasPoint({ x: 15, y: 15 }, 900, 450),
      900,
      450,
    ),
    false,
  );
  assert.equal(
    texasContainsMarker(
      projectTexasPoint({ x: 30.5, y: 9.5 }, 900, 450),
      900,
      450,
    ),
    false,
  );
  for (const point of outline.filter((_, i) => i % 7 === 0)) {
    const raw = projectTexasPoint(
      { x: point.x / 10, y: point.y / 7 },
      900,
      450,
    );
    assert.equal(texasContainsMarker(raw, 900, 450), false);
  }
});

test("invalid dimensions, duplicate IDs, and nonfinite coordinates are rejected", () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.throws(() => texasMarkerLayout(coincident(1), bad, 300), RangeError);
    assert.throws(() => texasMarkerLayout(coincident(1), 320, bad), RangeError);
    assert.throws(
      () => texasMarkerLayout(coincident(1), 320, 300, bad),
      RangeError,
    );
  }
  assert.throws(
    () => texasMarkerLayout([{ id: "bad", x: NaN, y: 30 }], 320, 300),
    TypeError,
  );
  assert.throws(
    () => projectTexasPoint({ x: Infinity, y: 0 }, 320, 300),
    TypeError,
  );
  assert.throws(
    () =>
      texasMarkerLayout(
        [
          { id: "same", x: 20, y: 30 },
          { id: "same", x: 40, y: 50 },
        ],
        320,
        300,
      ),
    /Duplicate/,
  );
});

test("legacy rectangular incidentMarkerLayout API remains unchanged", () => {
  const anchors = [
    { id: "a", x: 10, y: 20 },
    { id: "b", x: 10, y: 20 },
  ];
  const placed = incidentMarkerLayout(anchors, 320, 300);
  assert.deepEqual(
    placed.map((p) => [p.sourceX, p.sourceY]),
    [
      [32, 60],
      [32, 60],
    ],
  );
  assert.equal(placed.length, 2);
});
