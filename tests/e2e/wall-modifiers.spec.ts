import { expect, test } from "@playwright/test";

test("surface skins meet the regional wall thickness and native thin-wall behavior survives clipping", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const mask = {
      ...primitive("cube", 1),
      kind: "walls",
      walls: 5,
      enabled: true,
      infill: 0,
      infillPattern: "grid",
      position: [-5, 0, -1],
      scale: [0.5, 2, 2],
    };
    const results = [];
    for (const shape of ["solid", "thin"]) {
      for (const mode of shape === "solid"
        ? ["modified"]
        : ["base", "five", "modified"]) {
        const r = await slicePlate(
          [
            {
              ...primitive("cube", 1),
              scale: [1, shape === "thin" ? 0.03 : 1, 0.2],
              modifiers: mode === "modified" ? [mask] : undefined,
            },
          ],
          PRINTERS[0],
          {
            ...DEFAULT_SETTINGS,
            walls: mode === "five" ? 5 : 3,
            adhesion: "none",
            minLayerTime: 0,
            firstLayerHeight: 0.2,
            infill: 20,
          },
          () => {},
          new AbortController().signal,
        );
        results.push({
          shape,
          mode,
          layers: r.layers
            .filter((l) => [0.2, 2, 4].some((z) => Math.abs(l.z - z) < 0.01))
            .map((l) => ({
              z: l.z,
              paths: [...l.features].flatMap((f, i) =>
                f <= 2
                  ? [{ f, p: [...l.segments.slice(i * 6, i * 6 + 6)] }]
                  : [],
              ),
            })),
        });
      }
    }
    return {
      results,
      center: PRINTERS[0].bed[0] / 2,
      width: DEFAULT_SETTINGS.lineWidth,
      overlap: DEFAULT_SETTINGS.infillOverlap,
    };
  });
  const c = results.center;
  for (const layer of results.results[0].layers.filter((l) => l.z !== 2)) {
    const skin = layer.paths
      .filter((p) => p.f === 2)
      .flatMap(({ p }) => [p.slice(0, 3), p.slice(3)]);
    expect(skin.length).toBeGreaterThan(10);
    for (const [side, count] of [
      [-1, 5],
      [1, 3],
    ]) {
      const points = skin.filter((p) => (p[0] - c) * side > 0.01);
      const inset = (count - 0.5 + 1 - results.overlap / 100) * results.width;
      expect(Math.min(...points.map((p) => p[1]))).toBeCloseTo(
        c - 10 + inset,
        2,
      );
      expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(
        c + 10 - inset,
        2,
      );
    }
  }
  const paths = (mode: string) =>
    results.results
      .find((r) => r.shape === "thin" && r.mode === mode)!
      .layers.find((l) => l.z === 2)!
      .paths.filter((p) => p.f === 0);
  const length = (mode: string, side: number) =>
    paths(mode).reduce((sum, { p }) => {
      const delta = Math.abs(p[3] - p[0]);
      const left =
        delta < 1e-6
          ? p[0] < c
            ? 1
            : 0
          : Math.max(0, Math.min(1, (c - Math.min(p[0], p[3])) / delta));
      return (
        sum +
        Math.hypot(p[3] - p[0], p[4] - p[1]) * (side < 0 ? left : 1 - left)
      );
    }, 0);
  expect(paths("modified").length).toBeGreaterThan(0);
  // End caps have short diagonal paths. Check the straight middle instead:
  // each millimeter must extrude exactly once, not on the skipped return.
  for (const mode of ["base", "five", "modified"]) {
    const middleLength = paths(mode).reduce((sum, { p }) => {
      const dx = Math.abs(p[3] - p[0]);
      const fraction =
        dx > 1e-6
          ? Math.max(
              0,
              Math.min(Math.max(p[0], p[3]), c + 7) -
                Math.max(Math.min(p[0], p[3]), c - 7),
            ) / dx
          : Number(p[0] > c - 7 && p[0] < c + 7);
      return sum + Math.hypot(p[3] - p[0], p[4] - p[1]) * fraction;
    }, 0);
    expect(middleLength).toBeCloseTo(14, 3);
  }
  expect(length("modified", -1)).toBeCloseTo(length("five", -1), 2);
  expect(length("modified", 1)).toBeCloseTo(length("base", 1), 2);
});

