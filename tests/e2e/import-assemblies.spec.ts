import { test, expect } from "@playwright/test";

async function fixture(page: any) {
  return page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { zipSync, strToU8 } =
      await import("/node_modules/.vite/deps/fflate.js");
    const cube = primitive("cube", 1),
      p = cube.positions.map((v) => v * 0.2);
    const vertices = Array.from(
      { length: p.length / 3 },
      (_, i) =>
        `<vertex x="${p[i * 3]}" y="${p[i * 3 + 1]}" z="${p[i * 3 + 2]}"/>`,
    ).join("");
    const triangles = Array.from(
      { length: p.length / 9 },
      (_, i) => `<triangle v1="${i * 3}" v2="${i * 3 + 1}" v3="${i * 3 + 2}"/>`,
    ).join("");
    const leaf = (name: string, color: string) =>
      `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="2"><base name="${name}" displaycolor="${color}"/></basematerials><object id="1" name="${name}" pid="2" pindex="0"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources><build/></model>`;
    const root =
      '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="50"><components><component objectid="1" p:path="/3D/Objects/red.model"/><component objectid="1" p:path="/3D/Objects/blue.model" transform="-1 0 0 0 1 0 0 0 1 0 0 4"/></components></object></resources><build><item objectid="50" transform="1 0 0 0 1 0 0 0 1 100 150 20"/></build></model>';
    const rels =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Id="model"/></Relationships>';
    return Array.from(
      zipSync({
        "3D/3dmodel.model": strToU8(root),
        "3D/Objects/red.model": strToU8(leaf("Red base", "#CC4433")),
        "3D/Objects/blue.model": strToU8(leaf("Blue cap", "#3366CC")),
        "_rels/.rels": strToU8(rels),
      }),
    );
  });
}

test("production 3MF components retain path-scoped IDs, mirrored transforms, colors, and assembly placement through slicing", async ({
  page,
}) => {
  await page.goto("/");
  const data = await fixture(page);
  const result = await page.evaluate(async (bytes) => {
    const {
      importModelFile,
      arrangeModels,
      boundsOf,
      validatePlate,
      modelVolume,
    } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } =
      await import("/src/lib/multimaterial.ts");
    const imported = await importModelFile(
      new File([new Uint8Array(bytes)], "two-colors.3mf"),
      1,
    );
    const printer = PRINTERS.find((p) => p.id === "generic-multi")!,
      models = arrangeModels(imported.models, printer);
    const filaments = imported.palette.map((f, i) => ({
      ...defaultFilament(DEFAULT_SETTINGS, i),
      ...f,
      material: "PLA",
    }));
    const result = await slicePlate(
      models,
      printer,
      { ...DEFAULT_SETTINGS, adhesion: "none" },
      () => {},
      new AbortController().signal,
      filaments,
      { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
    );
    const lower: number[] = [],
      upper: number[] = [];
    for (const layer of result.layers)
      for (let i = 0; i < layer.features.length; i++) {
        const x = layer.segments[i * 6 + 3] - printer.bed[0] / 2,
          y = layer.segments[i * 6 + 4] - printer.bed[1] / 2;
        if (
          layer.features[i] === 4 ||
          layer.features[i] === 5 ||
          Math.abs(x) > 2.1 ||
          Math.abs(y) > 2.1
        )
          continue;
        if (layer.z < 3.8) lower.push(layer.tools[i]);
        if (layer.z > 4.3) upper.push(layer.tools[i]);
      }
    return {
      names: models.map((m) => m.name),
      palette: imported.palette,
      bounds: models.map((m) => ({
        min: boundsOf(m).min.toArray(),
        max: boundsOf(m).max.toArray(),
      })),
      assemblies: models.map((m) => m.assemblyId),
      errors: validatePlate(models, printer),
      volumes: models.map(modelVolume),
      lower: [...new Set(lower)],
      upper: [...new Set(upper)],
      layers: result.layers.length,
    };
  }, data);
  expect(result.names).toEqual(["Red base", "Blue cap"]);
  expect(result.palette.map((f) => f.color)).toEqual(["#cc4433", "#3366cc"]);
  expect(result.assemblies[0]).toBe(result.assemblies[1]);
  expect(result.bounds[0].min[2]).toBeCloseTo(0);
  expect(result.bounds[1].min[2]).toBeCloseTo(4);
  expect(result.volumes).toEqual([expect.closeTo(64), expect.closeTo(64)]);
  expect(result.errors).toEqual([]);
  expect(result.lower).toEqual([0]);
  expect(result.upper).toEqual([1]);
  expect(result.layers).toBeGreaterThan(35);
});

test("imported assembly can be recolored, moved, duplicated, and recovered without separating parts", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const data = await fixture(page);
  await page.locator(".project-menu").click();
  await page
    .getByRole("menuitem", { name: "New project", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Printer", exact: true }).click();
  await page
    .getByRole("option", { name: "Custom multi-extruder FDM", exact: true })
    .click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "two-colors.3mf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(data),
    });
  await expect(page.locator(".object-row")).toHaveCount(2);
  await expect(
    page.getByRole("switch", { name: "Transform assembly" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Move (M)", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Position X", exact: true })
    .fill("30");
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Duplicate object (⌘D)" }).click();
  await expect(page.locator(".object-row")).toHaveCount(4);
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.reload();
  await expect(page.locator(".object-row")).toHaveCount(4);
  const saved = await page.evaluate(async () => {
    const { loadLocal } = await import("/src/lib/project.ts");
    const p = await loadLocal();
    return p!.models.map((m) => ({
      tool: m.tool,
      position: m.position,
      assembly: m.assemblyId,
    }));
  });
  expect(saved[0].position).toEqual(saved[1].position);
  expect(saved[2].position).toEqual(saved[3].position);
  expect(saved[0].assembly).not.toBe(saved[2].assembly);
  expect(saved.map((m) => m.tool)).toEqual([1, 2, 1, 2]);
});
