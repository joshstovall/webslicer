import { beforeAll, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { Matrix4, Triangle, Vector3 } from "three";
import { primitive, matrixOf, mergedVertices } from "../src/lib/geometry";
import {
  paintSupportSurface,
  transformSupportPaint,
  validateSupportPaint,
  worldSupportPaint,
  attachSupportPaint,
} from "../src/lib/support-paint";
import { paintSurface } from "../src/lib/surface-paint";
import { worldMaterialParts } from "../src/lib/prepare-materials";
import { editMaterialRegions } from "../src/lib/edit-material-regions";
import { modelsFromMaterialEdit } from "../src/lib/material-edits";
import { assembleModels, updateAssembly } from "../src/lib/assemblies";
import { supportPaintProjector } from "../src/lib/reproject-support-paint";
import type { Model, SupportPaint } from "../src/types";
let api: ManifoldToplevel;
beforeAll(async () => {
  api = await Module();
  api.setup();
});
const stroke = {
  point: [0, 0, 0] as [number, number, number],
  normal: [0, 0, -1] as [number, number, number],
  radius: 4,
  mode: "brush" as const,
  tool: 1,
  sourceTool: 0,
};
const painted = (): Model => {
  const m = primitive("cube", 1);
  return { ...m, ...paintSupportSurface(m, stroke) };
};
function area(paint: SupportPaint | undefined, state: number) {
  if (!paint) return 0;
  let result = 0;
  const t = new Triangle(),
    p = [new Vector3(), new Vector3(), new Vector3()];
  paint.states.forEach((v, i) => {
    if (v === state) {
      p.forEach((q, j) => q.fromArray(paint.positions, i * 9 + j * 3));
      result += t.set(p[0], p[1], p[2]).getArea();
    }
  });
  return result;
}
it("paints and erases support patches without changing filament painting or the closed mesh", () => {
  let m = primitive("cube", 1);
  m = { ...m, ...paintSurface(m, { ...stroke, mode: "face", tool: 3 }) };
  const original = m.positions,
    colors = m.faceTools,
    colorSurface = m.paintTriangles;
  m = { ...m, ...paintSupportSurface(m, stroke) };
  expect(area(m.supportPaint, 1)).toBeGreaterThan(40);
  expect(area(m.supportPaint, 1)).toBeLessThan(60);
  expect(m.positions).toBe(original);
  expect(m.faceTools).toBe(colors);
  expect(m.paintTriangles).toBe(colorSurface);
  m = { ...m, ...paintSupportSurface(m, { ...stroke, tool: 2 }) };
  expect(area(m.supportPaint, 1)).toBe(0);
  expect(area(m.supportPaint, 2)).toBeGreaterThan(40);
  m = {
    ...m,
    ...paintSupportSurface(m, {
      ...stroke,
      mode: "color",
      sourceTool: 2,
      tool: 0,
    }),
  };
  expect(m.supportPaint).toBeUndefined();
});
it("rejects malformed support annotations before coercion and restores portable arrays", () => {
  const p = painted().supportPaint!;
  const portable = { positions: [...p.positions], states: [...p.states] };
  expect(validateSupportPaint(portable)?.positions).toBeInstanceOf(
    Float32Array,
  );
  for (const bad of [
    { ...portable, states: [257] },
    { ...portable, states: portable.states.map(() => 256) },
    { ...portable, states: portable.states.map(() => 0.5) },
    { ...portable, positions: portable.positions.map(() => 1e100) },
    { ...portable, positions: [] },
    { ...portable, states: [] },
  ])
    expect(() => validateSupportPaint(bad)).toThrow();
});
it("preserves world patches through assemblies and keeps ownership away from unrelated objects", () => {
  const a = {
    ...painted(),
    position: [12, 4, 8],
    rotation: [20, 10, 30],
    scale: [1.2, 0.8, 1.1],
  } as Model;
  const b = { ...primitive("cube", 1), position: [-20, 0, 0] } as Model;
  const before = worldSupportPaint(a),
    group = assembleModels([a, b]);
  const after = worldSupportPaint(group[0]);
  after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 3));
  const moved = updateAssembly(
    group,
    group[0].id,
    { rotation: [10, 30, 40] },
    true,
    false,
  );
  expect(moved[0].supportPaint?.states).toEqual(group[0].supportPaint?.states);
  const unrelated = primitive("cube", 1),
    attached = attachSupportPaint(
      [...group, unrelated],
      worldMaterialParts([...group, unrelated]),
    );
  expect(attached[0].supportPaintTriangles.length).toBeGreaterThan(0);
  expect(attached[1].supportPaintTriangles).toEqual(
    attached[0].supportPaintTriangles,
  );
  expect(attached[2].supportPaintTriangles).toEqual([]);
});
it("reprojects onto changed tessellation without painting new caps or removed surfaces", () => {
  const source = painted();
  const project = supportPaintProjector([source.supportPaint!]);
  const same = project(source.positions);
  expect(area(same, 1)).toBeCloseTo(area(source.supportPaint, 1), 3);
  const op = {
    kind: "cut",
    height: 10,
    keep: "both",
    flipUpper: false,
  } as const;
  const result = modelsFromMaterialEdit(
    [source],
    editMaterialRegions(api, worldMaterialParts([source]), op),
    op,
    ["#fff"],
  );
  expect(area(result[0].supportPaint, 1)).toBeCloseTo(
    area(source.supportPaint, 1),
    3,
  );
  expect(result[1].supportPaint).toBeUndefined();
  const wrong = transformSupportPaint(
    source.supportPaint,
    new Matrix4().makeTranslation(0, 0, 10),
  )!;
  expect(supportPaintProjector([wrong])(source.positions)).toBeUndefined();
});
it("retains support state area through a transformed cut", () => {
  const base = primitive("cube", 1);
  const paintedSide = {
    ...base,
    ...paintSupportSurface(base, {
      ...stroke,
      point: [-10, 0, 10],
      normal: [-1, 0, 0],
      mode: "face",
      tool: 2,
    }),
  };
  const source = {
    ...paintedSide,
    rotation: [0, 0, 30],
    scale: [1.2, 0.8, 1.1],
  } as Model;
  const op = {
    kind: "cut",
    height: 11,
    keep: "both",
    flipUpper: true,
  } as const;
  const edited = editMaterialRegions(api, worldMaterialParts([source]), op);
  const out = modelsFromMaterialEdit([source], edited, op, ["#fff"]);
  const worldArea = out.reduce(
    (sum, m) =>
      sum + area(transformSupportPaint(m.supportPaint, matrixOf(m)), 2),
    0,
  );
  expect(worldArea).toBeCloseTo(
    area(transformSupportPaint(source.supportPaint, matrixOf(source)), 2),
    2,
  );
  expect(out.every((m) => m.supportPaint?.states.some((s) => s === 2))).toBe(
    true,
  );
});

