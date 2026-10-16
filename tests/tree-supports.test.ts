import { expect, it } from "vitest";
import {
  treeInterior,
  treeEscape,
  treePartners,
  treeLayerStep,
} from "../public/engine/tree-supports.js";
import {
  treeSettings,
  treeSettingErrors,
  TREE_LIMITS,
} from "../src/lib/tree-settings";
import {
  DEFAULT_SETTINGS,
  PRINTERS,
  processProfile,
} from "../src/lib/profiles";
import { validateProject } from "../src/lib/project";
import { slicePlate } from "../src/lib/slicer";
const box = (x0: number, y0: number, x1: number, y1: number) => ({
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
});

it("places contact centers within concave islands and avoids nested holes", () => {
  const c = {
    points: [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 0, y: 6 },
    ],
  };
  const p = treeInterior(c);
  expect(p.x < 1 || p.y < 1 || p.y > 5).toBe(true);
  const ring = { ...box(-5, -5, 5, 5), inner: [box(-4, -4, 4, 4)] };
  const q = treeInterior(ring);
  expect(Math.abs(q.x) > 4 || Math.abs(q.y) > 4).toBe(true);
  expect(() =>
    treeInterior({
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
    }),
  ).toThrow(/too thin/);
});

it("routes to a nearby free boundary or hole without crossing overlapping obstacles", () => {
  const direct = treeEscape({ x: 0, y: 0 }, [box(-2, -2, 2, 2)], 0.1);
  expect(Math.hypot(direct.x, direct.y)).toBeCloseTo(2.1);
  expect(treeEscape({ x: 5, y: 0 }, [box(-2, -2, 2, 2)], 0.1)).toBeUndefined();
  const exit = treeEscape(
    { x: 0, y: 0 },
    [box(-2, -2, 2, 2), box(-3, -3, 3, 0.2)],
    0.1,
  );
  expect(exit.y).toBeGreaterThan(2);
  const hole = treeEscape(
    { x: 1.5, y: 0 },
    [{ ...box(-10, -10, 10, 10), inner: [box(-1, -1, 1, 1)] }],
    0.1,
  );
  expect(hole).toEqual({ x: 0.9, y: 0 });
});

it("pairs deterministically across spatial bucket boundaries and leaves isolated branches alone", () => {
  const nodes = [
    { id: 3, x: -0.01, y: 0 },
    { id: 2, x: 0.01, y: 0 },
    { id: 1, x: -0.03, y: 0 },
    { id: 4, x: 100, y: 100 },
  ];
  expect(treePartners(nodes, 1).get(2).id).toBe(3);
  expect(treePartners(nodes, 1).has(4)).toBe(false);
  const ties = [
    { id: 5, x: 0, y: 0 },
    { id: 2, x: 1, y: 0 },
    { id: 1, x: -1, y: 0 },
  ];
  expect(treePartners(ties, 2).get(5).id).toBe(1);
  expect(treePartners([...ties].reverse(), 2).get(5).id).toBe(1);
});

it("uses physical printed tops for branch angle limits on variable layer grids", () => {
  const process = {
    sliceHeight: 0.2,
    firstSliceHeight: 0.24,
    stratumLayerPlan: [
      { z: 0.12, top: 0.24 },
      { z: 0.29, top: 0.34 },
      { z: 0.48, top: 0.62 },
    ],
  };
  expect(treeLayerStep({ index: 2 }, { index: 1 }, process)).toBeCloseTo(0.28);
  expect(treeLayerStep({ index: 1 }, { index: 0 }, process)).toBeCloseTo(0.1);
  expect(
    treeLayerStep(
      { index: 2 },
      { index: 1 },
      { sliceHeight: 0.2, firstSliceHeight: 0.24 },
    ),
  ).toBeCloseTo(0.2);
});

it("preserves old projects and maps both tree modes with independent validated settings", () => {
  const project = {
    version: 1,
    name: "Trees",
    plates: [1],
    activePlate: 1,
    models: [],
    printer: PRINTERS[0],
    settings: { ...DEFAULT_SETTINGS },
  };
  expect(
    treeSettings(validateProject(structuredClone(project)).settings)
      .treeTipDiameter,
  ).toBe(1.6);
  expect(
    treeSettings({ ...DEFAULT_SETTINGS, lineWidth: 1 }).treeTipDiameter,
  ).toBe(2);
  for (const supports of ["tree", "tree-manual"]) {
    const settings = {
      ...DEFAULT_SETTINGS,
      supports,
      treeBranchAngle: 25,
      treeBranchSpacing: 4,
      treeTipDiameter: 2,
      treeBranchDiameter: 10,
    };
    expect(validateProject({ ...project, settings }).settings).toMatchObject(
      settings,
    );
    expect(processProfile(settings)).toMatchObject({
      sliceSupportTree: true,
      sliceSupportType: supports === "tree" ? "auto" : "manual",
      stratumTreeAngle: 25,
      stratumTreeSpacing: 4,
      stratumTreeTipDiameter: 2,
      stratumTreeBranchDiameter: 10,
    });
  }
  for (const [key, [min, max]] of Object.entries(TREE_LIMITS))
    for (const value of [NaN, Infinity, null, "3", min - 0.1, max + 0.1]) {
      const settings = { ...DEFAULT_SETTINGS, [key]: value };
      expect(treeSettingErrors(settings).length).toBeGreaterThan(0);
      expect(() => validateProject({ ...project, settings })).toThrow(
        /tree support/,
      );
    }
  expect(
    treeSettingErrors({ ...DEFAULT_SETTINGS, treeTipDiameter: 0.5 }).join(),
  ).toMatch(/extrusion widths/);
  expect(
    treeSettingErrors({
      ...DEFAULT_SETTINGS,
      treeTipDiameter: 3,
      treeBranchDiameter: 2,
    }).join(),
  ).toMatch(/at least the tip/);
});

it("rejects invalid tree dimensions before starting browser workers", async () => {
  await expect(
    slicePlate(
      [],
      PRINTERS[0],
      { ...DEFAULT_SETTINGS, supports: "tree", treeBranchAngle: 90 },
      () => {},
      new AbortController().signal,
    ),
  ).rejects.toThrow(/tree support/);
});
