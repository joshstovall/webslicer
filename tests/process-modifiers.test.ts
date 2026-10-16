import { expect, it } from "vitest";
import {
  applyProcessModifiers,
  splitRegionMove,
} from "../public/engine/process-modifiers.js";
import { primitive } from "../src/lib/geometry";
import { validateModifiers, worldModifiers } from "../src/lib/modifiers";

const box = (x0: number, y0: number, x1: number, y1: number) => ({
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  inner: [] as any[],
});
const a = { x: -10, y: 0 },
  b = { x: 10, y: 0 };

it("splits at exact boundaries and preserves independent overlap priority", () => {
  const result = splitRegionMove(a, b, [
    { polys: [box(-8, -5, 8, 5)], speedPercent: 50, flowPercent: 120 },
    { polys: [box(-2, -5, 2, 5)], speedPercent: 200 },
  ]);
  expect(result).toEqual([
    { end: 0.1, speed: 1, flow: 1 },
    { end: 0.4, speed: 0.5, flow: 1.2 },
    { end: 0.6, speed: 2, flow: 1.2 },
    { end: 0.9, speed: 0.5, flow: 1.2 },
    { end: 1, speed: 1, flow: 1 },
  ]);
});
it("keeps holes automatic, retains nested islands and merges neutral boundaries", () => {
  const outer = box(-8, -5, 8, 5),
    hole = box(-4, -3, 4, 3);
  hole.inner.push(box(-1, -1, 1, 1));
  outer.inner.push(hole);
  const result = splitRegionMove(a, b, [{ polys: [outer], flowPercent: 150 }]);
  expect(result.map((r: any) => r.flow)).toEqual([1, 1.5, 1, 1.5, 1, 1.5, 1]);
  expect(
    splitRegionMove(a, b, [{ polys: [outer], speedPercent: 100 }]),
  ).toEqual([{ end: 1, speed: 1, flow: 1 }]);
});
it("handles collinear boundaries and tangent vertices without zero-length moves", () => {
  const masks = [{ polys: [box(-5, 0, 5, 5)], speedPercent: 50 }];
  expect(splitRegionMove(a, b, masks)).toEqual([
    { end: 0.25, speed: 1, flow: 1 },
    { end: 0.75, speed: 0.5, flow: 1 },
    { end: 1, speed: 1, flow: 1 },
  ]);
  const tangent = splitRegionMove({ x: -10, y: -5 }, { x: 0, y: 5 }, [
    { polys: [box(0, 0, 5, 5)], speedPercent: 50 },
  ]);
  expect(tangent).toEqual([{ end: 1, speed: 1, flow: 1 }]);
});
it("splits model extrusion without transferring retraction, fan changes or settings to other paths", async () => {
  const point = (x: number, y: number, z = 0.1): any => ({
    x,
    y,
    z,
    clone() {
      return point(this.x, this.y, this.z);
    },
  });
  const widget = {
    offset: { x: 5, y: 0, z: 0 },
    anno: {
      stratumProcessModifiers: [
        {
          name: "mask",
          vertices: [-5, -5, 0, 5, 5, 1],
          speedPercent: 50,
          flowPercent: 150,
        },
      ],
    },
    slices: [{ index: 0, z: 0.1, height: 0.2 }],
  };
  const other = { ...widget, anno: {} };
  const move = {
    point: point(15, 0),
    emit: 1,
    speed: 40,
    type: "shells",
    widget,
    retract: true,
    fan: 100,
  };
  const support = { ...move, type: "support", point: point(-5, 0) };
  const unrelated = { ...move, widget: other };
  const layer = Object.assign(
    [
      { ...move, emit: 0, point: point(-5, 0), retract: false },
      move,
      support,
      unrelated,
    ],
    { z: 0.2 },
  );
  await applyProcessModifiers(
    [layer],
    [widget, other],
    { sliceHeight: 0.2 },
    {
      point,
      slice: async () => ({ groups: [box(-5, -5, 5, 5)] }),
      polygons: { nest: (p: any) => p },
    },
  );
  expect(
    layer.slice(1, 4).map((r: any) => [r.point.x, r.speed, r.emit, r.retract]),
  ).toEqual([
    [0, 40, 1, false],
    [10, 20, 1.5, false],
    [15, 40, 1, true],
  ]);
  expect(layer.slice(1, 4).map((r: any) => r.fan)).toEqual([
    100,
    undefined,
    undefined,
  ]);
  expect(layer.at(-2)).toBe(support);
  expect(layer.at(-1)).toBe(unrelated);
});
it("validates process percentages before use and preserves them in world annotations", () => {
  const modifier = {
    ...primitive("cube", 1),
    kind: "process" as const,
    enabled: true,
    infill: 50,
    infillPattern: "grid",
    speedPercent: 50,
    flowPercent: 125,
  };
  expect(validateModifiers([modifier])![0].flowPercent).toBe(125);
  expect(
    worldModifiers({ ...primitive("cube", 1), modifiers: [modifier] })[0],
  ).toMatchObject({ kind: "process", speedPercent: 50, flowPercent: 125 });
  for (const v of [0, -1, 301, NaN, Infinity, "50", null])
    for (const key of ["speedPercent", "flowPercent"])
      expect(() => validateModifiers([{ ...modifier, [key]: v }])).toThrow();
});
