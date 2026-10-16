import { test, expect } from "@playwright/test";
test("engine produces distinct real infill patterns and spiral vase layers", async ({
  page,
}) => {
  await page.goto("/");
  const output = await page.evaluate(async () => {
    const geo = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const model = geo.primitive("cube", 1);
    model.scale = [0.5, 0.5, 0.5];
    const results = [];
    for (const pattern of [
      "gyroid",
      "grid",
      "hex",
      "triangle",
      "linear",
      "cubic",
      "vase",
    ]) {
      const s = {
        ...DEFAULT_SETTINGS,
        adhesion: "none",
        layerHeight: 0.25,
        firstLayerHeight: 0.25,
        infill: 20,
        vase: pattern === "vase",
        infillPattern: pattern === "vase" ? "gyroid" : pattern,
      };
      const r = await slicePlate(
        [model],
        PRINTERS[0],
        s,
        () => {},
        new AbortController().signal,
      );
      results.push({
        pattern,
        layers: r.layers.length,
        filament: r.filament,
        invalid: r.gcode
          .split("\n")
          .filter(
            (l: string) =>
              !l.startsWith(";") && /NaN|Infinity|undefined/.test(l),
          ),
        features: [
          ...new Set(r.layers.flatMap((l: any) => Array.from(l.features))),
        ],
      });
    }
    return results;
  });
  expect(output).toHaveLength(7);
  for (const r of output) {
    expect(r.invalid).toEqual([]);
    expect(r.layers).toBeGreaterThan(30);
    expect(r.layers).toBeLessThan(45);
    expect(r.filament).toBeGreaterThan(0);
  }
  expect(
    new Set(output.map((r) => Math.round(r.filament))).size,
  ).toBeGreaterThan(3);
  expect(output.find((r) => r.pattern === "vase")!.filament).toBeLessThan(
    output[0].filament,
  );
});
test("automatic normal and legacy tree settings produce normal support extrusion paths", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const geo = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const stem = geo.primitive("cube", 1);
    stem.scale = [0.25, 0.5, 0.5];
    const top = geo.primitive("cube", 1);
    top.scale = [1.5, 0.5, 0.25];
    top.position = [0, 0, 9.9];
    const model = {
      ...stem,
      scale: [1, 1, 1],
      name: "Overhang test",
      positions: geo.mergedVertices([stem, top]),
    };
    const results = [];
    for (const supports of ["disabled", "auto", "tree"]) {
      const r = await slicePlate(
        [model],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          layerHeight: 0.25,
          firstLayerHeight: 0.25,
          adhesion: "none",
          supports,
        },
        () => {},
        new AbortController().signal,
      );
      results.push({
        supports,
        filament: r.filament,
        supportSegments: r.layers.reduce(
          (n: number, l: any) =>
            n + Array.from(l.features).filter((v) => v === 3).length,
          0,
        ),
      });
    }
    return results;
  });
  expect(result[0].supportSegments).toBe(0);
  expect(result[1].supportSegments).toBeGreaterThan(0);
  expect(result[2].supportSegments).toBeGreaterThan(0);
  expect(result[1].filament).toBeGreaterThan(result[0].filament);
});
test("STL, OBJ and 3MF import actual meshes into the workspace", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Slice plate", exact: true }),
  ).toBeEnabled();
  const files = await page.evaluate(async () => {
    const geo = await import("/src/lib/geometry.ts");
    const { zipSync, strToU8 } =
      await import("/node_modules/.vite/deps/fflate.js");
    const stl = geo.exportSTL([geo.primitive("cube", 1)]);
    const obj =
      "v 0 0 0\nv 20 0 0\nv 0 20 0\nv 0 0 20\nf 1 3 2\nf 1 2 4\nf 2 3 4\nf 3 1 4";
    const model =
      '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="20" y="0" z="0"/><vertex x="0" y="20" z="0"/><vertex x="0" y="0" z="20"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="2" v2="0" v3="3"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
    const rels =
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
    const mf = zipSync({
      "3D/3dmodel.model": strToU8(model),
      "_rels/.rels": strToU8(rels),
    });
    const inch = zipSync({
      "3D/3dmodel.model": strToU8(
        model
          .replace('unit="millimeter"', 'unit="inch"')
          .replaceAll('="20"', '="1"'),
      ),
      "_rels/.rels": strToU8(rels),
    });
    return [
      { name: "cube.stl", data: Array.from(new Uint8Array(stl)) },
      { name: "tetra.obj", data: Array.from(strToU8(obj)) },
      { name: "tetra.3mf", data: Array.from(mf) },
      { name: "inch.3mf", data: Array.from(inch) },
    ];
  });
  for (const file of files)
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: file.name,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(file.data),
      });
  await expect(page.locator(".object-row")).toHaveCount(5);
  await expect(page.locator(".dimension-readout")).toContainText(
    "25.4 × 25.4 × 25.4",
  );
});

