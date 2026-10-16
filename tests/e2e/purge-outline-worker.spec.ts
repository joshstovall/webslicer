import { test, expect } from "@playwright/test";
test("cancelling native footprint projection releases the engine and allows retry", async ({
  page,
}) => {
  await page.goto("./");
  const out = await page.evaluate(async () => {
    const { purgeFrameProject } = await import(
      "/tests/fixtures/purge-outlines.ts"
    );
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const p = purgeFrameProject(),
      models = p.models.map((m) => ({
        ...m,
        positions: new Float32Array(m.positions),
      }));
    const controller = new AbortController();
    let cancelled = "",
      saw = false;
    try {
      await slicePlate(
        models,
        p.printer,
        p.settings,
        (_n, stage) => {
          if (stage === "Placing purge tower around outlines") {
            saw = true;
            controller.abort();
          }
        },
        controller.signal,
        p.filaments,
        p.multiMaterial,
      );
    } catch (e) {
      cancelled = (e as Error).name;
    }
    const frames = document.querySelectorAll(
      'iframe[title="Local slicing engine"]',
    ).length;
    const retry = await slicePlate(
      models,
      p.printer,
      p.settings,
      () => {},
      new AbortController().signal,
      p.filaments,
      p.multiMaterial,
    );
    return { saw, cancelled, frames, layers: retry.layers.length };
  });
  expect(out.saw).toBe(true);
  expect(out.cancelled).toBe("AbortError");
  expect(out.frames).toBe(0);
  expect(out.layers).toBeGreaterThan(3);
  await expect(
    page.locator('iframe[title="Local slicing engine"]'),
  ).toHaveCount(0);
});
test("tree branches in a gap block a tower even when model projections leave the gap open", async ({
  page,
}) => {
  await page.goto("./");
  const out = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const models = [-10, 10].map((x, i) => ({
      ...primitive("cube", 1),
      tool: i,
      scale: [0.2, 0.2, 0.05],
      position: [x, 0, 18],
    }));
    const p = {
      ...PRINTERS.find((p) => p.id === "generic-multi")!,
      bed: [80, 80, 64],
    };
    const s = {
      ...DEFAULT_SETTINGS,
      adhesion: "none",
      minLayerTime: 0,
      firstLayerHeight: 0.2,
      treeBranchAngle: 45,
      treeBranchSpacing: 4,
      treeBranchDiameter: 10,
      treeTipDiameter: 1,
    };
    const filaments = [0, 1].map((i) => defaultFilament(s, i));
    const multi = {
      ...DEFAULT_MULTI_MATERIAL,
      purgeVolume: 3,
      towerPositions: { "1": { x: 40, y: 40, axis: "x" } },
    };
    const results = [];
    for (const supports of ["disabled", "auto", "tree"]) {
      try {
        const r = await slicePlate(
          models,
          p,
          { ...s, supports },
          () => {},
          new AbortController().signal,
          filaments,
          multi,
        );
        results.push({
          supports,
          error: "",
          supportPaths: r.layers.reduce(
            (n, l) => n + [...l.features].filter((f) => f === 3).length,
            0,
          ),
        });
      } catch (e) {
        results.push({
          supports,
          error: (e as Error).message,
          supportPaths: 0,
        });
      }
    }
    const automatic = await slicePlate(
      models,
      p,
      { ...s, supports: "tree" },
      () => {},
      new AbortController().signal,
      filaments,
      { ...multi, towerPositions: {} },
    );
    const centerSupports = automatic.layers.reduce(
      (n, l) =>
        n +
        [...l.features].filter(
          (f, i) =>
            f === 3 &&
            Math.abs(l.segments[i * 6] - 40) < 5 &&
            Math.abs(l.segments[i * 6 + 1] - 40) < 5,
        ).length,
      0,
    );
    return { results, centerSupports };
  });
  expect(out.centerSupports).toBeGreaterThan(0);
  expect(out.results[0].error).toBe("");
  expect(out.results[1].error).toBe("");
  expect(out.results[1].supportPaths).toBeGreaterThan(20);
  expect(out.results[2].error).toContain("Manual tower block 1 overlaps");
});
