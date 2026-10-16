import { expect, it } from "vitest";
import { planAdaptiveLayers } from "../public/engine/layer-plan.js";
const process = {
  sliceAdaptive: true,
  sliceHeight: 0.24,
  sliceMinHeight: 0.08,
  firstSliceHeight: 0.2,
};
const part = (...levels: number[]) => ({
  vertices: new Float32Array(levels.flatMap((z) => [0, 0, z])),
});
const top = (l: { top: number }) => l.top;
function verify(layers: any[], config = process) {
  expect(layers[0]).toEqual({
    z: Math.round(config.firstSliceHeight * 500) / 1000,
    top: config.firstSliceHeight,
    height: config.firstSliceHeight,
  });
  for (let i = 1; i < layers.length; i++) {
    expect(layers[i].height).toBeGreaterThanOrEqual(
      config.sliceMinHeight - 1e-9,
    );
    expect(layers[i].height).toBeLessThanOrEqual(config.sliceHeight + 1e-9);
    expect(layers[i].top - layers[i].height).toBeCloseTo(top(layers[i - 1]), 8);
    expect(layers[i].z).toBe(Number(layers[i].z.toFixed(3)));
  }
}
it("plans one midpoint schedule from every material's transformed feature heights", () => {
  const a = part(0, 3.3),
    b = part(0, 4.7);
  const layers = planAdaptiveLayers([a, b], process);
  verify(layers);
  expect(layers).toEqual(planAdaptiveLayers([b, a, a], process));
  expect(layers.some((l) => Math.abs(top(l) - 3.3) < 1e-8)).toBe(true);
  expect(top(layers.at(-1))).toBeCloseTo(4.7, 8);
  expect(new Set(layers.slice(1).map((l) => l.height)).size).toBeGreaterThan(1);
});
it("rebalances a short final remainder without a thin final layer", () => {
  const layers = planAdaptiveLayers([part(0, 0.8, 0.82)], process);
  verify(layers);
  expect(top(layers.at(-1))).toBeCloseTo(0.82, 8);
});
it("uses the nearest feasible top when equal min/max cannot match the model", () => {
  const config = { ...process, sliceMinHeight: 0.24 };
  const layers = planAdaptiveLayers([part(0, 3.3, 4.7)], config);
  verify(layers, config);
  expect(Math.abs(top(layers.at(-1)) - 4.7)).toBeLessThanOrEqual(0.12);
});
it("preserves first-layer and min/max invariants across dense and irregular feature planes", () => {
  let state = 41;
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let run = 0; run < 100; run++) {
    const values = Array.from({ length: 100 }, () => random() * 12);
    const layers = planAdaptiveLayers([part(0, ...values, 12)], process);
    verify(layers);
    expect(top(layers.at(-1))).toBeCloseTo(12, 8);
  }
});
it("leaves fixed slicing alone and rejects invalid/overlarge schedules explicitly", () => {
  expect(
    planAdaptiveLayers([part(0, 20)], { ...process, sliceAdaptive: false }),
  ).toBeUndefined();
  expect(() => planAdaptiveLayers([part(0, NaN)], process)).toThrow(
    /non-finite/,
  );
  expect(() =>
    planAdaptiveLayers([part(0, 10)], { ...process, sliceMinHeight: 0 }),
  ).toThrow(/precision/);
  expect(() => planAdaptiveLayers([part(0, 50000)], process)).toThrow(
    /100,000/,
  );
});
it("preserves odd-micron physical tops while rounding only mesh sampling midplanes", () => {
  const config = { ...process, firstSliceHeight: 0.201 };
  const layers = planAdaptiveLayers([part(0, 0.31, 3.3)], config);
  verify(layers, config);
  expect(top(layers[0])).toBe(0.201);
  expect(layers[0].z).toBe(0.101);
  expect(top(layers.at(-1))).toBeCloseTo(3.3, 8);
});
