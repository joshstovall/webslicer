import { expect, it } from "vitest";
import { outlineCollision } from "../public/engine/purge-footprints.js";
import { placePurgeBlocks } from "../public/engine/purge-planner.js";
const box = (
  a: number,
  b: number,
  c: number,
  d: number,
  inner: any[] = [],
) => ({
  points: [
    { x: a, y: b },
    { x: c, y: b },
    { x: c, y: d },
    { x: a, y: d },
  ],
  inner,
});
const rect = (a: number, b: number, c: number, d: number) => ({
  minX: a,
  minY: b,
  maxX: c,
  maxY: d,
});
it("distinguishes holes, walls, crossing edges, enclosed solids and nested islands", () => {
  const frame = box(-30, -30, 30, 30, [
    box(-25, -25, 25, 25, [box(-2, -2, 2, 2)]),
  ]);
  const collision = outlineCollision([frame]);
  expect(collision.hits(rect(5, 5, 20, 20))).toBe(false);
  expect(collision.hits(rect(26, -2, 29, 2))).toBe(true);
  expect(collision.hits(rect(20, -2, 35, 2))).toBe(true);
  expect(collision.hits(rect(-40, -40, 40, 40))).toBe(true);
  expect(collision.hits(rect(-3, -3, 3, 3))).toBe(true);
  expect(collision.hits(rect(-1, -1, 1, 1))).toBe(true);
  expect(collision.hits(rect(30, -10, 40, 10))).toBe(false);
  expect(collision.hits(rect(2, 2, 25, 25))).toBe(false);
});
it("tests concave outlines instead of treating their bounds as solid", () => {
  const shape = {
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 30 },
      { x: 0, y: 30 },
    ],
  };
  const collision = outlineCollision([shape]);
  expect(collision.hits(rect(6, 6, 29, 29))).toBe(false);
  expect(collision.hits(rect(3, 3, 10, 10))).toBe(true);
  expect(collision.hits(rect(10, -2, 15, 7))).toBe(true);
});
it("finds multiple separated towers inside a frame even when no outside space exists", () => {
  const options = {
    width: 64,
    depth: 64,
    size: 12,
    count: 4,
    lineWidth: 0.4,
    obstacles: [],
    outlines: [box(-32, -32, 32, 32, [box(-25, -25, 25, 25)])],
  };
  const placed = placePurgeBlocks(options);
  expect(placed).toHaveLength(4);
  for (const p of placed) {
    expect(Math.abs(p.x) + 6.7).toBeLessThanOrEqual(25 + 1e-7);
    expect(Math.abs(p.y) + 6.7).toBeLessThanOrEqual(25 + 1e-7);
    for (const q of placed)
      if (p !== q)
        expect(
          Math.abs(p.x - q.x) >= 13.4 - 1e-7 ||
            Math.abs(p.y - q.y) >= 13.4 - 1e-7,
        ).toBe(true);
  }
});
it("uses the same complete contours for manual positioning and reserved bed regions", () => {
  const options = {
    width: 64,
    depth: 64,
    size: 12,
    count: 1,
    lineWidth: 0.4,
    obstacles: [],
    outlines: [box(-32, -32, 32, 32, [box(-25, -25, 25, 25)])],
    position: { x: 0, y: 0, axis: "x" },
  };
  expect(placePurgeBlocks(options)).toEqual([{ x: 0, y: 0, z: 0 }]);
  expect(() =>
    placePurgeBlocks({ ...options, position: { x: 20, y: 0, axis: "x" } }),
  ).toThrow("overlaps");
  expect(() =>
    placePurgeBlocks({ ...options, obstacles: [rect(-2, -2, 2, 2)] }),
  ).toThrow("reserved bed area");
  expect(() =>
    placePurgeBlocks({
      ...options,
      position: undefined,
      obstacles: [rect(-25, -25, 25, 25)],
    }),
  ).toThrow("No room");
});
it("rejects invalid and excessive outline input", () => {
  expect(() => outlineCollision([{ points: [{ x: 0, y: 0 }] }])).toThrow(
    "contour",
  );
  expect(() => outlineCollision([box(NaN, 0, 1, 1)])).toThrow("coordinates");
  expect(() =>
    outlineCollision([
      { points: Array.from({ length: 250001 }, () => ({ x: 0, y: 0 })) },
    ]),
  ).toThrow("complexity");
});
it("bounds repeated searches and fails with a manual-placement recovery action", () => {
  const collision = outlineCollision([box(0, 0, 1, 1)]);
  expect(() => {
    for (let i = 0; i < 200001; i++) collision.hits(rect(3, 3, 4, 4));
  }).toThrow("manual tower position");
});
