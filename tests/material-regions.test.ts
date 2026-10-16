import { beforeAll, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { primitive, modelVolume } from "../src/lib/geometry";
import { worldMaterialParts } from "../src/lib/prepare-materials";
import { prepareMaterialRegions } from "../src/lib/material-regions";
import { paintSurface } from "../src/lib/surface-paint";
import { assembleModels } from "../src/lib/assemblies";
let api: ManifoldToplevel;
beforeAll(async () => {
  api = await Module();
  api.setup();
});
const volume = (vertices: Float32Array) =>
  modelVolume({ ...primitive("cube", 1), positions: vertices });
it("creates closed nonoverlapping paint shells without changing total model volume", () => {
  let cube = primitive("cube", 1);
  cube = {
    ...cube,
    ...paintSurface(cube, {
      point: [0, 0, 20],
      normal: [0, 0, 1],
      tool: 1,
      sourceTool: 0,
      radius: 4,
      mode: "face",
    }),
    paintDepth: 2,
  };
  const parts = prepareMaterialRegions(api, worldMaterialParts([cube]));
  expect(parts.map((p) => p.tool).sort()).toEqual([0, 1]);
  expect(parts.reduce((n, p) => n + volume(p.vertices), 0)).toBeCloseTo(
    8000,
    2,
  );
  expect(volume(parts.find((p) => p.tool === 1)!.vertices)).toBeCloseTo(800, 2);
  expect(volume(parts.find((p) => p.tool === 0)!.vertices)).toBeCloseTo(
    7200,
    2,
  );
});
it("subdivided brush patches keep the source watertight and produce actual printable volumes", () => {
  let cube = primitive("cube", 1);
  const source = cube.positions;
  cube = {
    ...cube,
    ...paintSurface(cube, {
      point: [0, 0, 20],
      normal: [0, 0, 1],
      tool: 1,
      sourceTool: 0,
      radius: 3,
      mode: "brush",
    }),
    paintDepth: 1,
  };
  expect(cube.positions).toBe(source);
  expect(cube.paintTriangles!.length).toBeGreaterThan(source.length);
  const parts = prepareMaterialRegions(api, worldMaterialParts([cube]));
  expect(parts.reduce((n, p) => n + volume(p.vertices), 0)).toBeCloseTo(
    8000,
    2,
  );
  expect(volume(parts.find((p) => p.tool === 1)!.vertices)).toBeCloseTo(
    Math.PI * 9,
    -1,
  );
});
it("later overlapping assembly parts take precedence and do not double-extrude the shared volume", () => {
  const a = primitive("cube", 1),
    b = {
      ...primitive("cube", 1),
      tool: 1,
      position: [10, 0, 0] as [number, number, number],
    };
  const parts = prepareMaterialRegions(
    api,
    worldMaterialParts(assembleModels([a, b])),
  );
  expect(parts.reduce((n, p) => n + volume(p.vertices), 0)).toBeCloseTo(
    12000,
    2,
  );
  expect(volume(parts.find((p) => p.tool === 1)!.vertices)).toBeCloseTo(
    8000,
    2,
  );
  expect(volume(parts.find((p) => p.tool === 0)!.vertices)).toBeCloseTo(
    4000,
    2,
  );
});

import { updateAssembly } from "../src/lib/assemblies";
import { validateProject } from "../src/lib/project";
import { DEFAULT_SETTINGS, PRINTERS } from "../src/lib/profiles";
import { defaultFilament } from "../src/lib/multimaterial";
it("paint surfaces follow assembly transforms and survive portable project validation", () => {
  let cube = primitive("cube", 1);
  cube = {
    ...cube,
    ...paintSurface(cube, {
      point: [0, 0, 20],
      normal: [0, 0, 1],
      tool: 1,
      sourceTool: 0,
      radius: 3,
      mode: "face",
    }),
  };
  const b = {
    ...primitive("cube", 1),
    position: [30, 0, 0] as [number, number, number],
  };
  let models = assembleModels([cube, b]);
  models = updateAssembly(
    models,
    models[1].id,
    { rotation: [0, 0, 45], position: [20, 30, 0] },
    true,
    true,
  );
  const project = validateProject(
    JSON.parse(
      JSON.stringify({
        version: 1,
        name: "Paint",
        models: models.map((m) => ({
          ...m,
          positions: Array.from(m.positions),
          paintTriangles: m.paintTriangles
            ? Array.from(m.paintTriangles)
            : undefined,
          faceTools: m.faceTools ? Array.from(m.faceTools) : undefined,
        })),
        printer: PRINTERS[0],
        settings: DEFAULT_SETTINGS,
        plates: [1],
        activePlate: 1,
        filaments: [0, 1].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
      }),
    ),
  );
  expect(project.models[0].paintTriangles).toBeInstanceOf(Float32Array);
  const result = prepareMaterialRegions(
    api,
    worldMaterialParts(project.models),
  );
  expect(result.reduce((n, p) => n + volume(p.vertices), 0)).toBeCloseTo(
    16000,
    1,
  );
  expect(result.some((p) => p.tool === 1)).toBe(true);
});

it("rejects an open painted mesh instead of silently generating incomplete material volumes", () => {
  const cube = primitive("cube", 1);
  cube.positions = cube.positions.slice(9);
  cube.faceTools = new Uint8Array(cube.positions.length / 9).fill(1);
  expect(() => prepareMaterialRegions(api, worldMaterialParts([cube]))).toThrow(
    /closed, consistently oriented/,
  );
});
it("clears and replaces surface colors without changing the underlying solid", () => {
  let cube = primitive("cube", 1);
  cube = {
    ...cube,
    ...paintSurface(cube, {
      point: [0, 0, 20],
      normal: [0, 0, 1],
      tool: 1,
      sourceTool: 0,
      radius: 3,
      mode: "face",
    }),
  };
  const repainted = {
    ...cube,
    ...paintSurface(cube, {
      point: [0, 0, 20],
      normal: [0, 0, 1],
      tool: 2,
      sourceTool: 1,
      radius: 3,
      mode: "color",
    }),
  };
  expect([...new Set(repainted.faceTools)].sort()).toEqual([0, 2]);
  expect(repainted.positions).toBe(cube.positions);
  const parts = prepareMaterialRegions(api, worldMaterialParts([repainted]));
  expect(parts.map((p) => p.tool).sort()).toEqual([0, 2]);
  expect(parts.reduce((n, p) => n + volume(p.vertices), 0)).toBeCloseTo(
    8000,
    2,
  );
});
