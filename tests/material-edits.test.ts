import { beforeAll, expect, it } from "vitest";
import Module, { type Manifold, type ManifoldToplevel } from "manifold-3d";
import {
  boundsOf,
  mergedVertices,
  modelVolume,
  primitive,
} from "../src/lib/geometry";
import { paintSurface } from "../src/lib/surface-paint";
import { worldMaterialParts } from "../src/lib/prepare-materials";
import {
  editMaterialRegions,
  type MaterialEdit,
} from "../src/lib/edit-material-regions";
import {
  editModelSelection,
  modelsFromMaterialEdit,
} from "../src/lib/material-edits";
import {
  assembleModels,
  partsBounds,
  updateAssembly,
} from "../src/lib/assemblies";
let api: ManifoldToplevel;
beforeAll(async () => {
  api = await Module();
  api.setup();
});
const colors = ["#ff0000", "#00ff00", "#0000ff"];
it("rejects edits that would exceed the portable project's material-part limit", async () => {
  const models = Array.from({ length: 200 }, () => primitive("cube", 1));
  await expect(
    editModelSelection(
      models,
      models[0].id,
      { kind: "height", height: 10, tool: 1 },
      colors,
      0.8,
      false,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow(/200 material parts/);
  expect(models).toHaveLength(200);
  expect(models[0].positions).toHaveLength(108);
});
function painted() {
  const m = primitive("cube", 1);
  return {
    ...m,
    paintDepth: 2,
    ...paintSurface(m, {
      mode: "face",
      point: [10, 0, 10],
      normal: [1, 0, 0],
      sourceTool: 0,
      tool: 1,
      radius: 3,
    }),
  };
}
function volume(vertices: Float32Array) {
  return modelVolume({ ...primitive("cube", 1), positions: vertices });
}
it("cuts through a painted side into closed material regions with conserved volumes", () => {
  const source = painted(),
    operation: MaterialEdit = {
      kind: "cut",
      height: 10,
      keep: "both",
      flipUpper: false,
    };
  const parts = editMaterialRegions(
    api,
    worldMaterialParts([source]),
    operation,
  );
  for (const piece of [0, 1]) {
    expect(
      parts
        .filter((p) => p.piece === piece)
        .reduce((n, p) => n + volume(p.vertices), 0),
    ).toBeCloseTo(4000, 2);
    expect(
      volume(parts.find((p) => p.piece === piece && p.tool === 1)!.vertices),
    ).toBeCloseTo(400, 2);
  }
  const models = modelsFromMaterialEdit([source], parts, operation, colors);
  expect(new Set(models.map((m) => m.assemblyId)).size).toBe(2);
  for (const id of new Set(models.map((m) => m.assemblyId))) {
    const group = models.filter((m) => m.assemblyId === id),
      bounds = partsBounds(group);
    expect(bounds.min.z).toBeCloseTo(0);
    expect(bounds.max.z).toBeCloseTo(10);
    expect(group.map((m) => m.tool).sort()).toEqual([0, 1]);
  }
  expect(models.every((m) => !m.faceTools && !m.paintTriangles)).toBe(true);
});
it("height colors replace only the upper material volumes and leave all lower colors intact", () => {
  const source = painted(),
    operation: MaterialEdit = { kind: "height", height: 10, tool: 2 };
  const result = editMaterialRegions(
    api,
    worldMaterialParts([source]),
    operation,
  );
  expect(volume(result.find((p) => p.tool === 1)!.vertices)).toBeCloseTo(
    400,
    2,
  );
  expect(volume(result.find((p) => p.tool === 0)!.vertices)).toBeCloseTo(
    3600,
    2,
  );
  expect(volume(result.find((p) => p.tool === 2)!.vertices)).toBeCloseTo(
    4000,
    2,
  );
  const models = modelsFromMaterialEdit([source], result, operation, colors);
  expect(new Set(models.map((m) => m.assemblyId)).size).toBe(1);
  expect(partsBounds(models).max.z).toBeCloseTo(20);
  expect(boundsOf(models.find((m) => m.tool === 2)!).min.z).toBeCloseTo(10);
});
it("editing hidden overlapping parts does not remove material from visible parts", () => {
  const sources = assembleModels([
    painted(),
    { ...primitive("cube", 1), visible: false, tool: 2 },
  ]);
  const result = editMaterialRegions(
    api,
    worldMaterialParts(sources, 0.8, true),
    { kind: "cut", height: 10, keep: "both", flipUpper: false },
  );
  expect(
    result.filter((p) => p.visible).reduce((n, p) => n + volume(p.vertices), 0),
  ).toBeCloseTo(8000, 2);
  expect(
    result
      .filter((p) => !p.visible)
      .reduce((n, p) => n + volume(p.vertices), 0),
  ).toBeCloseTo(8000, 2);
});
it("splitting keeps touching colors together and is a no-op for one physical object", () => {
  const source = painted(),
    operation: MaterialEdit = { kind: "split" };
  const result = editMaterialRegions(
    api,
    worldMaterialParts([source]),
    operation,
  );
  expect(new Set(result.map((p) => p.piece)).size).toBe(1);
  expect(modelsFromMaterialEdit([source], result, operation, colors)).toEqual([
    source,
  ]);
});
it("splits disconnected geometry into linked multi-color objects without moving or losing paint", () => {
  const a = painted(),
    b = { ...painted(), position: [30, 0, 0] as [number, number, number] };
  const sources = assembleModels([a, b]);
  const operation: MaterialEdit = { kind: "split" };
  const result = editMaterialRegions(
    api,
    worldMaterialParts(sources),
    operation,
  );
  const models = modelsFromMaterialEdit(sources, result, operation, colors);
  const groups = [...new Set(models.map((m) => m.assemblyId))];
  expect(groups).toHaveLength(2);
  for (const id of groups) {
    const group = models.filter((m) => m.assemblyId === id);
    expect(group.map((m) => m.tool).sort()).toEqual([0, 1]);
    expect(volume(mergedVertices(group))).toBeCloseTo(8000, 1);
  }
  expect(partsBounds(models).min.x).toBeCloseTo(-10);
  expect(partsBounds(models).max.x).toBeCloseTo(40);
});
it("splits cavities and solid islands into physical objects without filling or duplicating their volumes", () => {
  const outer = api.Manifold.cube([20, 20, 20]),
    inner = api.Manifold.cube([12, 12, 12]).translate([4, 4, 4]),
    shell = outer.subtract(inner),
    island = api.Manifold.cube([2, 2, 2]).translate([9, 9, 9]);
  const verts = (solid: Manifold) => {
    const m = solid.getMesh();
    return Float32Array.from(
      Array.from(m.triVerts).flatMap((v) =>
        Array.from(m.vertProperties.subarray(v * m.numProp, v * m.numProp + 3)),
      ),
    );
  };
  try {
    const result = editMaterialRegions(
      api,
      [
        { name: "Hollow", vertices: verts(shell), tool: 0, assemblyId: "a" },
        { name: "Island", vertices: verts(island), tool: 1, assemblyId: "a" },
      ],
      { kind: "split" },
    );
    expect(new Set(result.map((p) => p.piece)).size).toBe(2);
    expect(volume(result.find((p) => p.tool === 0)!.vertices)).toBeCloseTo(
      6272,
      2,
    );
    expect(volume(result.find((p) => p.tool === 1)!.vertices)).toBeCloseTo(
      8,
      2,
    );
  } finally {
    [outer, inner, shell, island].forEach((s) => s.delete());
  }
});
it("whole-object cuts honor transformed assemblies, hidden parts, upper flips and keep selection", () => {
  let sources = assembleModels([
    painted(),
    {
      ...painted(),
      visible: false,
      position: [30, 0, 0] as [number, number, number],
    },
  ]);
  sources = updateAssembly(
    sources,
    sources[0].id,
    { scale: [1, 2, 1.5], rotation: [0, 0, 25] },
    true,
    true,
  );
  const operation: MaterialEdit = {
    kind: "cut",
    height: 15,
    keep: "upper",
    flipUpper: true,
  };
  const input = worldMaterialParts(sources, 0.8, true);
  const result = editMaterialRegions(api, input, operation);
  expect(result.every((p) => p.piece === 1)).toBe(true);
  expect(result.reduce((n, p) => n + volume(p.vertices), 0)).toBeCloseTo(
    24000,
    0,
  );
  const models = modelsFromMaterialEdit(sources, result, operation, colors);
  expect(models.some((m) => !m.visible)).toBe(true);
  expect(partsBounds(models).min.z).toBeCloseTo(0, 4);
  expect(partsBounds(models).max.z).toBeCloseTo(15, 4);
  expect(models.every((m) => m.rotation[0] === 180)).toBe(true);
  const again = editMaterialRegions(
    api,
    worldMaterialParts(models, 0.8, true),
    { kind: "cut", height: 7.5, keep: "both", flipUpper: false },
  );
  expect(again.reduce((n, p) => n + volume(p.vertices), 0)).toBeCloseTo(
    24000,
    0,
  );
});
