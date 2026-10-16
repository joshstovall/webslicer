import { beforeAll, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { Matrix4, Vector3 } from "three";
import { primitive, matrixOf, boundsOf } from "../src/lib/geometry";
import {
  worldModifiers,
  attachModifiers,
  modifierErrors,
  validateModifiers,
} from "../src/lib/modifiers";
import { validateModifierVolumes } from "../src/lib/validate-modifier-volumes";
import { worldMaterialParts } from "../src/lib/prepare-materials";
import { assembleModels, updateAssembly } from "../src/lib/assemblies";
import { prepareMaterialRegions } from "../src/lib/material-regions";
import { editMaterialRegions } from "../src/lib/edit-material-regions";
import { modelsFromMaterialEdit } from "../src/lib/material-edits";
import { validateProject } from "../src/lib/project";
import { DEFAULT_SETTINGS, PRINTERS } from "../src/lib/profiles";
import type { Model, ModifierMesh } from "../src/types";
let api: ManifoldToplevel;
beforeAll(async () => {
  api = await Module();
  api.setup();
});
const modifier = (): ModifierMesh => ({
  ...primitive("cube", 1),
  enabled: true,
  infill: 75,
  infillPattern: "grid",
  position: [-2, 1, 3],
  rotation: [0, 0, 30],
  scale: [0.4, 0.6, 0.5],
});
const source = (): Model => ({
  ...primitive("cube", 1),
  modifiers: [modifier()],
});
const close = (a: Float32Array, b: Float32Array) => {
  expect(a.length).toBe(b.length);
  a.forEach((n, i) => expect(n).toBeCloseTo(b[i], 3));
};
it("validates portable modifier meshes and rejects incompatible modes before slicing", () => {
  const model = source();
  const p = {
    version: 1,
    name: "Modifiers",
    models: [
      {
        ...model,
        positions: [...model.positions],
        modifiers: model.modifiers!.map((m) => ({
          ...m,
          positions: [...m.positions],
        })),
      },
    ],
    plates: [1],
    activePlate: 1,
    printer: PRINTERS[0],
    settings: DEFAULT_SETTINGS,
  };
  const restored = validateProject(p);
  expect(restored.models[0].modifiers![0].positions).toBeInstanceOf(
    Float32Array,
  );
  expect(modifierErrors(restored.models, DEFAULT_SETTINGS)).toEqual([]);
  expect(
    modifierErrors(restored.models, { ...DEFAULT_SETTINGS, vase: true }),
  ).toEqual([expect.stringMatching(/spiral vase/)]);
  for (const patch of [
    { infill: 101 },
    { infill: NaN },
    { infillPattern: "vase" },
    { scale: [1, 0, 1] },
    { positions: [0, 0, 0] },
    { positions: Array(108).fill(1e100) },
    { enabled: "yes" },
    { kind: "unknown" },
  ])
    expect(() => validateModifiers([{ ...modifier(), ...patch }])).toThrow();
  expect(() => validateModifiers(Array.from({ length: 33 }, modifier))).toThrow(
    /32/,
  );
});
it("keeps support effects distinct and requires enabled supports for active enforcers", () => {
  const m = source();
  m.modifiers![0].kind = "support-enforcer";
  expect(validateModifiers(m.modifiers)![0].kind).toBe("support-enforcer");
  expect(worldModifiers(m)[0].kind).toBe("support-enforcer");
  expect(modifierErrors([m], DEFAULT_SETTINGS)[0]).toMatch(/Enable Automatic/);
  expect(
    modifierErrors([m], { ...DEFAULT_SETTINGS, supports: "manual" }),
  ).toEqual([]);
  m.modifiers![0].enabled = false;
  expect(modifierErrors([m], DEFAULT_SETTINGS)).toEqual([]);
  m.modifiers![0].enabled = true;
  m.modifiers![0].kind = "support-blocker";
  expect(modifierErrors([m], DEFAULT_SETTINGS)).toEqual([]);
});
it("validates closed volumes in the material worker and rejects open or zero-volume meshes", () => {
  const model = source();
  validateModifierVolumes(api, worldModifiers(model));
  const open = worldModifiers(model)[0];
  open.vertices = open.vertices.slice(9);
  expect(() => validateModifierVolumes(api, [open])).toThrow(/closed/);
});
it("keeps world placement through linking and whole-assembly transforms", () => {
  const a = {
    ...source(),
    position: [12, -8, 4],
    rotation: [15, 20, 30],
    scale: [1.2, 0.8, 1.1],
  } as Model;
  const b = { ...source(), position: [-22, 3, 0] } as Model;
  const before = [worldModifiers(a)[0].vertices, worldModifiers(b)[0].vertices];
  const group = assembleModels([a, b]);
  group.forEach((m, i) => close(worldModifiers(m)[0].vertices, before[i]));
  const changed = updateAssembly(
    group,
    group[0].id,
    { rotation: [20, 10, 35], scale: [0.9, 1.1, 0.8] },
    true,
    false,
  );
  const delta = matrixOf(changed[0]).multiply(matrixOf(group[0]).invert());
  changed.forEach((m, i) => {
    const expected = before[i].slice(),
      point = new Vector3();
    for (let j = 0; j < expected.length; j += 3)
      point.fromArray(expected, j).applyMatrix4(delta).toArray(expected, j);
    close(worldModifiers(m)[0].vertices, expected);
  });
});
it("applies modifiers to linked and painted materials but not unrelated objects or hidden owners", () => {
  const a = { ...source(), assemblyId: "colors" };
  const b = {
    ...primitive("cube", 1),
    assemblyId: "colors",
    tool: 1,
    position: [5, 0, 0],
  } as Model;
  const unrelated = { ...primitive("cube", 1), position: [35, 0, 0] } as Model;
  const models = [a, b, unrelated];
  const prepared = prepareMaterialRegions(api, worldMaterialParts(models));
  const result = attachModifiers(models, prepared);
  expect(
    result
      .filter((p) => p.assemblyId === "colors")
      .every((p) => p.modifiers?.length === 1),
  ).toBe(true);
  expect(
    result.find((p) => p.sourceIds?.includes(unrelated.id))!.modifiers,
  ).toBeUndefined();
  expect(
    attachModifiers([{ ...a, visible: false }, b], worldMaterialParts([b]))[0]
      .modifiers,
  ).toBeUndefined();
});
it("preserves disabled masks and world placement when cutting and grounding a modified object", () => {
  const model = source();
  model.modifiers![0].kind = "support-blocker";
  model.modifiers!.push({ ...modifier(), id: "disabled", enabled: false });
  model.modifiers!.push({
    ...modifier(),
    id: "regional",
    kind: "process",
    speedPercent: 65,
    flowPercent: 125,
  });
  const operation = {
    kind: "cut",
    height: 10,
    keep: "both",
    flipUpper: false,
  } as const;
  const edited = editMaterialRegions(
    api,
    worldMaterialParts([model]),
    operation,
  );
  const result = modelsFromMaterialEdit([model], edited, operation, [
    "#ffffff",
  ]);
  expect(result).toHaveLength(2);
  for (const [i, m] of result.entries()) {
    expect(m.modifiers).toHaveLength(3);
    expect(m.modifiers![0].kind).toBe("support-blocker");
    expect(m.modifiers![1].enabled).toBe(false);
    expect(m.modifiers![2]).toMatchObject({
      kind: "process",
      speedPercent: 65,
      flowPercent: 125,
    });
    const processExpected = worldModifiers(model)[1].vertices.slice();
    for (let j = 2; j < processExpected.length; j += 3)
      processExpected[j] -= i * 10;
    close(worldModifiers(m)[1].vertices, processExpected);
    const expected = worldModifiers(model)[0].vertices.slice();
    for (let j = 2; j < expected.length; j += 3) expected[j] -= i * 10;
    close(worldModifiers(m)[0].vertices, expected);
    expect(boundsOf(m).min.z).toBeCloseTo(0);
  }
});

it("rejects an edit that would consolidate more masks than a portable part can retain", () => {
  const sources = assembleModels([
    { ...source(), modifiers: Array.from({ length: 32 }, modifier) },
    { ...source(), position: [5, 0, 0] },
  ]);
  const operation = {
    kind: "cut",
    height: 10,
    keep: "both",
    flipUpper: false,
  } as const;
  const edited = editMaterialRegions(
    api,
    worldMaterialParts(sources),
    operation,
  );
  expect(() =>
    modelsFromMaterialEdit(sources, edited, operation, ["#ffffff"]),
  ).toThrow(/32 modifier/);
  expect(sources.map((m) => m.modifiers!.length)).toEqual([32, 1]);
});
