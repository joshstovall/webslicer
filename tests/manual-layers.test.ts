import { expect, it } from "vitest";
import {
  planManualLayers,
  validLayerCurve,
  sampleLayerCurve,
} from "../public/engine/layer-plan.js";
import { manualLayerErrors } from "../src/lib/layer-height";
import {
  DEFAULT_SETTINGS,
  PRINTERS,
  processProfile,
} from "../src/lib/profiles";
import { validateProject } from "../src/lib/project";
import { applyPrinter } from "../src/lib/nozzle-profiles";
import { slicePlate } from "../src/lib/slicer";
import type { Project } from "../src/types";
const curve = [
  { z: 0, height: 0.24 },
  { z: 2, height: 0.08 },
  { z: 4, height: 0.08 },
  { z: 7, height: 0.24 },
];
const process = {
  sliceHeight: 0.24,
  sliceMinHeight: 0.08,
  firstSliceHeight: 0.201,
  stratumLayerCurve: curve,
};
const part = (...z: number[]) => ({ vertices: z.flatMap((z) => [0, 0, z]) });
const s = {
  ...DEFAULT_SETTINGS,
  manualLayers: true,
  layerHeight: 0.24,
  minLayerHeight: 0.08,
  layerHeightCurve: curve,
};
const p = PRINTERS.find((p) => p.id === "bambu-p1s")!;
it("manual curves interpolate, extend endpoints, and form one shared physical schedule", () => {
  expect(sampleLayerCurve(curve, 1)).toBeCloseTo(0.16);
  expect(sampleLayerCurve(curve, 3)).toBe(0.08);
  expect(sampleLayerCurve(curve, 20)).toBe(0.24);
  const layers = planManualLayers([part(0, 5), part(0, 7.13)], process)!;
  expect(layers).toEqual(
    planManualLayers([part(0, 7.13), part(0, 5), part(2, 3)], process),
  );
  expect(layers[0]).toEqual({ z: 0.101, top: 0.201, height: 0.201 });
  expect(layers.at(-1)!.top).toBe(7.13);
  for (let i = 1; i < layers.length; i++) {
    const l = layers[i];
    expect(l.height).toBeGreaterThanOrEqual(0.08 - 1e-9);
    expect(l.height).toBeLessThanOrEqual(0.24 + 1e-9);
    expect(l.top - layers[i - 1].top).toBeCloseTo(l.height, 9);
    if (i < layers.length - 2)
      expect(
        Math.abs(l.height - sampleLayerCurve(curve, l.top - l.height / 2)),
      ).toBeLessThan(0.001);
  }
  expect(
    layers
      .filter((l) => l.top > 2.2 && l.top < 3.8)
      .every((l) => l.height === 0.08),
  ).toBe(true);
});
it("rebalances short tails and keeps equal-height schedules on the closest legal top", () => {
  const constant = (height: number) => [
    { z: 0, height },
    { z: 10, height },
  ];
  for (const height of [0.32, 0.401, 0.59, 0.609, 1.003, 4.719]) {
    const result = planManualLayers([part(0, height)], {
      ...process,
      firstSliceHeight: 0.2,
      stratumLayerCurve: constant(0.2),
    })!;
    expect(result.at(-1)!.top).toBeCloseTo(height, 6);
    expect(
      result
        .slice(1)
        .every((l) => l.height >= 0.08 - 1e-9 && l.height <= 0.24 + 1e-9),
    ).toBe(true);
  }
  const equal = planManualLayers([part(0, 1.09)], {
    ...process,
    sliceMinHeight: 0.24,
    stratumLayerCurve: constant(0.24),
  })!;
  expect(Math.abs(equal.at(-1)!.top - 1.09)).toBeLessThanOrEqual(0.12);
});
it("handles steep curves and bounds schedules without silent truncation", () => {
  const steep = [
    { z: 0, height: 0.08 },
    { z: 0.25, height: 0.24 },
    { z: 0.251, height: 0.08 },
    { z: 0.252, height: 0.24 },
    { z: 2, height: 0.08 },
  ];
  const layers = planManualLayers([part(0, 5)], {
    ...process,
    stratumLayerCurve: steep,
  })!;
  expect(layers.at(-1)!.top).toBe(5);
  expect(new Set(layers.map((l) => l.top)).size).toBe(layers.length);
  expect(() => planManualLayers([part(0, 50000)], process)).toThrow(/100,000/);
  expect(() => planManualLayers([part(NaN)], process)).toThrow(/non-finite/);
  expect(
    planManualLayers([part(5)], { ...process, stratumLayerCurve: undefined }),
  ).toBeUndefined();
});
it("rejects malformed curves, conflicting modes and out-of-nozzle targets", async () => {
  for (const points of [
    null,
    [],
    [curve[0]],
    {},
    [{ z: 1, height: 0.2 }, curve[1]],
    [curve[0], curve[0]],
    [curve[0], { z: 2, height: NaN }],
    [curve[0], { z: Infinity, height: 0.2 }],
    [curve[0], { z: 2, height: "0.2" }],
    Array.from({ length: 129 }, (_, z) => ({ z, height: 0.2 })),
  ])
    expect(validLayerCurve(points)).toBe(false);
  expect(validLayerCurve(curve)).toBe(true);
  expect(manualLayerErrors(p, s)).toEqual([]);
  expect(manualLayerErrors(p, { ...s, adaptive: true }).join(" ")).toMatch(
    /either manual or adaptive/,
  );
  expect(
    manualLayerErrors(p, { ...s, minLayerHeight: 0.04 }).join(" "),
  ).toMatch(/between 0.08 and 0.28/);
  expect(manualLayerErrors(p, { ...s, layerHeight: 0.2 }).join(" ")).toMatch(
    /within the minimum/,
  );
  await expect(
    slicePlate(
      [],
      p,
      { ...s, layerHeight: 0.2 },
      () => {},
      new AbortController().signal,
    ),
  ).rejects.toThrow(/Manual curve heights/);
});
it("project recovery, presets and nozzle changes retain curve data without silently using incompatible heights", () => {
  const project: Project = {
    version: 1,
    name: "Curve",
    plates: [1],
    activePlate: 1,
    models: [],
    printer: p,
    settings: s,
  };
  expect(
    validateProject(structuredClone(project)).settings.layerHeightCurve,
  ).toEqual(curve);
  expect(() =>
    validateProject({
      ...project,
      settings: { ...s, layerHeightCurve: [{ z: 1, height: 0.2 }] },
    }),
  ).toThrow(/manual layer-height/);
  expect(processProfile(s).stratumLayerCurve).toEqual(curve);
  expect(
    processProfile({ ...s, manualLayers: false }).stratumLayerCurve,
  ).toBeUndefined();
  const next = applyPrinter(project, { ...p, nozzle: 0.2, profileNozzle: 0.2 });
  expect(next.settings.manualLayers).toBe(false);
  expect(next.settings.layerHeightCurve).toEqual(curve);
  expect(
    manualLayerErrors(next.printer, {
      ...next.settings,
      manualLayers: true,
    }).join(" "),
  ).toMatch(/Manual curve heights/);
});
