import { expect, test } from "@playwright/test";

import { audit } from "../helpers/process-audit";

test("an elevated raft without base contacts reports a useful error and releases its workers", async ({
  page,
}) => {
  await page.goto("/");
  const message = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    try {
      await slicePlate(
        [{ ...primitive("cube", 1), position: [0, 0, 5] }],
        PRINTERS[0],
        { ...DEFAULT_SETTINGS, adhesion: "raft", supports: "disabled" },
        () => {},
        new AbortController().signal,
      );
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(message).toContain(
    "Raft requires model or support contact on the first layer",
  );
  await expect(
    page.locator('iframe[title="Local slicing engine"]'),
  ).toHaveCount(0);
});

test("rotated hollow regions retain holes across linked materials without changing unrelated parts", async ({
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
      speed: 40,
      outerSpeed: 40,
      firstLayerSpeed: 40,
      minLayerTime: 0,
      maxFlow: 100,
      adhesion: "none",
      adaptive: true,
      infill: 35,
      infillPattern: "grid",
    };
    const ring = {
      ...primitive("torus", 1),
      kind: "process",
      enabled: true,
      infill: 50,
      infillPattern: "grid",
      speedPercent: 50,
      position: [10, 0, 4],
      scale: [0.3, 0.6, 1],
      rotation: [0, 0, 30],
    };
    const left = {
      ...primitive("cube", 1),
      assemblyId: "linked",
      position: [-10, 0, 0],
      modifiers: [ring],
    };
    const right = {
      ...primitive("cube", 1),
      assemblyId: "linked",
      position: [10, 0, 0],
      tool: 1,
    };
    // Intentionally coincident source tests ownership independently of the UI's collision gate.
    const other = {
      ...primitive("cube", 1),
      position: [6, 0, 0],
      scale: [0.1, 0.1, 1],
      tool: 2,
    };
    const r = await slicePlate(
      [left, right, other],
      PRINTERS.find((p) => p.id === "generic-multi")!,
      settings,
      () => {},
      new AbortController().signal,
      [0, 1, 2].map((i) => defaultFilament(settings, i)),
      { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
    );
    return r.layers
      .filter((l) => l.z > 9 && l.z < 11)
      .flatMap((l) =>
        [...l.features].flatMap((f, i) =>
          [0, 1, 2].includes(f)
            ? [
                {
                  a: Array.from(l.segments.slice(i * 6, i * 6 + 3)),
                  b: Array.from(l.segments.slice(i * 6 + 3, i * 6 + 6)),
                  tool: l.tools[i],
                  speed: l.speeds[i],
                },
              ]
            : [],
        ),
      );
  });
  const changed = new Set<number>();
  let modified = 0,
    hole = 0,
    other = 0,
    maxRadius = 0,
    minRadius = Infinity;
  for (const p of result) {
    if (p.tool === 2) {
      other++;
      expect(p.speed).toBeCloseTo(40, 2);
      continue;
    }
    if (p.speed < 30) {
      modified++;
      changed.add(p.tool);
      expect(p.speed).toBeCloseTo(20, 2);
      for (let j = 0; j <= 10; j++) {
        const x = p.a[0] + ((p.b[0] - p.a[0]) * j) / 10 - 128,
          y = p.a[1] + ((p.b[1] - p.a[1]) * j) / 10 - 128;
        const u =
            (x * Math.cos(-Math.PI / 6) - y * Math.sin(-Math.PI / 6)) / 0.3,
          v = (x * Math.sin(-Math.PI / 6) + y * Math.cos(-Math.PI / 6)) / 0.6;
        minRadius = Math.min(minRadius, Math.hypot(u, v));
        maxRadius = Math.max(maxRadius, Math.hypot(u, v));
      }
    } else if (
      Math.hypot((p.a[0] + p.b[0]) / 2 - 128, (p.a[1] + p.b[1]) / 2 - 128) < 3
    )
      hole++;
  }
  expect([...changed].sort()).toEqual([0, 1]);
  expect(modified).toBeGreaterThan(30);
  expect(hole).toBeGreaterThan(10);
  expect(other).toBeGreaterThan(10);
  expect(minRadius).toBeGreaterThan(15.8);
  expect(maxRadius).toBeLessThan(28.2);
});

