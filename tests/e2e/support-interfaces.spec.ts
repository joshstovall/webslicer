import { expect, test } from "@playwright/test";

for (const supports of ["auto", "tree"])
  for (const schedule of ["fixed", "adaptive", "manual"])
    test(`${supports} interfaces replace only contact fill on the ${schedule} grid`, async ({
      page,
    }) => {
      await page.goto("/");
      const out = await page.evaluate(
        async ({ supports, schedule }) => {
          const { primitive } = await import("/src/lib/geometry.ts");
          const { slicePlate } = await import("/src/lib/slicer.ts");
          const { DEFAULT_SETTINGS, PRINTERS } = await import(
            "/src/lib/profiles.ts"
          );
          const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
            "/src/lib/multimaterial.ts"
          );
          const cube = primitive("cube", 1);
          const models = [
            { ...cube, id: "base", tool: 0, scale: [0.4, 0.4, 0.1] },
            {
              ...cube,
              id: "roof",
              tool: 1,
              position: [0, 0, 8],
              scale: [1, 1, 0.1],
            },
          ];
          const settings = {
            ...DEFAULT_SETTINGS,
            supports,
            adhesion: "none",
            minLayerTime: 0,
            firstLayerHeight: 0.2,
            layerHeight: schedule === "manual" ? 0.28 : 0.2,
            adaptive: schedule === "adaptive",
            minLayerHeight: 0.1,
            manualLayers: schedule === "manual",
            layerHeightCurve: [
              { z: 0, height: 0.12 },
              { z: 5, height: 0.28 },
              { z: 10, height: 0.12 },
            ],
          };
          const results = [];
          for (const config of [
            { top: 0, bottom: 0 },
            { top: 3, bottom: 0 },
            { top: 0, bottom: 2 },
            { top: 3, bottom: 2 },
          ]) {
            const result = await slicePlate(
              models,
              PRINTERS.find((p) => p.id === "generic-multi")!,
              {
                ...settings,
                supportTopInterfaceLayers: config.top,
                supportBottomInterfaceLayers: config.bottom,
                supportInterfaceDensity: 90,
                supportInterfaceAngle: 45,
              },
              () => {},
              new AbortController().signal,
              [0, 1, 2].map((i) => defaultFilament(settings, i)),
              { ...DEFAULT_MULTI_MATERIAL, supportTool: 2, purgeVolume: 1 },
            );
            results.push({
              config,
              layers: result.layers.map((l) => {
                const paths = [...l.features].flatMap((f, i) =>
                  f === 3
                    ? [
                        {
                          tool: l.tools[i],
                          p: [...l.segments.slice(i * 6, i * 6 + 6)],
                        },
                      ]
                    : [],
                );
                const keys = paths.map(({ p }) =>
                  [
                    p
                      .slice(0, 3)
                      .map((v) => v.toFixed(3))
                      .join(),
                    p
                      .slice(3)
                      .map((v) => v.toFixed(3))
                      .join(),
                  ]
                    .sort()
                    .join("/"),
                );
                return {
                  z: l.z,
                  paths,
                  length: paths.reduce(
                    (s, { p }) => s + Math.hypot(p[3] - p[0], p[4] - p[1]),
                    0,
                  ),
                  duplicates: keys.length - new Set(keys).size,
                };
              }),
            });
          }
          return results;
        },
        { supports, schedule },
      );
      const [baseline, top, bottom, both] = out;
      const changed = (r: typeof baseline) =>
        r.layers.filter(
          (l, i) => Math.abs(l.length - baseline.layers[i].length) > 0.1,
        );
      const topChanges = changed(top),
        bottomChanges = changed(bottom);
      expect(topChanges.length).toBe(3);
      expect(bottomChanges.length).toBe(2);
      expect(topChanges.every((l) => l.z > 6.5 && l.z < 8)).toBe(true);
      expect(bottomChanges.every((l) => l.z > 2 && l.z < 3.5)).toBe(true);
      expect(changed(both).length).toBe(5);
      const supportLayers = baseline.layers.filter((l) => l.paths.length);
      expect(supportLayers.length).toBeGreaterThan(20);
      for (const r of [top, bottom, both]) {
        expect(
          r.layers.flatMap((l) => l.paths).every((p) => p.tool === 2),
        ).toBe(true);
        expect(r.layers.reduce((n, l) => n + l.duplicates, 0)).toBe(0);
      }
      // Density replaces the body locally; the rest of the support remains sparse.
      for (const l of topChanges) {
        const original = baseline.layers.find((b) => b.z === l.z)!;
        expect(l.length).toBeGreaterThan(original.length * 2);
        const diagonal = l.paths.filter(
          ({ p }) =>
            Math.abs(Math.abs(p[3] - p[0]) - Math.abs(p[4] - p[1])) < 0.03 &&
            Math.hypot(p[3] - p[0], p[4] - p[1]) > 2,
        );
        expect(diagonal.length).toBeGreaterThan(5);
      }
      // Neither the reserved vertical contact gap nor model material is filled.
      let collisions = 0;
      for (const l of both.layers)
        for (const { p } of l.paths)
          for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            const x = p[0] + t * (p[3] - p[0]) - 128,
              y = p[1] + t * (p[4] - p[1]) - 128;
            if (
              (l.z <= 2.001 && Math.abs(x) < 4 && Math.abs(y) < 4) ||
              l.z >= 8.001
            )
              collisions++;
          }
      expect(collisions).toBe(0);
    });

