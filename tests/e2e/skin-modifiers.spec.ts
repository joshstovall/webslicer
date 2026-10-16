import { test, expect } from "@playwright/test";
import { audit } from "../helpers/process-audit";

test("skin, wall, infill and flow modifiers compose on the same object", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const mask = {
      ...primitive("cube", 1),
      enabled: true,
      infill: 0,
      infillPattern: "grid",
      position: [-5, 0, -1],
      scale: [0.5, 2, 2],
    };
    const r = await slicePlate(
      [
        {
          ...primitive("cube", 1),
          scale: [1, 1, 0.2],
          modifiers: [
            { ...mask, kind: "walls", walls: 5 },
            {
              ...mask,
              id: "skins",
              kind: "skins",
              topLayers: 0,
              bottomLayers: 6,
            },
            { ...mask, id: "infill", kind: "infill" },
            { ...mask, id: "flow", kind: "process", flowPercent: 150 },
          ],
        },
      ],
      PRINTERS[0],
      {
        ...DEFAULT_SETTINGS,
        infill: 20,
        infillPattern: "grid",
        adhesion: "none",
        minLayerTime: 0,
        maxFlow: 100,
        firstLayerHeight: 0.2,
      },
      () => {},
      new AbortController().signal,
    );
    return {
      code: r.gcode,
      layers: r.layers
        .filter((l) => [1, 2, 4].some((z) => Math.abs(l.z - z) < 0.01))
        .map((l) => ({
          z: l.z,
          paths: [...l.features].flatMap((f, i) =>
            f <= 2 ? [{ f, p: [...l.segments.slice(i * 6, i * 6 + 6)] }] : [],
          ),
        })),
    };
  });
  const layer = (z: number) =>
    result.layers.find((l) => Math.abs(l.z - z) < 0.01)!;
  for (const [x, count] of [
    [105, 5],
    [115, 3],
  ])
    expect(
      layer(2).paths.filter(
        ({ f, p }) =>
          f === 0 &&
          Math.min(p[0], p[3]) < x &&
          Math.max(p[0], p[3]) > x &&
          p[1] < 110 &&
          p[4] < 110,
      ),
    ).toHaveLength(count);
  expect(
    layer(2).paths.filter(
      ({ f, p }) => f === 1 && Math.min(p[0], p[3]) < 109.99,
    ),
  ).toHaveLength(0);
  const floor = layer(1).paths.filter(
    ({ f, p }) => f === 2 && Math.min(p[0], p[3]) < 109.99,
  );
  expect(floor.length).toBeGreaterThan(10);
  for (const { p } of floor) {
    expect(Math.max(p[0], p[3])).toBeLessThanOrEqual(110.001);
    expect(Math.min(p[1], p[4])).toBeGreaterThanOrEqual(102.246);
    expect(Math.max(p[1], p[4])).toBeLessThanOrEqual(117.754);
  }
  expect(
    layer(4).paths.filter(
      ({ f, p }) => f === 2 && Math.min(p[0], p[3]) < 109.99,
    ),
  ).toHaveLength(0);
  const [left, right] = audit(result.code).sides;
  expect(left.e / left.length / (right.e / right.length)).toBeGreaterThan(1.47);
  expect(left.e / left.length / (right.e / right.length)).toBeLessThan(1.53);
});

test("short skin connectors do not cross a zero-skin slit", async ({
  page,
}) => {
  await page.goto("/");
  const paths = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const mask = {
      ...primitive("cube", 1),
      kind: "skins",
      enabled: true,
      topLayers: 0,
      bottomLayers: 0,
      infill: 0,
      infillPattern: "grid",
      position: [0, 0, -1],
      scale: [0.01, 2, 2],
    };
    const r = await slicePlate(
      [{ ...primitive("cube", 1), scale: [1, 1, 0.2], modifiers: [mask] }],
      PRINTERS[0],
      {
        ...DEFAULT_SETTINGS,
        infill: 0,
        adhesion: "none",
        minLayerTime: 0,
        firstLayerHeight: 0.2,
      },
      () => {},
      new AbortController().signal,
    );
    return r.layers
      .filter((l) => l.z <= 0.8 || l.z >= 3.2)
      .flatMap((l) =>
        [...l.features].flatMap((f, i) =>
          f === 2 ? [[...l.segments.slice(i * 6, i * 6 + 6)]] : [],
        ),
      );
  });
  expect(paths.length).toBeGreaterThan(100);
  for (const p of paths)
    expect(
      Math.min(p[0], p[3]) < 110.099 && Math.max(p[0], p[3]) > 109.901,
    ).toBe(false);
});

