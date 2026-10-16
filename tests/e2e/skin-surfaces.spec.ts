import { test, expect } from "@playwright/test";

test("skin projection stops at air gaps and retains model-space counts above a supported raft", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const mask = {
      ...primitive("cube", 1),
      kind: "skins",
      enabled: true,
      topLayers: 10,
      bottomLayers: 0,
      infill: 0,
      infillPattern: "grid",
      position: [0, 0, -1],
      scale: [2, 2, 10],
    };
    const r = await slicePlate(
      [
        {
          ...primitive("cube", 1),
          assemblyId: "gap",
          scale: [1, 1, 0.05],
          modifiers: [mask],
        },
        {
          ...primitive("cube", 1),
          assemblyId: "gap",
          scale: [1, 1, 0.05],
          position: [0, 0, 2],
        },
      ],
      PRINTERS.find((p) => p.id === "generic-multi")!,
      {
        ...DEFAULT_SETTINGS,
        infill: 0,
        adhesion: "raft",
        supports: "auto",
        minLayerTime: 0,
        firstLayerHeight: 0.2,
      },
      () => {},
      new AbortController().signal,
      [0, 1].map((t) => defaultFilament(DEFAULT_SETTINGS, t)),
      { ...DEFAULT_MULTI_MATERIAL, supportTool: 1, purgeVolume: 1 },
    );
    return r.layers.map((l) => ({
      z: l.z,
      walls: [...l.features].filter((f, i) => f === 0 && l.tools[i] === 0)
        .length,
      skins: [...l.features].filter((f) => f === 2 || f === 6).length,
      supports: [...l.features].filter((f) => f === 3).length,
    }));
  });
  expect(result.some((l) => l.supports > 0)).toBe(true);
  const model = result.filter((l) => l.walls > 0),
    offset = model[0].z - 0.2;
  expect(offset).toBeGreaterThan(0.5);
  expect(model).toHaveLength(10);
  for (const layer of model)
    expect(layer.skins, `Skins at model Z ${layer.z - offset}`).toBeGreaterThan(
      0,
    );
  expect(model.map((l) => Number((l.z - offset).toFixed(2)))).toEqual([
    0.2, 0.4, 0.6, 0.8, 1, 2.2, 2.4, 2.6, 2.8, 3,
  ]);
});

test("rotated hollow skin volumes retain their holes using independent triangle-ray containment", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive, geometryOf } = await import("/src/lib/geometry.ts");
    const { worldModifiers } = await import("/src/lib/modifiers.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3 } =
      await import("/node_modules/.vite/deps/three.js");
    const mask = {
      ...primitive("torus", 1),
      kind: "skins",
      enabled: true,
      topLayers: 0,
      bottomLayers: 0,
      infill: 0,
      infillPattern: "grid",
      position: [0, 0, -20],
      scale: [0.3, 0.6, 8],
      rotation: [0, 0, 30],
    };
    const model = {
      ...primitive("cube", 1),
      scale: [1, 1, 0.2],
      modifiers: [mask],
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      infill: 0,
      adhesion: "none",
      minLayerTime: 0,
      firstLayerHeight: 0.2,
    };
    const r = await slicePlate(
      [model],
      PRINTERS[0],
      settings,
      () => {},
      new AbortController().signal,
    );
    const geometry = geometryOf(worldModifiers(model)[0].vertices, false),
      material = new MeshBasicMaterial({ side: DoubleSide }),
      mesh = new Mesh(geometry, material),
      ray = new Raycaster();
    mesh.updateMatrixWorld(true);
    let tested = 0,
      inside = 0,
      hole = 0,
      outside = 0;
    for (const layer of r.layers.filter(
      (l) => Math.abs(l.z - 4) < 0.01 || Math.abs(l.z - 0.2) < 0.01,
    )) {
      for (let i = 0; i < layer.features.length; i++)
        if (layer.features[i] === 2) {
          const p = layer.segments.slice(i * 6, i * 6 + 6);
          for (const t of [0.2, 0.5, 0.8]) {
            const x = p[0] + (p[3] - p[0]) * t - 110,
              y = p[1] + (p[4] - p[1]) * t - 110,
              z = layer.z - 0.1;
            ray.set(new Vector3(x, y, z), new Vector3(1, 0, 0));
            const hits = ray
              .intersectObject(mesh)
              .map((h) => h.distance)
              .filter((d, i, a) => i === 0 || Math.abs(d - a[i - 1]) > 1e-5);
            ray.set(new Vector3(x, y, z), new Vector3(-1, 0, 0));
            const reverse = ray.intersectObject(mesh)[0]?.distance ?? Infinity;
            // The engine and G-code quantize boundaries; test their interiors.
            if (Math.min(hits[0] ?? Infinity, reverse) < 0.001) continue;
            tested++;
            if (hits.length % 2) inside++;
            if (Math.hypot(x, y) < 3) hole++;
            if (Math.hypot(x, y) > 10) outside++;
          }
        }
    }
    geometry.dispose();
    material.dispose();
    return { tested, inside, hole, outside };
  });
  expect(result.tested).toBeGreaterThan(100);
  expect(result.inside).toBe(0);
  expect(result.hole).toBeGreaterThan(0);
  expect(result.outside).toBeGreaterThan(0);
});