test("rotated nonuniform wall volumes preserve a hollow model's inner and outer perimeters on adaptive layers", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const angle = Math.PI / 6;
    const mask = {
      ...primitive("cube", 1),
      kind: "walls",
      walls: 4,
      enabled: true,
      infill: 0,
      infillPattern: "grid",
      rotation: [0, 0, 30],
      position: [-50 * Math.cos(angle), -50 * Math.sin(angle), -10],
      scale: [5, 7, 2],
    };
    const results = [];
    for (const mode of ["one", "four", "modified"]) {
      const r = await slicePlate(
        [
          {
            ...primitive("torus", 1),
            modifiers: mode === "modified" ? [mask] : undefined,
          },
        ],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          walls: mode === "four" ? 4 : 1,
          adhesion: "none",
          minLayerTime: 0,
          adaptive: true,
          infill: 15,
          thinWalls: true,
        },
        () => {},
        new AbortController().signal,
      );
      results.push({
        mode,
        layers: r.layers
          .filter((l) => l.z > 5 && l.z < 7)
          .map((l) => ({
            z: l.z,
            paths: [...l.features].flatMap((f, i) =>
              f === 0 ? [[...l.segments.slice(i * 6, i * 6 + 6)]] : [],
            ),
          })),
      });
    }
    return { results, center: PRINTERS[0].bed[0] / 2 };
  });
  const total = (paths: number[][], side: number) =>
    paths.reduce((sum, p) => {
      const c = result.center,
        angle = Math.PI / 6;
      const d0 = (p[0] - c) * Math.cos(angle) + (p[1] - c) * Math.sin(angle);
      const d1 = (p[3] - c) * Math.cos(angle) + (p[4] - c) * Math.sin(angle);
      const neg =
        d0 <= 0 && d1 <= 0
          ? 1
          : d0 >= 0 && d1 >= 0
            ? 0
            : Math.abs(Math.min(d0, d1)) / (Math.abs(d0) + Math.abs(d1));
      return (
        sum + Math.hypot(p[3] - p[0], p[4] - p[1]) * (side < 0 ? neg : 1 - neg)
      );
    }, 0);
  const modified = result.results.find((r) => r.mode === "modified")!;
  expect(modified.layers.length).toBeGreaterThan(5);
  for (const layer of modified.layers) {
    const one = result.results[0].layers.find((l) => l.z === layer.z)!;
    const four = result.results[1].layers.find((l) => l.z === layer.z)!;
    expect(total(layer.paths, -1)).toBeCloseTo(total(four.paths, -1), 1);
    expect(total(layer.paths, 1)).toBeCloseTo(total(one.paths, 1), 1);
    // Missing hole walls or duplicate hole traversal changes these inner totals.
    const inner = (paths: number[][]) =>
      paths.filter(
        (p) =>
          Math.hypot(
            (p[0] + p[3]) / 2 - result.center,
            (p[1] + p[4]) / 2 - result.center,
          ) < 22,
      );
    expect(total(inner(layer.paths), -1)).toBeCloseTo(
      total(inner(four.paths), -1),
      1,
    );
    expect(total(inner(layer.paths), 1)).toBeCloseTo(
      total(inner(one.paths), 1),
      1,
    );
  }
});