test("regional top and bottom counts resolve independently without changing walls or suppressing infill", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const mask = {
      ...primitive("cube", 1),
      enabled: true,
      kind: "skins",
      topLayers: 0,
      bottomLayers: 6,
      infill: 0,
      infillPattern: "grid",
      position: [-5, 0, -1],
      scale: [0.5, 2, 2],
    };
    const results = [];
    for (const mode of [
      "base",
      "modified",
      "overlap",
      "dense",
      "dense-empty",
    ]) {
      const modifiers =
        mode === "base"
          ? []
          : mode.startsWith("dense")
            ? [
                {
                  ...mask,
                  position: [0, 0, -1],
                  scale: [2, 2, 2],
                  bottomLayers: 0,
                },
                ...(mode === "dense-empty"
                  ? [{ ...mask, id: "empty", kind: "infill" }]
                  : []),
              ]
            : [
                mask,
                ...(mode === "overlap"
                  ? [
                      {
                        ...mask,
                        id: "top-only",
                        position: [-7.5, 0, -1],
                        scale: [0.25, 2, 2],
                        topLayers: 2,
                        bottomLayers: undefined,
                      },
                    ]
                  : []),
              ];
      const r = await slicePlate(
        [{ ...primitive("cube", 1), scale: [1, 1, 0.2], modifiers }],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          topLayers: 3,
          bottomLayers: 2,
          infill: mode.startsWith("dense") ? 100 : 20,
          infillPattern: "grid",
          adhesion: "none",
          minLayerTime: 0,
          firstLayerHeight: 0.2,
        },
        () => {},
        new AbortController().signal,
      );
      results.push({
        mode,
        layers: r.layers.map((l) => ({
          z: l.z,
          paths: [...l.features].flatMap((f, i) =>
            f <= 2 ? [{ f, p: [...l.segments.slice(i * 6, i * 6 + 6)] }] : [],
          ),
        })),
      });
    }
    return results;
  });
  const layer = (mode: string, z: number) =>
    results
      .find((r) => r.mode === mode)!
      .layers.find((l) => Math.abs(l.z - z) < 0.01)!;
  const inZone = (p: number[], lo: number, hi: number) =>
    Math.max(p[0], p[3]) > lo + 0.01 && Math.min(p[0], p[3]) < hi - 0.01;
  const exists = (mode: string, z: number, f: number, lo: number, hi: number) =>
    layer(mode, z).paths.some((p) => p.f === f && inZone(p.p, lo, hi));
  const wallLength = (mode: string, z: number) =>
    layer(mode, z)
      .paths.filter((p) => p.f === 0)
      .reduce((sum, { p }) => sum + Math.hypot(p[3] - p[0], p[4] - p[1]), 0);
  for (const z of [0.2, 0.4, 0.6, 1.2, 1.4, 3.4, 3.6, 3.8, 4]) {
    expect(wallLength("modified", z)).toBeCloseTo(wallLength("base", z), 2);
    expect(exists("modified", z, 2, 100, 110)).toBe(z <= 1.2);
    expect(exists("modified", z, 2, 110, 120), `Right skins at ${z}`).toBe(
      z <= 0.4 || z >= 3.6,
    );
  }
  expect(exists("modified", 4, 1, 100, 110)).toBe(true);
  expect(exists("overlap", 1.2, 2, 100, 105)).toBe(true);
  expect(exists("overlap", 3.6, 2, 100, 105)).toBe(false);
  expect(exists("overlap", 3.8, 2, 100, 105)).toBe(true);
  expect(exists("overlap", 4, 2, 105, 110)).toBe(false);
  expect(exists("dense", 2, 2, 100, 110)).toBe(true);
  expect(exists("dense-empty", 2, 1, 110, 120)).toBe(true);
  expect(exists("dense-empty", 2, 1, 100, 110)).toBe(false);
  expect(exists("dense-empty", 2, 2, 100, 120)).toBe(false);
});
