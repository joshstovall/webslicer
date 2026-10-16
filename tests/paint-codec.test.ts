import { expect, it } from "vitest";
import { decodePaintTriangle } from "../src/lib/paint-codec";
import type { Vec3 } from "../src/types";
const triangle: [Vec3, Vec3, Vec3] = [
  [0, 0, 0],
  [2, 0, 0],
  [0, 2, 0],
];
it("reads default, basic, extended, and high filament states from painted 3MF", () => {
  for (const [code, tool] of [
    ["0", 5],
    ["4", 0],
    ["8", 1],
    ["0C", 2],
    ["EC", 16],
    ["0FC", 17],
    ["EFC", 31],
  ] as const)
    expect(decodePaintTriangle(code, triangle, 5)).toEqual([
      { points: triangle, tool },
    ]);
});
it("places a one-edge subdivision in the correct half of the original triangle", () => {
  const parts = decodePaintTriangle("481", triangle, 0);
  expect(parts).toEqual([
    {
      points: [
        [1, 1, 0],
        [0, 2, 0],
        [0, 0, 0],
      ],
      tool: 1,
    },
    {
      points: [
        [0, 0, 0],
        [2, 0, 0],
        [1, 1, 0],
      ],
      tool: 0,
    },
  ]);
});
it("preserves area and color assignment through three- and four-child subdivisions", () => {
  const area = (p: [Vec3, Vec3, Vec3]) =>
    Math.abs(
      (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) -
        (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]),
    ) / 2;
  for (const [code, count, blue] of [
    ["4882", 3, 1.5],
    ["44883", 4, 1],
  ] as const) {
    const parts = decodePaintTriangle(code, triangle, 0);
    expect(parts).toHaveLength(count);
    expect(parts.reduce((n, p) => n + area(p.points), 0)).toBe(2);
    expect(
      parts.filter((p) => p.tool === 1).reduce((n, p) => n + area(p.points), 0),
    ).toBe(blue);
  }
});
it("rejects malformed paint trees instead of silently dropping colors", () => {
  for (const code of ["", "z", "1", "C", "FC", "D", "E", "44", "43"])
    expect(() => decodePaintTriangle(code, triangle, 0)).toThrow();
});