test("hollow modifiers follow linked materials and manual layers without changing unrelated tools or raft/support paths", async ({
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
      adhesion: "raft",
      supports: "auto",
      minLayerTime: 0,
      infill: 15,
      manualLayers: true,
      layerHeight: 0.24,
      layerHeightCurve: [
        { z: 0, height: 0.12 },
        { z: 4, height: 0.24 },
      ],
      firstLayerHeight: 0.2,
    };
    const ring = {
      ...primitive("torus", 1),
      kind: "walls",
      walls: 5,
      enabled: true,
      infill: 0,
      infillPattern: "grid",
      position: [10, 0, -20],
      scale: [0.5, 0.5, 8],
    };
    const models = [
      {
        ...primitive("cube", 1),
        position: [-10, 0, 0],
        scale: [1, 1, 0.2],
        assemblyId: "halves",
      },
      {
        ...primitive("cube", 1),
        position: [10, 0, 1],
        scale: [1, 1, 0.2],
        assemblyId: "halves",
        tool: 1,
      },
      {
        ...primitive("cube", 1),
        position: [-10, -8, 0],
        scale: [0.1, 0.1, 0.2],
        tool: 2,
      },
    ];
    const printer = PRINTERS.find((p) => p.id === "generic-multi")!;
    const results = [];
    for (const modified of [false, true]) {
      const r = await slicePlate(
        models.map((m, i) => ({
          ...m,
          modifiers: modified && i === 0 ? [ring] : undefined,
        })),
        printer,
        settings,
        () => {},
        new AbortController().signal,
        [0, 1, 2].map((t) => defaultFilament(settings, t)),
        { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
      );
      results.push(
        r.layers.map((l) => ({
          z: l.z,
          paths: [...l.features].flatMap((f, i) =>
            f === 4
              ? []
              : [
                  {
                    f,
                    tool: l.tools[i],
                    p: [...l.segments.slice(i * 6, i * 6 + 6)],
                  },
                ],
          ),
        })),
      );
    }
    return { results, center: printer.bed[0] / 2 };
  });
  const canonical = (paths: any[]) =>
    paths
      .map(
        ({ f, tool, p }) =>
          `${f}:${tool}:` +
          [p.slice(0, 3), p.slice(3)]
            .map((v: number[]) => v.map((n) => n.toFixed(3)).join(","))
            .sort()
            .join(":"),
      )
      .sort();
  const [base, modified] = result.results;
  expect(
    base.flatMap((l) => l.paths).filter((p) => p.f === 3).length,
  ).toBeGreaterThan(0);
  expect(modified.map((l) => l.z)).toEqual(base.map((l) => l.z));
  for (let i = 0; i < base.length; i++) {
    const unchanged = (p: any) => p.tool === 2 || p.f === 3 || p.f === 5;
    expect(canonical(modified[i].paths.filter(unchanged))).toEqual(
      canonical(base[i].paths.filter(unchanged)),
    );
  }
  const middle = modified.find(
    (l) => l.z > 2.5 && l.paths.some((p) => p.f === 0 && p.tool === 0),
  )!;
  expect(middle).toBeTruthy();
  for (const tool of [0, 1]) {
    const x = result.center + (tool === 0 ? -5 : 5);
    const crossing = middle.paths.filter(
      ({ f, tool: t, p }) =>
        f === 0 &&
        t === tool &&
        Math.min(p[0], p[3]) < x &&
        Math.max(p[0], p[3]) > x &&
        p[1] < result.center &&
        p[4] < result.center,
    );
    expect(crossing).toHaveLength(5);
    // The torus hole leaves the walls at the linked-part boundary unchanged.
    const hole = middle.paths.filter(
      ({ f, tool: t, p }) =>
        f === 0 &&
        t === tool &&
        Math.min(p[1], p[4]) < result.center &&
        Math.max(p[1], p[4]) > result.center &&
        Math.abs(p[0] - result.center) < 3,
    );
    expect(hole).toHaveLength(3);
  }
});

