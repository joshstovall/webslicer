import { beforeAll, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { BoxGeometry, Vector3, Quaternion } from "three";
import {
  calculateOrientation,
  type OrientationRequest,
} from "../src/lib/orientation-core";
import { applyOrientation } from "../src/lib/orientation";
import { createModel, matrixOf, boundsOf } from "../src/lib/geometry";
import { placementRequest } from "../src/lib/placement";
import { PRINTERS } from "../src/lib/profiles";
import type { Model } from "../src/types";
let api: ManifoldToplevel;
beforeAll(async () => {
  api = await Module();
  api.setup();
});
function box(
  name: string,
  x: number,
  y: number,
  z: number,
  position: [number, number, number] = [0, 0, 0],
) {
  const m = createModel(name, new BoxGeometry(x, y, z));
  m.position = position;
  return m;
}
const printer = {
  ...PRINTERS[0],
  bed: [100, 100, 100] as [number, number, number],
};
function request(
  models: Model[],
  patch: Partial<OrientationRequest> = {},
): OrientationRequest {
  return {
    parts: placementRequest(models, printer, "arrange", {
      gap: 0,
      edge: 2,
      rotate: false,
    }).parts,
    bed: printer.bed,
    edge: 2,
    angle: 50,
    priority: "balanced",
    ...patch,
  };
}
function tee() {
  return [box("stem", 4, 4, 20), box("cap", 30, 16, 4, [0, 0, 20])];
}
it("rotates a top-heavy overhang onto a broad supported base and reduces support demand", () => {
  const result = calculateOrientation(api, request(tee()));
  expect(result.baseline.supportVolume).toBeGreaterThan(8000);
  const best = result.candidates[0];
  expect(best.supportVolume).toBeLessThan(1);
  expect(best.contactArea).toBeGreaterThan(400);
  expect(result.examined).toBeGreaterThan(24);
  const placed = applyOrientation(tee(), best);
  expect(Math.min(...placed.map((m) => boundsOf(m).min.z))).toBeCloseTo(0, 5);
});
it("support-distance estimates land on a lower solid instead of extending through it to the bed", () => {
  const assembly = [
    box("floor", 20, 20, 8),
    box("roof", 20, 20, 4, [0, 0, 12]),
  ];
  const result = calculateOrientation(api, request(assembly));
  // Only the four-millimeter air gap contributes: approximately 400×4 mm³.
  expect(result.baseline.supportVolume).toBeGreaterThan(1500);
  expect(result.baseline.supportVolume).toBeLessThan(1700);
});
it("does not count buried overlap faces and preserves a cube's zero support estimate", () => {
  const result = calculateOrientation(
    api,
    request([box("cube", 20, 20, 20), box("inside", 8, 8, 8, [0, 0, 6])]),
  );
  expect(result.baseline.supportVolume).toBe(0);
  expect(result.baseline.contactArea).toBeCloseTo(400, 5);
  expect(result.candidates[0].current).toBe(true);
});
it("finds a face-aligned bed contact for an arbitrarily tilted model", () => {
  const m = box("tilted", 30, 18, 5);
  m.rotation = [23, 37, 19];
  const r = calculateOrientation(api, request([m]));
  expect(r.candidates[0].supportVolume).toBeLessThan(1e-3);
  expect(r.candidates[0].contactArea).toBeGreaterThan(500);
  expect(r.candidates[0].size[2]).toBeCloseTo(5, 4);
});
it("rejects angles that exceed height/edge clearance and can turn a long footprint to fit", () => {
  const r = calculateOrientation(
    api,
    request([box("long", 65, 20, 10)], { bed: [30, 80, 15] }),
  );
  expect(
    r.candidates.every(
      (c) =>
        c.size[0] <= 26.0001 && c.size[1] <= 76.0001 && c.size[2] <= 15.0001,
    ),
  ).toBe(true);
  expect(() =>
    calculateOrientation(
      api,
      request([box("large", 40, 40, 40)], { bed: [30, 30, 30] }),
    ),
  ).toThrow("No tested printing angle fits");
});
it("rotates mirrored and nonuniformly scaled assembly parts rigidly without replacing geometry or annotations", () => {
  const models = tee();
  models[0].scale = [-1, 2, 0.75];
  models[0].rotation = [10, 20, 30];
  for (const m of models) {
    m.assemblyId = "linked";
    m.faceTools = new Uint8Array(m.positions.length / 9).fill(1);
    m.paintTriangles = m.positions.slice();
    m.supportPaint = {
      positions: m.positions.slice(),
      states: new Uint8Array(m.positions.length / 9).fill(2),
    };
    m.modifiers = [];
  }
  const result = calculateOrientation(api, request(models));
  const choice = result.candidates[0],
    q = new Quaternion(...choice.quaternion);
  const placed = applyOrientation(models, choice);
  placed.forEach((m, i) => {
    expect(m.positions).toBe(models[i].positions);
    expect(m.paintTriangles).toBe(models[i].paintTriangles);
    expect(m.faceTools).toBe(models[i].faceTools);
    expect(m.supportPaint).toBe(models[i].supportPaint);
    expect(m.modifiers).toBe(models[i].modifiers);
    expect(m.scale).toEqual(models[i].scale);
    for (let v = 0; v < m.positions.length; v += 3) {
      const original = new Vector3()
        .fromArray(models[i].positions, v)
        .applyMatrix4(matrixOf(models[i]))
        .applyQuaternion(q)
        .add(new Vector3(...choice.translation));
      const actual = new Vector3()
        .fromArray(m.positions, v)
        .applyMatrix4(matrixOf(m));
      expect(actual.distanceTo(original)).toBeLessThan(1e-5);
    }
  });
});
it("rejects open meshes, invalid settings and empty selections with actionable errors", () => {
  const m = box("open", 20, 20, 20);
  m.positions = m.positions.slice(9);
  expect(() => calculateOrientation(api, request([m]))).toThrow("closed");
  expect(() => calculateOrientation(api, request([]))).toThrow("1–200");
  expect(() =>
    calculateOrientation(api, request(tee(), { angle: NaN })),
  ).toThrow("Invalid");
  expect(() => calculateOrientation(api, request(tee(), { edge: -1 }))).toThrow(
    "Invalid",
  );
});
it("changing priorities can trade a broad support-free base for a lower printing height", () => {
  const balanced = calculateOrientation(api, request(tee())).candidates[0];
  const lower = calculateOrientation(
    api,
    request(tee(), { priority: "height" }),
  ).candidates[0];
  expect(lower.size[2]).toBeLessThan(balanced.size[2]);
  expect(balanced.contactArea).toBeGreaterThan(lower.contactArea);
});
it("uses the configured overhang threshold and reports the unturned baseline when only a quarter turn fits", () => {
  const tilted = box("tilted", 30, 18, 5);
  tilted.rotation = [30, 0, 0];
  const sensitive = calculateOrientation(api, request([tilted], { angle: 15 }));
  const strict = calculateOrientation(api, request([tilted], { angle: 85 }));
  expect(sensitive.baseline.supportVolume).toBeGreaterThan(
    strict.baseline.supportVolume,
  );
  const turned = calculateOrientation(
    api,
    request([box("long", 65, 20, 10)], { bed: [30, 80, 15] }),
  );
  expect(turned.baseline.fits).toBe(false);
  expect(turned.baseline.quaternion).toEqual([0, 0, 0, 1]);
  expect(turned.candidates[0].current).toBe(false);
});
