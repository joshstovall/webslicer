import { beforeAll, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { importObj } from "../src/lib/import-obj";
import { modelVolume, boundsOf } from "../src/lib/geometry";
import { worldMaterialParts } from "../src/lib/prepare-materials";
import { prepareMaterialRegions } from "../src/lib/material-regions";
import { validateProject } from "../src/lib/project";
import { PRINTERS, DEFAULT_SETTINGS } from "../src/lib/profiles";
import { bindImportedMaterials } from "../src/lib/import-materials";
import { coloredObj, materialLibrary } from "./fixtures/colored-obj";
let api: ManifoldToplevel;
beforeAll(async () => {
  api = await Module();
  api.setup();
});
const library = () => new File([materialLibrary], "colors palette.mtl");
for (const groups of [false, true])
  it(`preserves OBJ surface materials and watertight volume when face groups are ${groups ? "split" : "in one mesh"}`, async () => {
    const imported = await importObj(
      new File([coloredObj(groups)], "colored.obj"),
      1,
      [library()],
    );
    expect(imported.warnings).toEqual([]);
    expect(imported.palette.map((p) => p.color).sort()).toEqual([
      "#ff0000",
      "#ffffff",
    ]);
    expect(imported.models).toHaveLength(1);
    const model = imported.models[0];
    expect([...new Set(model.faceTools)]).toHaveLength(2);
    expect(modelVolume(model)).toBeCloseTo(216);
    const parts = prepareMaterialRegions(
      api,
      worldMaterialParts(imported.models),
    );
    const volumes = parts.map((p) => ({
      tool: p.tool,
      volume: modelVolume({
        ...model,
        positions: p.vertices,
        paintTriangles: undefined,
        faceTools: undefined,
      }),
    }));
    expect(volumes.reduce((n, p) => n + p.volume, 0)).toBeCloseTo(216, 2);
    const white = imported.palette.findIndex((p) => p.color === "#ffffff");
    expect(volumes.find((p) => p.tool === white)?.volume).toBeCloseTo(28.8, 2);
    const project = {
      version: 1 as const,
      name: "OBJ",
      models: [],
      printer: PRINTERS[0],
      settings: DEFAULT_SETTINGS,
      plates: [1],
      activePlate: 1,
    };
    const bound = bindImportedMaterials(project, imported);
    const restored = validateProject({ ...project, ...bound });
    expect([...restored.models[0].faceTools!]).toEqual([
      ...bound.models[0].faceTools!,
    ]);
    expect(restored.filaments?.map((f) => f.color)).toContain("#ffffff");
  });
it("reports missing MTL libraries and keeps distinct named material groups", async () => {
  const imported = await importObj(new File([coloredObj()], "missing.obj"), 1);
  expect(imported.palette.map((p) => p.name).sort()).toEqual(["Brick", "Snow"]);
  expect(imported.warnings.join("\n")).toContain(
    "Missing OBJ material library",
  );
  expect(imported.warnings.join("\n")).toContain("placeholder color");
  expect([...new Set(imported.models[0].faceTools)]).toHaveLength(2);
});
it("retains separate closed solids and their shared placement even when they touch", async () => {
  const body = coloredObj().replaceAll("usemtl Snow", "usemtl Brick");
  // Same closed solid repeated with a new vertex-index range remains a second part.
  const second = body
    .replace("o Body", "o Second")
    .replace(
      /^f (\d+) (\d+) (\d+)$/gm,
      (_, a, b, c) => `f ${+a + 36} ${+b + 36} ${+c + 36}`,
    )
    .replaceAll("usemtl Brick", "usemtl Snow");
  const imported = await importObj(new File([body + second], "two.obj"), 1, [
    library(),
  ]);
  expect(imported.models).toHaveLength(2);
  expect(imported.models[0].assemblyId).toBe(imported.models[1].assemblyId);
  expect(imported.models.every((m) => !m.faceTools)).toBe(true);
  expect(imported.models.map((m) => imported.palette[m.tool!].color)).toEqual([
    "#ff0000",
    "#ffffff",
  ]);
  expect(boundsOf(imported.models[0]).min.toArray()).toEqual(
    boundsOf(imported.models[1]).min.toArray(),
  );
});
it("turns interpolated vertex colors into discrete printable regions without breaking the original mesh", async () => {
  const obj = coloredObj(false, true).replaceAll("usemtl Brick", "usemtl Snow");
  const imported = await importObj(new File([obj], "vertices.obj"), 1, [
    library(),
  ]);
  expect(imported.palette.map((p) => p.color).sort()).toEqual([
    "#0000ff",
    "#00ff00",
    "#ff0000",
  ]);
  expect(imported.models[0].paintTriangles!.length).toBe(
    imported.models[0].positions.length * 6,
  );
  const parts = prepareMaterialRegions(
    api,
    worldMaterialParts(imported.models),
  );
  expect(parts).toHaveLength(3);
  expect(
    parts.reduce(
      (n, p) =>
        n + modelVolume({ ...imported.models[0], positions: p.vertices }),
      0,
    ),
  ).toBeCloseTo(216, 2);
});
it("keeps diffuse colors and warns about unsupported texture/transparency instead of fetching resources", async () => {
  const imported = await importObj(
    new File([coloredObj()], "textures.obj"),
    1,
    [
      new File(
        [
          materialLibrary +
            "map_Kd https://example.invalid/private.png\nd 0.5\n",
        ],
        "colors palette.mtl",
      ),
    ],
  );
  expect(imported.warnings.join("\n")).toContain(
    "not converted to filament regions",
  );
  expect(imported.warnings.join("\n")).toContain("opaque filament");
  expect(imported.palette.map((p) => p.color)).toContain("#ffffff");
});
it("accepts exactly 64 vertex colors without allocating an unused default material", async () => {
  const p = (await import("../src/lib/geometry")).primitive(
    "cube",
    1,
  ).positions;
  const text = (count: number) =>
    Array.from({ length: count }, (_, part) => {
      const vertices = Array.from(
        { length: p.length / 3 },
        (_, i) =>
          `v ${p[i * 3] + part * 25} ${p[i * 3 + 1]} ${p[i * 3 + 2]} ${part / 255} 0.5 0.5`,
      );
      const faces = Array.from(
        { length: p.length / 9 },
        (_, i) =>
          `f ${part * 36 + i * 3 + 1} ${part * 36 + i * 3 + 2} ${part * 36 + i * 3 + 3}`,
      );
      return `o cube${part}\n${vertices.join("\n")}\n${faces.join("\n")}`;
    }).join("\n");
  const imported = await importObj(new File([text(64)], "palette.obj"), 1);
  expect(imported.palette).toHaveLength(64);
  expect(imported.models).toHaveLength(64);
  expect(new Set(imported.models.map((m) => m.tool)).size).toBe(64);
  expect(imported.models.every((m) => !m.faceTools)).toBe(true);
  await expect(
    importObj(new File([text(65)], "palette.obj"), 1),
  ).rejects.toThrow("more than 64");
});
it("reports ambiguous companion filenames instead of picking an arbitrary library", async () => {
  await expect(
    importObj(new File([coloredObj()], "ambiguous.obj"), 1, [
      library(),
      library(),
    ]),
  ).rejects.toThrow("More than one supplied MTL");
});
