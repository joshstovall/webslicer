import { beforeAll, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { ExtrudeGeometry, Shape, Path, BoxGeometry } from "three";
import {
  primitive,
  createModel,
  boundsOf,
  matrixOf,
} from "../src/lib/geometry";
import { placementRequest, applyPlacement } from "../src/lib/placement";
import { calculatePlacement } from "../src/lib/placement-core";
import { PRINTERS } from "../src/lib/profiles";
import type { Model } from "../src/types";
let api: ManifoldToplevel;
beforeAll(async () => {
  api = await Module();
  api.setup();
});
const printer = {
  ...PRINTERS[0],
  bed: [80, 80, 80] as [number, number, number],
};
const options = { gap: 2, edge: 2, rotate: true };
function ring(): Model {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(60, 0);
  s.lineTo(60, 60);
  s.lineTo(0, 60);
  s.closePath();
  const h = new Path();
  h.moveTo(5, 5);
  h.lineTo(5, 55);
  h.lineTo(55, 55);
  h.lineTo(55, 5);
  h.closePath();
  s.holes.push(h);
  return createModel(
    "Frame",
    new ExtrudeGeometry(s, { depth: 10, bevelEnabled: false }),
  );
}
function pack(models: Model[], p = printer, opts = options) {
  return applyPlacement(
    models,
    calculatePlacement(api, placementRequest(models, p, "arrange", opts)).moves,
  );
}
function errors(models: Model[], p = printer, edge = 0) {
  return calculatePlacement(
    api,
    placementRequest(models, p, "validate", { ...options, edge }),
  ).errors;
}
it("nests a cube inside a through-opening whose AABB overlaps, with independent clearance", () => {
  const models = pack([ring(), primitive("cube", 1)]);
  expect(boundsOf(models[0]).intersectsBox(boundsOf(models[1]))).toBe(true);
  expect(errors(models)).toEqual([]);
  const a = boundsOf(models[0]),
    b = boundsOf(models[1]);
  expect(b.min.x - a.min.x).toBeGreaterThanOrEqual(7 - 1e-5);
  expect(b.max.x - a.min.x).toBeLessThanOrEqual(53 + 1e-5);
  expect(b.min.y - a.min.y).toBeGreaterThanOrEqual(7 - 1e-5);
  expect(b.max.y - a.min.y).toBeLessThanOrEqual(53 + 1e-5);
});
it("distinguishes solid overlap, full containment, and touching surfaces", () => {
  const a = primitive("cube", 1);
  const b = {
    ...primitive("cube", 1),
    position: [20, 0, 0] as [number, number, number],
  };
  expect(errors([a, b])).toEqual([]);
  expect(errors([a, { ...b, position: [19, 0, 0] }]).join()).toContain(
    "overlap",
  );
  expect(
    errors([a, { ...b, position: [0, 0, 5], scale: [0.2, 0.2, 0.2] }]).join(),
  ).toContain("overlap");
  expect(errors([ring(), { ...b, position: [0, 0, 0] }])).toEqual([]);
});
it("can turn an elongated model to fit while preserving paint, scale, modifiers and assembly spacing", () => {
  const a = createModel("Long", new BoxGeometry(65, 20, 10));
  a.rotation = [0, 0, 15];
  a.scale = [-1, 1, 1];
  a.assemblyId = "linked";
  a.faceTools = new Uint8Array(12).fill(1);
  const b = {
    ...a,
    id: "top",
    name: "Top",
    position: [0, 0, 15] as [number, number, number],
  };
  const p = { ...printer, bed: [50, 80, 80] as [number, number, number] };
  expect(() => pack([a, b], p, { ...options, rotate: false })).toThrow(
    "Could not find",
  );
  const result = pack([a, b], p);
  expect(result[0].faceTools).toBe(a.faceTools);
  expect(result[0].positions).toBe(a.positions);
  expect(result[0].scale).toEqual(a.scale);
  expect(result[1].position[2] - result[0].position[2]).toBeCloseTo(15);
  expect(boundsOf(result[0]).min.z).toBeCloseTo(0);
  expect(errors(result, p)).toEqual([]);
  expect(matrixOf(result[0]).determinant()).toBeLessThan(0);
});
it("keeps different plates independent and hidden-only objects unchanged", () => {
  const a = primitive("cube", 1),
    b = primitive("cube", 2),
    c = { ...primitive("cube", 1), visible: false };
  const result = pack([a, b, c]);
  expect(result[0].position).toEqual(result[1].position);
  expect(result[2]).toBe(c);
  expect(errors(result)).toEqual([]);
});
it("retains Bambu exclusions and edge clearance after centering", () => {
  const p = PRINTERS.find((p) => p.id === "bambu-p1s")!;
  const model = createModel("Large", new BoxGeometry(240, 200, 2));
  const result = pack([model], p, { gap: 8, edge: 8, rotate: true });
  expect(errors(result, p, 8)).toEqual([]);
  const b = boundsOf(result[0]);
  expect(b.min.x).toBeGreaterThanOrEqual(-120.0001);
  expect(b.max.x).toBeLessThanOrEqual(120.0001);
});
it("rejects impossible layouts without changing the input and bounds expensive jobs", () => {
  const a = createModel("Large", new BoxGeometry(100, 100, 10));
  const before = a.position.slice();
  expect(() => pack([a])).toThrow("Could not find");
  expect(a.position).toEqual(before);
  expect(() =>
    pack(Array.from({ length: 201 }, () => primitive("cube", 1))),
  ).toThrow("200 parts");
});
it("does not reject an exclusion inside an opening, but catches real footprint contact", () => {
  const r = ring();
  const request = placementRequest([r], printer, "validate", {
    ...options,
    edge: 2,
  });
  request.exclusions = [{ minX: -5, minY: -5, maxX: 5, maxY: 5 }];
  expect(calculatePlacement(api, request).errors).toEqual([]);
  request.exclusions = [{ minX: -30, minY: -30, maxX: -20, maxY: -20 }];
  expect(calculatePlacement(api, request).errors.join()).toContain("reserved");
});
it("accepts a cube underneath a solid arch even though their XY projections and 3D boxes overlap", () => {
  const s = new Shape();
  s.moveTo(0, 0);
  for (const [x, y] of [
    [5, 0],
    [5, 25],
    [25, 25],
    [25, 0],
    [30, 0],
    [30, 30],
    [0, 30],
  ])
    s.lineTo(x, y);
  s.closePath();
  const geometry = new ExtrudeGeometry(s, { depth: 5, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  const arch = createModel("Arch", geometry),
    cube = {
      ...primitive("cube", 1),
      scale: [0.2, 0.2, 0.2] as [number, number, number],
    };
  expect(boundsOf(arch).intersectsBox(boundsOf(cube))).toBe(true);
  expect(errors([arch, cube])).toEqual([]);
});
it("reserves adhesion clearance around exclusions even when part spacing is smaller", () => {
  const p = PRINTERS.find((p) => p.id === "bambu-p1s")!;
  const a = createModel("Wide", new BoxGeometry(180, 210, 2));
  const placed = pack([a], p, { gap: 2, edge: 20, rotate: true });
  expect(errors(placed, p, 20)).toEqual([]);
});
it("preserves open surface outlines and reports uncertain solid overlap instead of treating it as valid", () => {
  const cube = primitive("cube", 1),
    open = {
      ...primitive("cube", 1),
      id: "open",
      positions: cube.positions.slice(18),
    };
  expect(pack([open])).toHaveLength(1);
  expect(errors([open, cube]).join()).toContain("Cannot verify separation");
});
it("packs interlocking concave L outlines with quarter turns rather than their rectangles", () => {
  const s = new Shape();
  s.moveTo(0, 0);
  for (const [x, y] of [
    [60, 0],
    [60, 10],
    [10, 10],
    [10, 60],
    [0, 60],
  ])
    s.lineTo(x, y);
  s.closePath();
  const a = createModel(
    "L one",
    new ExtrudeGeometry(s, { depth: 5, bevelEnabled: false }),
  );
  const b = { ...a, id: "L-two", name: "L two" };
  const packed = pack([a, b]);
  expect(boundsOf(packed[0]).intersectsBox(boundsOf(packed[1]))).toBe(true);
  expect(errors(packed)).toEqual([]);
  for (const m of packed) {
    const bounds = boundsOf(m);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-38.0001);
    expect(bounds.max.x).toBeLessThanOrEqual(38.0001);
  }
});
it("does not group empty assembly identifiers and rejects ambiguous IDs and printer dimensions", () => {
  const a = { ...primitive("cube", 1), assemblyId: "" },
    b = { ...primitive("cube", 1), assemblyId: "" };
  const placed = pack([a, b]);
  expect(errors(placed)).toEqual([]);
  expect(placed[0].position).not.toEqual(placed[1].position);
  expect(() => pack([a, { ...b, id: a.id }])).toThrow("duplicate identifiers");
  expect(() => pack([a], { ...printer, bed: [NaN, 80, 80] })).toThrow(
    "printer dimensions",
  );
});