test("multi-extruder engine retains non-contiguous tools and produces a purge tower", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } =
      await import("/src/lib/multimaterial.ts");
    const a = primitive("cube", 1),
      b = primitive("cube", 1);
    a.scale = b.scale = [0.4, 0.4, 0.1];
    a.position = [-10, 0, 0];
    b.position = [10, 0, 0];
    a.tool = 0;
    b.tool = 2;
    const settings = { ...DEFAULT_SETTINGS, adhesion: "none" };
    const result = await slicePlate(
      [a, b],
      { ...PRINTERS[0], toolCount: 4, multiMaterialMode: "toolchanger" },
      settings,
      () => {},
      new AbortController().signal,
      [0, 1, 2].map((i) => defaultFilament(settings, i)),
      { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 30 },
    );
    return {
      tools: result.tools,
      toolChanges: result.toolChanges,
      layers: result.layers.map((l) => ({
        tools: [...new Set(l.tools)],
        features: [...new Set(l.features)],
      })),
      gcode: result.gcode,
    };
  });
  expect(result.tools.map((t) => t.tool)).toEqual([0, 2]);
  expect(result.toolChanges).toBeGreaterThan(5);
  expect(result.layers.length).toBeGreaterThan(5);
  expect(
    result.layers.some((l) => l.tools.includes(0) && l.tools.includes(2)),
  ).toBe(true);
  expect(result.layers.some((l) => l.features.includes(5))).toBe(true);
  expect(result.gcode).toContain("T2");
  expect(result.gcode).not.toMatch(/NaN|undefined|Infinity/);
});

test("dedicated support filament is used only for supports and purge in normal and legacy tree modes", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const geo = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } =
      await import("/src/lib/multimaterial.ts");
    const stem = geo.primitive("cube", 1),
      top = geo.primitive("cube", 1);
    stem.scale = [0.25, 0.4, 0.3];
    top.scale = [1.1, 0.4, 0.15];
    top.position = [0, 0, 5.9];
    const model = {
      ...stem,
      tool: 1,
      scale: [1, 1, 1],
      positions: geo.mergedVertices([stem, top]),
    };
    const results = [];
    for (const supports of ["auto", "tree"]) {
      const settings = {
        ...DEFAULT_SETTINGS,
        supports,
        adhesion: "none",
        layerHeight: 0.25,
        firstLayerHeight: 0.25,
      };
      const filaments = [0, 1, 2].map((i) => ({
        ...defaultFilament(settings, i),
        nozzleTemp: 210 + i * 5,
        firstNozzleTemp: 210 + i * 5,
      }));
      const r = await slicePlate(
        [model],
        PRINTERS.find((p) => p.id === "generic-multi")!,
        settings,
        () => {},
        new AbortController().signal,
        filaments,
        { ...DEFAULT_MULTI_MATERIAL, supportTool: 2, purgeVolume: 20 },
      );
      const supportTools = new Set<number>(),
        modelTools = new Set<number>();
      let supportSegments = 0;
      for (const l of r.layers)
        for (let i = 0; i < l.features.length; i++) {
          if (l.features[i] === 3) {
            supportTools.add(l.tools[i]);
            supportSegments++;
          } else if (l.features[i] !== 4 && l.features[i] !== 5)
            modelTools.add(l.tools[i]);
        }
      results.push({
        supports,
        supportTools: [...supportTools],
        modelTools: [...modelTools],
        supportSegments,
        used: r.tools.map((t) => t.tool),
        hasSupportTool: r.gcode.includes("T2"),
        invalid: r.gcode
          .split("\n")
          .filter((line) => /NaN|undefined|Infinity/.test(line.split(";")[0])),
      });
    }
    return results;
  });
  for (const r of result) {
    expect(r.supportSegments, r.supports).toBeGreaterThan(0);
    expect(r.supportTools, r.supports).toEqual([2]);
    expect(r.modelTools, r.supports).toEqual([1]);
    expect(r.used, r.supports).toEqual([1, 2]);
    expect(r.hasSupportTool).toBe(true);
    expect(r.invalid).toEqual([]);
  }
});
