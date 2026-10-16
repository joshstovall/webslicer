import { test, expect } from "@playwright/test";
test("overlapping assembly materials become disjoint real extrusion paths", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { assembleModels } = await import("/src/lib/assemblies.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } =
      await import("/src/lib/multimaterial.ts");
    const a = {
        ...primitive("cube", 1),
        position: [-1, 0, 0],
        scale: [0.2, 0.2, 0.1],
      },
      b = {
        ...primitive("cube", 1),
        position: [1, 0, 0],
        scale: [0.2, 0.2, 0.1],
        tool: 1,
      };
    const r = await slicePlate(
      assembleModels([a, b]),
      PRINTERS.find((p) => p.id === "generic-multi")!,
      { ...DEFAULT_SETTINGS, adhesion: "none" },
      () => {},
      new AbortController().signal,
      [0, 1].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
      { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
    );
    const xs = [[], []] as number[][];
    for (const layer of r.layers)
      for (let i = 0; i < layer.features.length; i++) {
        if (layer.features[i] === 4 || layer.features[i] === 5) continue;
        xs[layer.tools[i]].push(
          layer.segments[i * 6] - 128,
          layer.segments[i * 6 + 3] - 128,
        );
      }
    return {
      ranges: xs.map((values) => [Math.min(...values), Math.max(...values)]),
      tools: r.tools.map((t) => t.tool),
    };
  });
  expect(result.tools).toEqual([0, 1]);
  expect(result.ranges[0][1]).toBeLessThanOrEqual(-0.99);
  expect(result.ranges[1][0]).toBeGreaterThanOrEqual(-1.01);
});

test("painted 3MF triangles retain their subdivisions and produce assigned toolpaths", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive, importModelFile } = await import("/src/lib/geometry.ts");
    const { zipSync, strToU8 } =
      await import("/node_modules/.vite/deps/fflate.js");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } =
      await import("/src/lib/multimaterial.ts");
    const p = primitive("cube", 1).positions.map((v) => v * 0.3);
    const vertices = Array.from(
      { length: p.length / 3 },
      (_, i) =>
        `<vertex x="${p[i * 3]}" y="${p[i * 3 + 1]}" z="${p[i * 3 + 2]}"/>`,
    ).join("");
    const triangles = Array.from(
      { length: p.length / 9 },
      (_, i) =>
        `<triangle v1="${i * 3}" v2="${i * 3 + 1}" v3="${i * 3 + 2}"${[2, 5, 8].every((j) => p[i * 9 + j] === 6) ? ' paint_color="44883"' : ""}/>`,
    ).join("");
    const xml = `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
    const archive = zipSync({ "3D/3dmodel.model": strToU8(xml) });
    const imported = await importModelFile(
      new File([archive], "painted.3mf"),
      1,
    );
    const model = imported.models[0];
    const r = await slicePlate(
      [model],
      PRINTERS.find((p) => p.id === "generic-multi")!,
      { ...DEFAULT_SETTINGS, adhesion: "none" },
      () => {},
      new AbortController().signal,
      imported.palette.map((f, i) => ({
        ...defaultFilament(DEFAULT_SETTINGS, i),
        ...f,
      })),
      { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
    );
    return {
      base: model.positions.length,
      surface: model.paintTriangles?.length,
      paints: [...new Set(model.faceTools)],
      tools: r.tools.map((t) => t.tool),
      highTools: [
        ...new Set(
          r.layers.filter((l) => l.z > 5.5).flatMap((l) => [...l.tools]),
        ),
      ],
    };
  });
  expect(result.surface).toBeGreaterThan(result.base);
  expect(result.paints.sort()).toEqual([0, 1]);
  expect(result.tools).toEqual([0, 1]);
  expect(result.highTools).toContain(1);
});

test("material preparation can be cancelled without a leftover worker, then retried", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { paintSurface } = await import("/src/lib/surface-paint.ts");
    const { prepareMaterials } = await import("/src/lib/prepare-materials.ts");
    let model = primitive("cube", 1);
    model = {
      ...model,
      ...paintSurface(model, {
        point: [0, 0, 20],
        normal: [0, 0, 1],
        tool: 1,
        sourceTool: 0,
        radius: 3,
        mode: "brush",
      }),
    };
    const controller = new AbortController();
    let error = "";
    const job = prepareMaterials([model], 1, controller.signal, () => {});
    controller.abort();
    try {
      await job;
    } catch (e) {
      error = (e as Error).name;
    }
    const parts = await prepareMaterials(
      [model],
      1,
      new AbortController().signal,
      () => {},
    );
    return { error, tools: parts.map((p) => p.tool).sort() };
  });
  expect(result.error).toBe("AbortError");
  expect(result.tools).toEqual([0, 1]);
});

test("unavailable material WASM reports an error and the next attempt can succeed", async ({
  page,
}) => {
  await page.route("**/manifold.wasm", (route) => route.abort());
  await page.goto("/");
  const attempt = () =>
    page.evaluate(async () => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { paintSurface } = await import("/src/lib/surface-paint.ts");
      const { prepareMaterials } =
        await import("/src/lib/prepare-materials.ts");
      let m = primitive("cube", 1);
      m = {
        ...m,
        ...paintSurface(m, {
          point: [0, 0, 20],
          normal: [0, 0, 1],
          tool: 1,
          sourceTool: 0,
          radius: 3,
          mode: "face",
        }),
      };
      try {
        return {
          tools: (
            await prepareMaterials(
              [m],
              1,
              new AbortController().signal,
              () => {},
            )
          )
            .map((p) => p.tool)
            .sort(),
          error: "",
        };
      } catch (error) {
        return { tools: [], error: (error as Error).message };
      }
    });
  const failed = await attempt();
  expect(failed.error).not.toBe("");
  expect(failed.tools).toEqual([]);
  await page.unroute("**/manifold.wasm");
  const success = await attempt();
  expect(success.error).toBe("");
  expect(success.tools).toEqual([0, 1]);
});