test("regional skins follow a stepped physical surface without adding a floor at a color boundary", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const settings = {
      ...DEFAULT_SETTINGS,
      adhesion: "none",
      minLayerTime: 0,
      infill: 0,
      firstLayerHeight: 0.2,
    };
    const modifier = {
      ...primitive("cube", 1),
      kind: "skins",
      enabled: true,
      topLayers: 2,
      bottomLayers: 1,
      infill: 0,
      infillPattern: "grid",
      position: [0, 0, -1],
      scale: [2, 2, 10],
    };
    const r = await slicePlate(
      [
        {
          ...primitive("cube", 1),
          assemblyId: "step",
          scale: [1, 1, 0.1],
          modifiers: [modifier],
        },
        {
          ...primitive("cube", 1),
          assemblyId: "step",
          tool: 1,
          scale: [0.5, 1, 0.1],
          position: [5, 0, 2],
        },
      ],
      PRINTERS.find((p) => p.id === "generic-multi")!,
      settings,
      () => {},
      new AbortController().signal,
      [0, 1].map((t) => defaultFilament(settings, t)),
      { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
    );
    return r.layers.map((l) => ({
      z: l.z,
      paths: [...l.features].flatMap((f, i) =>
        f === 2 || f === 6
          ? [
              {
                f,
                tool: l.tools[i],
                p: [...l.segments.slice(i * 6, i * 6 + 6)],
              },
            ]
          : [],
      ),
    }));
  });
  const layer = (z: number) => result.find((l) => Math.abs(l.z - z) < 0.01)!;
  for (const z of [0.4, 1.6, 2.2, 2.4, 3.6])
    expect(layer(z).paths, `Skins at ${z}`).toHaveLength(0);
  expect(layer(0.2).paths.length).toBeGreaterThan(0);
  for (const z of [1.8, 2]) {
    expect(layer(z).paths.length).toBeGreaterThan(0);
    for (const { tool, p } of layer(z).paths) {
      expect(tool).toBe(0);
      expect(Math.max(p[0], p[3])).toBeLessThanOrEqual(128.001);
    }
  }
  for (const z of [3.8, 4]) {
    expect(layer(z).paths.length).toBeGreaterThan(0);
    expect(new Set(layer(z).paths.map((p) => p.tool))).toEqual(new Set([1]));
  }
});

for (const schedule of ["adaptive", "manual"])
  test(`skin counts use actual ${schedule} layers across stacked materials`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (schedule) => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const { DEFAULT_SETTINGS, PRINTERS } = await import(
        "/src/lib/profiles.ts"
      );
      const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
        "/src/lib/multimaterial.ts"
      );
      const settings = {
        ...DEFAULT_SETTINGS,
        adhesion: "none",
        minLayerTime: 0,
        infill: 0,
        firstLayerHeight: 0.2,
        layerHeight: 0.24,
        adaptive: schedule === "adaptive",
        manualLayers: schedule === "manual",
        layerHeightCurve: [
          { z: 0, height: 0.12 },
          { z: 4, height: 0.24 },
        ],
      };
      const modifier = {
        ...primitive("cube", 1),
        kind: "skins",
        enabled: true,
        topLayers: 3,
        bottomLayers: 2,
        infill: 0,
        infillPattern: "grid",
        position: [0, 0, -1],
        scale: [2, 2, 10],
      };
      const r = await slicePlate(
        [
          {
            ...primitive("cube", 1),
            assemblyId: "stack",
            scale: [1, 1, 0.1],
            modifiers: [modifier],
          },
          {
            ...primitive("cube", 1),
            assemblyId: "stack",
            tool: 1,
            scale: [1, 1, 0.1],
            position: [0, 0, 2],
          },
        ],
        PRINTERS.find((p) => p.id === "generic-multi")!,
        settings,
        () => {},
        new AbortController().signal,
        [0, 1].map((t) => defaultFilament(settings, t)),
        { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
      );
      return r.layers
        .filter((l) => [...l.features].some((f) => f === 0))
        .map((l) => ({
          z: l.z,
          skins: [...l.features].filter((f) => f === 2 || f === 6).length,
        }));
    }, schedule);
    expect(result.length).toBeGreaterThan(15);
    for (let i = 0; i < result.length; i++)
      expect(result[i].skins > 0, `Skin layer ${i} at ${result[i].z}`).toBe(
        i < 2 || i >= result.length - 3,
      );
    expect(
      new Set(result.slice(1).map((l, i) => (l.z - result[i].z).toFixed(3)))
        .size,
    ).toBeGreaterThan(1);
  });
