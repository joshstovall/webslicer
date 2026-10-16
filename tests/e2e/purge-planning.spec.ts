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
        else if (feature !== "purge tower structure") {
          volumes.push(volume);
          pending = false;
        }
      }
    }
    expect(changes).toBeGreaterThan(2);
    expect(volumes).toHaveLength(changes);
    expect(
      volumes.every((v) => v >= 20 && v <= 20.05),
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
  expect(
    changes.every(
      (c) => c.deposited >= c.required && c.deposited <= c.required + 0.05,
    ),
  ).toBe(true);
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

test("extreme directional budgets retain exact physical volume across thin layers and flow ratios", async ({
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
    const settings = {
      ...DEFAULT_SETTINGS,
      adhesion: "none",
      firstLayerHeight: 0.08,
      layerHeight: 0.08,
      flow: 0.5,
    };
    const printer = {
      ...PRINTERS.find((p) => p.id === "generic-multi")!,
      bed: [270, 270, 270],
    };
    const models = [0, 1].map((tool) => ({
      ...primitive("cube", 1),
      tool,
      scale: [0.2, 0.2, 0.012],
      position: [125, tool ? 8 : -8, 0],
    }));
    const multi = {
      ...DEFAULT_MULTI_MATERIAL,
      purgeVolume: 1,
      purgeVolumes: { "0:1": 2000 },
    };
    const filaments = [0, 1].map((i) => ({
      ...defaultFilament(settings, i),
      flow: i ? 0.5 : 1.5,
    }));
    // The extreme budget needs a 278 mm block at this thin/low-flow setting.
    // Reject the undersized bed, then verify a corrected job can run immediately.
    let rejected = false;
    try {
      await slicePlate(
        models,
        printer,
        settings,
        () => {},
        new AbortController().signal,
        filaments,
        multi,
      );
    } catch (error) {
      if (!String(error).includes("No room for 1 purge block")) throw error;
      rejected = true;
    }
    if (!rejected)
      throw new Error(
        "An undersized bed unexpectedly accepted the large purge block.",
      );
    const result = await slicePlate(
      models.map((m) => ({ ...m, position: [143, m.position[1], 0] })),
      { ...printer, bed: [300, 300, 300] },
      settings,
      () => {},
      new AbortController().signal,
      filaments,
      multi,
    );
    return auditPurgeVolumes(result.gcode, 1.75, multi, true);
  });
  expect(new Set(changes.map((c) => c.required))).toEqual(new Set([1, 2000]));
  expect(changes.every((c) => Math.abs(c.required - c.deposited) <= 0.05)).toBe(
    true,
  );
});

test("tower structure ends at the final change while later model layers remain intact", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { auditPurgeVolumes } = await import("/src/lib/purge-audit.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const settings = { ...DEFAULT_SETTINGS, adhesion: "none" };
    const printer = PRINTERS.find((p) => p.id === "generic-multi")!;
    const multi = { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 };
    const models = [0, 1].map((tool) => ({
      ...primitive("cube", 1),
      tool,
      position: [tool ? 15 : -15, 0, 0],
      scale: [0.4, 0.4, tool ? 0.06 : 0.3],
    }));
    const sliced = await slicePlate(
      models,
      printer,
      settings,
      () => {},
      new AbortController().signal,
      [0, 1].map((i) => defaultFilament(settings, i)),
      multi,
    );
    let feature = "",
      z = 0;
    const primeHeights: number[] = [],
      structureHeights: number[] = [];
    for (const line of sliced.gcode.split("\n")) {
      if (line.startsWith(";TYPE:")) feature = line.slice(6);
      if (line.startsWith(";Z:")) z = Number(line.slice(3));
      if (
        /^G[01]\s/.test(line) &&
        /\b[XY]-?[\d.]+/.test(line) &&
        Number(line.match(/\bE(-?[\d.]+)/)?.[1] ?? 0) > 0
      ) {
        if (feature === "purge tower") primeHeights.push(z);
        if (feature === "purge tower structure") structureHeights.push(z);
      }
    }
    return {
      changes: auditPurgeVolumes(sliced.gcode, 1.75, multi, true).length,
      primeHeights,
      structureHeights,
      layers: sliced.layers.map((l) => ({
        z: l.z,
        features: [...l.features],
        segments: [...l.segments],
      })),
    };
  });
  expect(result.changes).toBeGreaterThan(2);
  const lastPrime = Math.max(...result.primeHeights);
  expect(lastPrime).toBeLessThan(2);
  expect(Math.max(...result.structureHeights)).toBe(lastPrime);
  const later = result.layers.filter((l) => l.z > lastPrime + 0.001);
  expect(later.length).toBeGreaterThan(10);
  expect(later.every((l) => !l.features.includes(5))).toBe(true);
  expect(Math.max(...later.map((l) => l.z))).toBeGreaterThan(5.5);
  // No leftover trips to the removed tower: all later endpoints stay on the
  // tall model, whose machine XY footprint is [109,117] × [124,132].
  // The first later layer can start with travel from the last retained tower.
  for (const l of later.slice(1))
    for (let i = 0; i < l.segments.length; i += 3) {
      expect(l.segments[i]).toBeGreaterThan(103);
      expect(l.segments[i]).toBeLessThan(123);
      expect(l.segments[i + 1]).toBeGreaterThan(118);
      expect(l.segments[i + 1]).toBeLessThan(138);
    }
});

test("manual towers honor U1 origin offsets and Bambu sparse AMS slots", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const output = [];
    for (const id of ["snapmaker-u1", "bambu-x1c"]) {
      const printer = await loadVendorPrinter(
        VENDOR_PRINTERS.find((p) => p.id === id)!,
      );
      const tools = id === "snapmaker-u1" ? [0, 1, 2, 3] : [7, 15];
      const settings = { ...DEFAULT_SETTINGS, adhesion: "none" };
      const models = tools.map((tool, i) => ({
        ...primitive("cube", 2),
        tool,
        scale: [0.2, 0.2, 0.04],
        position: [-15 + i * 10, 0, 0],
      }));
      const result = await slicePlate(
        models,
        printer,
        settings,
        () => {},
        new AbortController().signal,
        Array.from({ length: printer.toolCount! }, (_, i) =>
          defaultFilament(settings, i),
        ),
        {
          ...DEFAULT_MULTI_MATERIAL,
          purgeVolume: 20,
          towerPositions: {
            "1": { x: 140, y: 130, axis: "x" }, // Deliberately irrelevant other plate.
            "2": { x: 40, y: 50, axis: "y" },
          },
        },
      );
      const xs: number[] = [],
        ys: number[] = [];
      for (const l of result.layers)
        for (let i = 0; i < l.features.length; i++)
          if (l.features[i] === 5)
            for (const end of [0, 3]) {
              xs.push(l.segments[i * 6 + end]);
              ys.push(l.segments[i * 6 + end + 1]);
            }
      output.push({
        id,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        count: tools.length - 1,
      });
    }
    return output;
  });
  for (const result of results) {
    const size = result.maxX - result.minX;
    expect(size).toBeGreaterThan(10);
    expect((result.minX + result.maxX) / 2).toBeCloseTo(40, 2);
    expect(result.minY + size / 2).toBeCloseTo(50, 2);
    expect(result.maxY).toBeCloseTo(
      50 + (result.count - 1) * (size + 1.42) + size / 2,
      2,
    );
  }
});