test("regional modifiers honor raft offsets while supports and purge retain their original paths and speeds", async ({
  page,
}) => {
  await page.goto("/");
  const output = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const settings = {
      ...DEFAULT_SETTINGS,
      speed: 40,
      outerSpeed: 40,
      firstLayerSpeed: 40,
      minLayerTime: 0,
      maxFlow: 100,
      adhesion: "raft",
      supports: "auto",
      infill: 20,
    };
    const mask = {
      ...primitive("cube", 1),
      enabled: true,
      kind: "process",
      infill: 50,
      infillPattern: "grid",
      scale: [3, 3, 3],
      position: [0, 0, -5],
    };
    const result = [];
    for (const speedPercent of [100, 50]) {
      const model = {
        ...primitive("cube", 1),
        tool: 1,
        position: [0, 0, 5],
        scale: [0.5, 0.5, 0.2],
        modifiers: [{ ...mask, speedPercent }],
      };
      const r = await slicePlate(
        [model],
        PRINTERS.find((p) => p.id === "generic-multi")!,
        settings,
        () => {},
        new AbortController().signal,
        [0, 1].map((i) => defaultFilament(settings, i)),
        { ...DEFAULT_MULTI_MATERIAL, supportTool: 0, purgeVolume: 1 },
      );
      result.push(
        r.layers.flatMap((l) =>
          [...l.features].flatMap((f, i) =>
            f !== 4
              ? [
                  {
                    f,
                    speed: l.speeds[i],
                    tool: l.tools[i],
                    p: Array.from(l.segments.slice(i * 6, i * 6 + 6)),
                  },
                ]
              : [],
          ),
        ),
      );
    }
    return result;
  });
  const fixed = (paths: (typeof output)[0]) =>
    paths.filter((p) => p.tool === 0 || p.f === 3 || p.f === 5);
  expect(fixed(output[0]).length).toBeGreaterThan(100);
  expect(fixed(output[1])).toEqual(fixed(output[0]));
  const model = (paths: (typeof output)[0]) =>
    paths.filter((p) => p.tool === 1 && ![3, 5].includes(p.f));
  expect(model(output[1]).length).toBeGreaterThan(100);
  expect(model(output[1]).map((p) => p.p)).toEqual(
    model(output[0]).map((p) => p.p),
  );
  expect(
    model(output[1]).every(
      (p, i) => Math.abs(p.speed / model(output[0])[i].speed - 0.5) < 0.001,
    ),
  ).toBe(true);
});

for (const schedule of ["fixed", "adaptive", "manual"])
  test(`regional speed and flow split actual ${schedule} model paths and retain filament flow limits`, async ({
    page,
  }) => {
    await page.goto("/");
    const output = await page.evaluate(async (schedule) => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const { DEFAULT_SETTINGS, PRINTERS } = await import(
        "/src/lib/profiles.ts"
      );
      const { defaultFilament } = await import("/src/lib/multimaterial.ts");
      const model = { ...primitive("cube", 1), scale: [1, 1, 0.2] };
      const mask = {
        ...primitive("cube", 1),
        position: [-5, 0, -1],
        scale: [0.5, 2, 2],
        enabled: true,
        kind: "process",
        infill: 50,
        infillPattern: "grid",
      };
      const results = [];
      for (const mode of ["base", "modified", "capped"]) {
        const settings = {
          ...DEFAULT_SETTINGS,
          adhesion: "none",
          minLayerTime: 0,
          maxFlow: 100,
          adaptive: schedule === "adaptive",
          manualLayers: schedule === "manual",
          layerHeightCurve: [
            { z: 0, height: 0.12 },
            { z: 4, height: 0.2 },
          ],
        };
        const r = await slicePlate(
          [
            {
              ...model,
              modifiers: [
                {
                  ...mask,
                  speedPercent:
                    mode === "base" ? 100 : mode === "capped" ? 300 : 50,
                  flowPercent: mode === "base" ? 100 : 150,
                },
              ],
            },
          ],
          PRINTERS[0],
          settings,
          () => {},
          new AbortController().signal,
          [
            {
              ...defaultFilament(settings),
              maxFlow: mode === "capped" ? 1 : 100,
            },
          ],
        );
        results.push({ mode, gcode: r.gcode });
      }
      return results;
    }, schedule);
    const base = audit(output[0].gcode),
      modified = audit(output[1].gcode),
      capped = audit(output[2].gcode);
    expect(base.crossing).toBeGreaterThan(10);
    expect(modified.crossing).toBe(0);
    for (let i = 0; i < 2; i++) {
      expect(base.sides[i].length).toBeGreaterThan(100);
      expect(modified.sides[i].length / base.sides[i].length).toBeCloseTo(1, 3);
      expect(modified.sides[i].e / base.sides[i].e).toBeCloseTo(
        i === 0 ? 1.5 : 1,
        3,
      );
      expect(modified.sides[i].time / base.sides[i].time).toBeCloseTo(
        i === 0 ? 2 : 1,
        3,
      );
    }
    expect(capped.maxFlow).toBeLessThanOrEqual(1.001);
  });