for (const supports of ["auto", "tree"])
  test(`${supports} overlapping interfaces form one fill and alternate 0/90 degrees`, async ({
    page,
  }) => {
    await page.goto("/");
    const out = await page.evaluate(async (supports) => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const { DEFAULT_SETTINGS, PRINTERS } = await import(
        "/src/lib/profiles.ts"
      );
      const cube = primitive("cube", 1);
      const models = [
        { ...cube, id: "base", scale: [1, 1, 0.1] },
        { ...cube, id: "roof", position: [0, 0, 3.2], scale: [0.8, 0.8, 0.1] },
      ];
      const settings = {
        ...DEFAULT_SETTINGS,
        supports,
        adhesion: "none",
        minLayerTime: 0,
        firstLayerHeight: 0.2,
        supportInterfaceDensity: 100,
        supportInterfaceAngle: 0,
      };
      const results = [];
      for (const bottom of [0, 10]) {
        const result = await slicePlate(
          models,
          PRINTERS[0],
          {
            ...settings,
            supportTopInterfaceLayers: 10,
            supportBottomInterfaceLayers: bottom,
          },
          () => {},
          new AbortController().signal,
        );
        results.push(
          result.layers
            .filter((l) => [...l.features].includes(3))
            .map((l) => {
              const paths = [...l.features].flatMap((f, i) =>
                f === 3 ? [[...l.segments.slice(i * 6, i * 6 + 6)]] : [],
              );
              const length = paths.reduce(
                (s, p) => s + Math.hypot(p[3] - p[0], p[4] - p[1]),
                0,
              );
              const horizontal = paths.filter(
                (p) =>
                  Math.abs(p[4] - p[1]) < 0.01 && Math.abs(p[3] - p[0]) > 3,
              ).length;
              const vertical = paths.filter(
                (p) =>
                  Math.abs(p[3] - p[0]) < 0.01 && Math.abs(p[4] - p[1]) > 3,
              ).length;
              const lines = new Map<string, [number, number][]>();
              for (const p of paths) {
                let key: string, interval: [number, number];
                if (Math.abs(p[3] - p[0]) < 0.001) {
                  key = `v:${p[0].toFixed(3)}`;
                  interval = [Math.min(p[1], p[4]), Math.max(p[1], p[4])];
                } else if (Math.abs(p[4] - p[1]) < 0.001) {
                  key = `h:${p[1].toFixed(3)}`;
                  interval = [Math.min(p[0], p[3]), Math.max(p[0], p[3])];
                } else continue;
                if (!lines.has(key)) lines.set(key, []);
                lines.get(key)!.push(interval);
              }
              let overlap = 0;
              for (const intervals of lines.values()) {
                intervals.sort((a, b) => a[0] - b[0]);
                let end = -Infinity;
                for (const [a, b] of intervals) {
                  overlap += Math.max(0, Math.min(end, b) - a);
                  end = Math.max(end, b);
                }
              }
              return { z: l.z, length, horizontal, vertical, overlap };
            }),
        );
      }
      return results;
    }, supports);
    expect(out[0].length).toBeGreaterThan(2);
    expect(out[1].map((l) => l.z)).toEqual(out[0].map((l) => l.z));
    // Trees can widen beyond their roof footprint. Bottom contact coverage can
    // add legitimate fill there, but shared top/bottom paths must never overlap.
    if (supports === "auto") expect(out[1]).toEqual(out[0]);
    expect(out.flat().every((l) => l.overlap < 0.01)).toBe(true);
    expect(out[1].every((l, i) => l.length < out[0][i].length * 1.15)).toBe(
      true,
    );
    expect(out[0].every((l) => l.z > 2 && l.z < 3.2)).toBe(true);
    const directions = out[0].map((l) =>
      l.horizontal > l.vertical ? "h" : "v",
    );
    expect(out[0].every((l) => Math.max(l.horizontal, l.vertical) > 15)).toBe(
      true,
    );
    expect(directions.every((d, i) => !i || d !== directions[i - 1])).toBe(
      true,
    );
  });

test("cancelling interface planning releases the engine and permits a fresh export", async ({
  page,
}) => {
  await page.goto("/");
  const out = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const model = {
      ...primitive("cube", 1),
      position: [0, 0, 8],
      scale: [1, 1, 0.1],
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      supports: "auto",
      adhesion: "none",
      supportTopInterfaceLayers: 3,
    };
    const controller = new AbortController();
    let cancelled = false,
      error = "";
    try {
      await slicePlate(
        [model],
        PRINTERS[0],
        settings,
        (_, stage) => {
          if (stage === "Filling support interfaces") {
            cancelled = true;
            controller.abort();
          }
        },
        controller.signal,
      );
    } catch (e) {
      error = String(e);
    }
    const frames = document.querySelectorAll(
      'iframe[title="Local slicing engine"]',
    ).length;
    const retry = await slicePlate(
      [model],
      PRINTERS[0],
      settings,
      () => {},
      new AbortController().signal,
    );
    return {
      cancelled,
      error,
      frames,
      supports: retry.layers.some((l) => [...l.features].includes(3)),
    };
  });
  expect(out.cancelled).toBe(true);
  expect(out.error).toMatch(/cancel|abort/i);
  expect(out.frames).toBe(0);
  expect(out.supports).toBe(true);
});
