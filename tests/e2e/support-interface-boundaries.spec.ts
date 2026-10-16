import { test, expect } from "@playwright/test";
test("interface-enabled manual trees obey paint blockers and volume contacts without inventing automatic contacts", async ({
  page,
}) => {
  await page.goto("/");
  const counts = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { paintSupportSurface } = await import("/src/lib/support-paint.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const roof = {
      ...primitive("cube", 1),
      position: [0, 0, 8],
      scale: [0.4, 0.4, 0.1],
    };
    const enforced = {
      ...roof,
      modifiers: [
        {
          ...primitive("cube", 1),
          enabled: true,
          kind: "support-enforcer",
          infill: 0,
          infillPattern: "grid",
          position: [0, 0, -1],
          scale: [2, 2, 2],
        },
      ],
    };
    const blocked = {
      ...enforced,
      ...paintSupportSurface(enforced, {
        point: [0, 0, 8],
        normal: [0, 0, -1],
        mode: "face",
        radius: 3,
        tool: 2,
        sourceTool: 0,
      }),
    };
    const counts = [];
    for (const model of [roof, enforced, blocked]) {
      const r = await slicePlate(
        [model],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          supportTopInterfaceLayers: 3,
          supportBottomInterfaceLayers: 2,
          supportInterfaceDensity: 85,
          supports: "tree-manual",
          adhesion: "none",
          minLayerTime: 0,
        },
        () => {},
        new AbortController().signal,
      );
      counts.push(
        r.layers.reduce(
          (n, l) => n + [...l.features].filter((f) => f === 3).length,
          0,
        ),
      );
    }
    return counts;
  });
  expect(counts[0]).toBe(0);
  expect(counts[1]).toBeGreaterThan(100);
  expect(counts[2]).toBe(0);
});

test("interface-enabled tree bed roots remain on the plate and receive a raft beneath an elevated hollow part", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const roof = {
      ...primitive("torus", 1),
      scale: [0.3, 0.3, 0.3],
      position: [0, 0, 8],
    };
    const result = await slicePlate(
      [roof],
      PRINTERS[0],
      {
        ...DEFAULT_SETTINGS,
        supportTopInterfaceLayers: 3,
        supportBottomInterfaceLayers: 2,
        supportInterfaceDensity: 85,
        supports: "tree",
        adhesion: "raft",
        minLayerTime: 0,
      },
      () => {},
      new AbortController().signal,
    );
    return result.layers.map((l) => ({
      z: l.z,
      paths: [...l.features].flatMap((f, i) =>
        f === 3 ? [{ p: [...l.segments.slice(i * 6, i * 6 + 6)] }] : [],
      ),
      all: [...l.segments],
    }));
  });
  const support = result.filter((l) => l.paths.length);
  expect(support.length).toBeGreaterThan(20);
  const before = result.filter((l) => l.z < support[0].z);
  expect(before.length).toBeGreaterThan(0);
  const raft = before.at(-1)!.all;
  const xs = raft.filter((_, i) => i % 3 === 0),
    ys = raft.filter((_, i) => i % 3 === 1);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  let outsideRaft = 0,
    outsideBed = 0;
  for (const { p } of support[0].paths)
    for (const i of [0, 3])
      if (
        p[i] < minX - 0.01 ||
        p[i] > maxX + 0.01 ||
        p[i + 1] < minY - 0.01 ||
        p[i + 1] > maxY + 0.01
      )
        outsideRaft++;
  for (const l of support)
    for (const { p } of l.paths)
      for (const i of [0, 3])
        if (p[i] <= 0 || p[i] >= 220 || p[i + 1] <= 0 || p[i + 1] >= 220)
          outsideBed++;
  expect(outsideRaft).toBe(0);
  expect(outsideBed).toBe(0);
});

test("Bambu interface-enabled tree supports retain the reserved corner and use the selected filament", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const printer = await loadVendorPrinter(
      VENDOR_PRINTERS.find((p) => p.id === "bambu-p1s")!,
    );
    const model = {
      ...primitive("cube", 1),
      position: [-106, -114, 10],
      scale: [0.2, 0.3, 0.1],
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      supportTopInterfaceLayers: 3,
      supportBottomInterfaceLayers: 2,
      supportInterfaceDensity: 85,
      supports: "tree",
      adhesion: "none",
      minLayerTime: 0,
    };
    const result = await slicePlate(
      [model],
      printer,
      settings,
      () => {},
      new AbortController().signal,
      [0, 1].map((i) => defaultFilament(settings, i)),
      { ...DEFAULT_MULTI_MATERIAL, supportTool: 1, purgeVolume: 1 },
    );
    return {
      paths: result.layers.flatMap((l) =>
        [...l.features].flatMap((f, i) =>
          f === 3
            ? [{ p: [...l.segments.slice(i * 6, i * 6 + 6)], tool: l.tools[i] }]
            : [],
        ),
      ),
      warnings: result.warnings,
    };
  });
  expect(result.paths.length).toBeGreaterThan(100);
  let collision = 0,
    wrongTool = 0;
  for (const { p, tool } of result.paths) {
    if (tool !== 1) wrongTool++;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const x = p[0] + t * (p[3] - p[0]),
        y = p[1] + t * (p[4] - p[1]);
      if (x < 18 && y < 28) collision++;
    }
  }
  expect(collision).toBe(0);
  expect(wrongTool).toBe(0);
});
