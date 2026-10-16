import { it, expect } from "vitest";
import { primitive } from "../src/lib/geometry";
import { validateModifiers, worldModifiers } from "../src/lib/modifiers";
import {
  skinRegions,
  skinMoveInside,
} from "../public/engine/skin-modifiers.js";

it("permits short skin joins only when the entire move stays in solid regions", () => {
  const box = (x0: number, x1: number) => ({
    points: [
      { x: x0, y: -2 },
      { x: x1, y: -2 },
      { x: x1, y: 2 },
      { x: x0, y: 2 },
    ],
  });
  const area = [box(-10, -0.1), box(0.1, 10)];
  expect(skinMoveInside({ x: -1, y: 0 }, { x: 1, y: 0 }, area)).toBe(false);
  expect(skinMoveInside({ x: -1, y: 0 }, { x: -0.1, y: 0 }, area)).toBe(true);
  expect(skinMoveInside({ x: -1, y: 0 }, { x: -1, y: 1 }, area)).toBe(true);
  expect(skinMoveInside({ x: 0, y: 0 }, { x: 0, y: 0 }, area)).toBe(false);
  expect(skinMoveInside({ x: -1, y: 0 }, { x: 1, y: 0 }, undefined)).toBe(true);
  expect(skinMoveInside({ x: -1, y: 0 }, { x: 1, y: 0 }, [])).toBe(false);
});

it("validates independent 0–30 skin counts and preserves zero overrides in world space", () => {
  const modifier = {
    ...primitive("cube", 1),
    kind: "skins" as const,
    enabled: true,
    topLayers: 0,
    bottomLayers: 30,
    infill: 20,
    infillPattern: "grid",
  };
  expect(validateModifiers([modifier])![0]).toMatchObject({
    topLayers: 0,
    bottomLayers: 30,
  });
  expect(
    worldModifiers({ ...primitive("cube", 1), modifiers: [modifier] })[0],
  ).toMatchObject({ kind: "skins", topLayers: 0, bottomLayers: 30 });
  for (const key of ["topLayers", "bottomLayers"])
    for (const value of [-1, 31, 1.5, NaN, Infinity, "4", null])
      expect(() => validateModifiers([{ ...modifier, [key]: value }])).toThrow(
        /Invalid modifier/,
      );
  expect(
    validateModifiers([
      { ...modifier, topLayers: undefined, bottomLayers: undefined },
    ])![0].kind,
  ).toBe("skins");
});

it("zero top skins mask earlier top settings while bottom settings inherit independently", () => {
  // Discrete cells provide a geometry-independent oracle for precedence.
  const api = {
    trimTo: (a: number[], b: number[]) => a.filter((x) => b.includes(x)),
    subtract: (a: number[], b: number[]) => a.filter((x) => !b.includes(x)),
  };
  const masks = [
    { polys: [0, 1, 2], topLayers: 5, bottomLayers: 6 },
    { polys: [1, 2, 3], topLayers: 0 },
    { polys: [2], bottomLayers: 2 },
  ];
  const resolve = (key: string, base: number) =>
    Object.fromEntries(
      skinRegions([0, 1, 2, 3, 4], masks, key, base, api, 0).flatMap((r: any) =>
        r.area.map((x: number) => [x, r.count]),
      ),
    );
  expect(resolve("topLayers", 3)).toEqual({ 0: 5, 1: 0, 2: 0, 3: 0, 4: 3 });
  expect(resolve("bottomLayers", 4)).toEqual({ 0: 6, 1: 6, 2: 2, 3: 4, 4: 4 });
});
