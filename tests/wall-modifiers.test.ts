import { expect, it } from "vitest";
import { clipWallPath } from "../public/engine/wall-modifiers.js";
import { validateModifiers, worldModifiers } from "../src/lib/modifiers";
import { primitive } from "../src/lib/geometry";
const box = (x0: number, y0: number, x1: number, y1: number) => ({
  points: [
    { x: x0, y: y0, z: 0 },
    { x: x1, y: y0, z: 0 },
    { x: x1, y: y1, z: 0 },
    { x: x0, y: y1, z: 0 },
  ],
  depth: 2,
  inner: [] as any[],
});
const polygon = (points: any[]) => ({ points });
it("retains coincident thin-wall skip transitions without extruding the return path", () => {
  const points = [
    { x: -10, y: 0, z: 0, moved: 0.4 },
    { x: 10, y: 0, z: 0, moved: 0.4 },
    { x: 10, y: 0, z: 0, moved: 0.4, skip: true },
    { x: -10, y: 0, z: 0, moved: 0.4, skip: true },
  ];
  const masks = [{ polys: [box(-20, -20, 0, 20)], walls: 5 }];
  for (const count of [3, 5]) {
    const paths = clipWallPath({ points, depth: 0 }, masks, count, 3, polygon);
    let length = 0;
    for (const path of paths)
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1],
          b = path.points[i];
        if (!(a.skip && b.skip)) length += Math.hypot(a.x - b.x, a.y - b.y);
      }
    expect(length).toBe(10);
  }
});
it("joins retained wall paths across the original seam without closing a cut boundary", () => {
  const paths = clipWallPath(
    box(-10, -10, 10, 10),
    [{ polys: [box(-20, -20, 0, 20)], walls: 5 }],
    3,
    3,
    polygon,
  );
  expect(paths).toHaveLength(1);
  expect(paths[0].open).toBe(true);
  expect(paths[0].depth).toBe(2);
  expect(paths[0].points.map((p: any) => [p.x, p.y])).toEqual([
    [0, -10],
    [10, -10],
    [10, 10],
    [0, 10],
  ]);
  const reverse = clipWallPath(
    box(-10, -10, 10, 10),
    [{ polys: [box(-20, -20, 0, 20)], walls: 5 }],
    5,
    3,
    polygon,
  );
  expect(reverse).toHaveLength(1);
  expect(reverse[0].points.map((p: any) => [p.x, p.y])).toEqual([
    [0, 10],
    [-10, 10],
    [-10, -10],
    [0, -10],
  ]);
});
it("preserves closed neutral loops and gives holes and later zero overrides their actual priority", () => {
  const outer = box(-20, -20, 20, 20);
  outer.inner = [box(-5, -5, 5, 5)];
  const shell = box(-2, -2, 2, 2);
  const masks = [{ polys: [outer], walls: 5 }];
  const paths = clipWallPath(shell, masks, 3, 3, polygon);
  expect(paths).toHaveLength(1);
  expect(paths[0].open).toBe(false);
  expect(paths[0].points).toHaveLength(4);
  expect(clipWallPath(shell, masks, 5, 3, polygon)).toHaveLength(0);
  expect(
    clipWallPath(
      shell,
      [...masks, { polys: [box(-4, -4, 4, 4)], walls: 0 }],
      3,
      3,
      polygon,
    ),
  ).toHaveLength(0);
});
it("retains thin-wall flow metadata and invalidates copied point keys at new intersections", () => {
  const shell = box(-10, -10, 10, 10);
  Object.assign(shell.points[0], { moved: 0.1, _key: "cached" });
  Object.assign(shell.points[1], { moved: 0.3, skip: true });
  const [path] = clipWallPath(
    shell,
    [{ polys: [box(-20, -20, 0, 20)], walls: 5 }],
    3,
    3,
    polygon,
  );
  expect(path.points[0].moved).toBeCloseTo(0.2);
  expect(path.points[0]._key).toBeUndefined();
  expect(path.points[0].skip).toBeFalsy();
  expect(path.points[1].skip).toBe(true);
});
it("validates required integer wall counts and carries them into world-space masks", () => {
  const modifier = {
    ...primitive("cube", 1),
    kind: "walls" as const,
    enabled: true,
    walls: 0,
    infill: 20,
    infillPattern: "grid",
  };
  const model = { ...primitive("cube", 1), modifiers: [modifier] };
  expect(validateModifiers(model.modifiers)![0].walls).toBe(0);
  expect(worldModifiers(model)[0]).toMatchObject({ kind: "walls", walls: 0 });
  for (const walls of [undefined, -1, 1.5, 21, NaN, Infinity, "5"])
    expect(() => validateModifiers([{ ...modifier, walls }])).toThrow(
      /Invalid modifier/,
    );
});
