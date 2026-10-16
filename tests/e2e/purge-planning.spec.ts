import { test, expect } from "@playwright/test";

for (const crowded of [false, true])
  test(`purges before every changed-color model path${crowded ? " with models beside the bed edge" : ""}`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (crowded) => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const { PRINTERS, DEFAULT_SETTINGS } = await import(
        "/src/lib/profiles.ts"
      );
      const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
        "/src/lib/multimaterial.ts"
      );
      const p = {
        ...PRINTERS.find((p) => p.id === "generic-multi")!,
        bed: [64, 64, 64],
      };
      const s = { ...DEFAULT_SETTINGS, adhesion: "none" };
      const models = [0, 2].map((tool, i) => ({
        ...primitive("cube", 1),
        tool,
        scale: [0.4, 0.4, 0.06],
        position: [crowded ? 24 : 0, i ? 10 : -10, 0],
      }));
      const r = await slicePlate(
        models,
        p,
        s,
        () => {},
        new AbortController().signal,
        [0, 1, 2].map((i) => defaultFilament(s, i)),
        { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
      );
      return {
        gcode: r.gcode,
        layers: r.layers.map((l) => ({
          segments: [...l.segments],
          features: [...l.features],
        })),
      };
    }, crowded);
    let pending = false,
      feature = "",
      volume = 0,
      changes = 0;
    const volumes: number[] = [];
    for (const line of result.gcode.split("\n")) {
      if (line.startsWith(";STRATUM_TOOL_CHANGE:")) {
        pending = true;
        volume = 0;
        changes++;
      }
      if (line.startsWith(";TYPE:")) feature = line.slice(6);
      const amount = Number(line.match(/\bE(-?[\d.]+)/)?.[1] ?? 0);
      if (
        pending &&
        /^G[01]\s/.test(line) &&
        /\b[XY]-?[\d.]+/.test(line) &&
        amount > 0
      ) {
        if (feature === "purge tower")
          volume += amount * Math.PI * (1.75 / 2) ** 2;
        else {
          volumes.push(volume);
          pending = false;
        }
      }
    }
    expect(changes).toBeGreaterThan(2);
    expect(volumes).toHaveLength(changes);
    expect(
      volumes.every((v) => v >= 20),
      JSON.stringify(volumes),
    ).toBe(true);
    for (const l of result.layers)
      for (let i = 0; i < l.features.length; i++) {
        if (l.features[i] === 4) continue;
        for (const endpoint of [0, 3]) {
          expect(l.segments[i * 6 + endpoint]).toBeGreaterThanOrEqual(0);
          expect(l.segments[i * 6 + endpoint]).toBeLessThanOrEqual(64);
          expect(l.segments[i * 6 + endpoint + 1]).toBeGreaterThanOrEqual(0);
          expect(l.segments[i * 6 + endpoint + 1]).toBeLessThanOrEqual(64);
        }
      }
  });

test("thin layers and low-flow materials still receive the requested directional purge volume", async ({
  page,
}) => {
  await page.goto("/");
  const changes = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { auditPurgeVolumes } = await import("/src/lib/purge-audit.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const s = {
      ...DEFAULT_SETTINGS,
      adhesion: "skirt",
      adaptive: true,
      minLayerHeight: 0.08,
      firstLayerHeight: 0.08,
      layerHeight: 0.24,
      flow: 0.8,
    };
    const p = PRINTERS.find((p) => p.id === "generic-multi")!;
    const models = [0, 2].map((tool, i) => ({
      ...primitive("sphere", 1),
      tool,
      scale: [0.2, 0.2, 0.1],
      position: [i ? 10 : -10, 0, 0],
    }));
    const multi = {
      ...DEFAULT_MULTI_MATERIAL,
      purgeVolume: 20,
      purgeVolumes: { "0:2": 30, "2:0": 12, "1:2": 2000 },
    };
    const r = await slicePlate(
      models,
      p,
      s,
      () => {},
      new AbortController().signal,
      [0, 1, 2].map((i) => ({
        ...defaultFilament(s, i),
        flow: i === 2 ? 0.6 : 1.1,
      })),
      multi,
    );
    return auditPurgeVolumes(r.gcode, p.filament, multi);
  });
  expect(changes.length).toBeGreaterThan(3);
  expect(new Set(changes.map((c) => c.required))).toEqual(new Set([12, 30]));
  expect(changes.every((c) => c.deposited >= c.required)).toBe(true);
});

test("a full plate fails clearly and releases its workers instead of exporting an overlapping tower", async ({
  page,
}) => {
  await page.goto("/");
  const error = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const s = { ...DEFAULT_SETTINGS, adhesion: "none" };
    const p = {
      ...PRINTERS.find((p) => p.id === "generic-multi")!,
      bed: [64, 64, 64],
    };
    const models = [0, 1].map((tool, i) => ({
      ...primitive("cube", 1),
      tool,
      scale: [1.4, 3, 0.05],
      position: [i ? 15 : -15, 0, 0],
    }));
    try {
      await slicePlate(
        models,
        p,
        s,
        () => {},
        new AbortController().signal,
        [0, 1].map((i) => defaultFilament(s, i)),
        { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
      );
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  });
  expect(error).toContain("No room for 1 purge block");
  expect(error).toContain("Rearrange the plate");
  await expect(
    page.locator('iframe[title="Local slicing engine"]'),
  ).toHaveCount(0);
});