it("keeps hidden support paint out of visible surfaces during editing and slicing", () => {
  const visible = primitive("cube", 1);
  const hidden = { ...painted(), visible: false };
  const sources = assembleModels([visible, hidden]);
  const op = { kind: "height", height: 10, tool: 1 } as const;
  const edited = editMaterialRegions(
    api,
    worldMaterialParts(sources, 0.4, true),
    op,
  );
  expect(
    edited.filter((p) => p.visible !== false).every((p) => !p.supportPaint),
  ).toBe(true);
  expect(
    edited
      .filter((p) => p.visible === false)
      .some((p) => area(p.supportPaint, 1) > 40),
  ).toBe(true);
  expect(
    attachSupportPaint(sources, worldMaterialParts(sources)).every(
      (p) => p.supportPaintTriangles.length === 0,
    ),
  ).toBe(true);
});

it("splits disconnected solids with independent support selections and preserves their world locations", () => {
  const a = { ...primitive("cube", 1), position: [-20, 0, 0] } as Model;
  const b = { ...primitive("cube", 1), position: [20, 0, 0] } as Model;
  let source = { ...primitive("cube", 1), positions: mergedVertices([a, b]) };
  source = {
    ...source,
    ...paintSupportSurface(source, { ...stroke, point: [-20, 0, 0] }),
  };
  source = {
    ...source,
    ...paintSupportSurface(source, { ...stroke, point: [20, 0, 0], tool: 2 }),
  };
  const op = { kind: "split" } as const;
  const edited = editMaterialRegions(api, worldMaterialParts([source]), op);
  const out = modelsFromMaterialEdit([source], edited, op, ["#fff"]);
  expect(out).toHaveLength(2);
  for (const state of [1, 2]) {
    const owners = out.filter((m) => area(m.supportPaint, state) > 0);
    expect(owners).toHaveLength(1);
    expect(area(owners[0].supportPaint, state)).toBeCloseTo(
      area(source.supportPaint, state),
      3,
    );
    expect(owners[0].position[0]).toBeCloseTo(state === 1 ? -20 : 20, 3);
    expect(area(owners[0].supportPaint, state === 1 ? 2 : 1)).toBe(0);
  }
});