test("regional wall counts match global perimeters without closing mask boundaries or caching stale infill", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const model = primitive("cube", 1);
    const mask = {
      ...primitive("cube", 1),
      enabled: true,
      kind: "walls",
      walls: 5,
      infill: 20,
      infillPattern: "grid",
      position: [-5, 0, 5],
      scale: [0.5, 2, 0.5],
    };
    const results = [];
    for (const mode of ["base", "five", "zero", "modified", "overlap"]) {
      const r = await slicePlate(
        [
          {
            ...model,
            modifiers:
              mode === "modified" || mode === "overlap"
                ? [
                    mask,
                    ...(mode === "overlap"
                      ? [{ ...mask, id: "zero", walls: 0 }]
                      : []),
                  ]
                : undefined,
          },
        ],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          walls: mode === "five" ? 5 : mode === "zero" ? 0 : 3,
          layerHeight: 0.2,
          firstLayerHeight: 0.2,
          infill: 25,
          infillPattern: "grid",
          adhesion: "none",
          minLayerTime: 0,
        },
        () => {},
        new AbortController().signal,
      );
      results.push({
        mode,
        layers: r.layers
          .filter((l) =>
            [0.2, 4.8, 5.2, 10, 15.2, 20].some((z) => Math.abs(l.z - z) < 0.01),
          )
          .map((l) => ({
            z: l.z,
            paths: [...l.features].flatMap((f, i) =>
              f > 2
                ? []
                : [
                    {
                      f,
                      a: [...l.segments.slice(i * 6, i * 6 + 3)],
                      b: [...l.segments.slice(i * 6 + 3, i * 6 + 6)],
                    },
                  ],
            ),
          })),
      });
    }
    return { results, center: PRINTERS[0].bed[0] / 2 };
  });
  const layer = (mode: string, z: number) =>
    result.results
      .find((r) => r.mode === mode)!
      .layers.find((l) => Math.abs(l.z - z) < 0.01)!;
  const length = (mode: string, z: number, side: string, feature: number) =>
    layer(mode, z)
      .paths.filter((p) => p.f === feature)
      .reduce((sum, p) => {
        const [a, b] = [p.a, p.b];
        const c = result.center;
        const dx = b[0] - a[0],
          distance = Math.hypot(dx, b[1] - a[1]);
        const left =
          dx === 0
            ? a[0] < c
              ? 1
              : 0
            : Math.max(
                0,
                Math.min(1, (c - Math.min(a[0], b[0])) / Math.abs(dx)),
              );
        return sum + distance * (side === "left" ? left : 1 - left);
      }, 0);
  for (const z of [0.2, 4.8, 5.2, 10, 15.2, 20]) {
    const active = z > 5 && z < 15;
    for (const mode of ["modified", "overlap"]) {
      expect(length(mode, z, "left", 0)).toBeCloseTo(
        length(
          active ? (mode === "modified" ? "five" : "zero") : "base",
          z,
          "left",
          0,
        ),
        2,
      );
      expect(length(mode, z, "right", 0)).toBeCloseTo(
        length("base", z, "right", 0),
        2,
      );
      // There is no physical wall along the boundary x=center.
      expect(
        layer(mode, z).paths.filter(
          (p) =>
            p.f === 0 &&
            Math.abs(p.a[0] - result.center) < 0.001 &&
            Math.abs(p.b[0] - result.center) < 0.001,
        ),
      ).toHaveLength(0);
    }
  }
  // Extra walls consume infill area immediately, then release it above the mask.
  expect(length("modified", 5.2, "left", 1)).toBeLessThan(
    length("base", 5.2, "left", 1),
  );
  expect(length("overlap", 10, "left", 1)).toBeGreaterThan(
    length("base", 10, "left", 1),
  );
  // Changed start positions can omit optional sub-line-width connectors.
  // The actual grid strokes above the volume must be identical to baseline.
  const strokes = (mode: string) =>
    layer(mode, 15.2)
      .paths.filter(
        (p) => p.f === 1 && Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) > 0.42,
      )
      .map((p) =>
        [p.a, p.b]
          .map((v) => v.map((n) => n.toFixed(3)).join(","))
          .sort()
          .join(":"),
      )
      .sort();
  expect(strokes("modified")).toEqual(strokes("base"));
  // Changing wall count alone must not manufacture projected surface skins.
  for (const z of [4.8, 5.2, 10, 15.2])
    expect(length("modified", z, "left", 2)).toBe(0);
});
