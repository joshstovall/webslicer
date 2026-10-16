import { test, expect } from "@playwright/test";
import { audit } from "../helpers/process-audit";
test("wall, infill and process modifiers combine independently in actual G-code", async ({
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
            { ...mask, id: "empty", kind: "infill" },
            {
              ...mask,
              id: "slow",
              kind: "process",
              speedPercent: 50,
              flowPercent: 150,
            },
          ],
        },
      ],
      PRINTERS[0],
      {
        ...DEFAULT_SETTINGS,
        adhesion: "none",
        infill: 20,
        infillPattern: "grid",
        minLayerTime: 0,
        maxFlow: 100,
        firstLayerHeight: 0.2,
        speed: 40,
        outerSpeed: 40,
        firstLayerSpeed: 40,
      },
      () => {},
      new AbortController().signal,
    );
    const layer = r.layers.find((l) => Math.abs(l.z - 2) < 0.01)!;
    return {
      code: r.gcode,
      paths: [...layer.features].flatMap((f, i) =>
        f <= 2 ? [{ f, p: [...layer.segments.slice(i * 6, i * 6 + 6)] }] : [],
      ),
    };
  });
  const infill = result.paths.filter((p) => p.f === 1);
  expect(infill.length).toBeGreaterThan(0);
  for (const { p } of infill)
    expect(Math.min(p[0], p[3])).toBeGreaterThanOrEqual(109.999);
  for (const [x, count] of [
    [105, 5],
    [115, 3],
  ])
    expect(
      result.paths.filter(
        ({ f, p }) =>
          f === 0 &&
          Math.min(p[0], p[3]) < x &&
          Math.max(p[0], p[3]) > x &&
          p[1] < 110 &&
          p[4] < 110,
      ),
    ).toHaveLength(count);
  const stats = audit(result.code),
    [left, right] = stats.sides;
  expect(stats.crossing).toBe(0);
  expect(left.e / left.length / (right.e / right.length)).toBeGreaterThan(1.47);
  expect(left.e / left.length / (right.e / right.length)).toBeLessThan(1.53);
  expect(left.length / left.time / (right.length / right.time)).toBeGreaterThan(
    0.47,
  );
  expect(left.length / left.time / (right.length / right.time)).toBeLessThan(
    0.53,
  );
});
test("regional perimeter fragments obey wall depth order even when outer fragments are shortest", async ({
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
      walls: 1,
      enabled: true,
      infill: 0,
      infillPattern: "grid",
      position: [0, -10, -1],
      scale: [0.2, 0.1, 2],
    };
    const results = [];
    for (const wallOrder of ["in-out", "out-in"]) {
      const r = await slicePlate(
        [{ ...primitive("cube", 1), scale: [1, 1, 0.2], modifiers: [mask] }],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          walls: 3,
          wallOrder,
          adhesion: "none",
          minLayerTime: 0,
          firstLayerHeight: 0.2,
        },
        () => {},
        new AbortController().signal,
      );
      const layer = r.layers.find((l) => Math.abs(l.z - 2) < 0.01)!;
      const c = PRINTERS[0].bed[0] / 2;
      const depths = [...layer.features].flatMap((f, i) => {
        if (f !== 0) return [];
        const p = layer.segments.slice(i * 6, i * 6 + 6);
        const edgeDistance =
          10 -
          Math.max(
            Math.abs((p[0] + p[3]) / 2 - c),
            Math.abs((p[1] + p[4]) / 2 - c),
          );
        return [Math.round(edgeDistance / DEFAULT_SETTINGS.lineWidth - 0.5)];
      });
      results.push({ wallOrder, depths });
    }
    return results;
  });
  for (const { wallOrder, depths } of results) {
    expect([...new Set(depths)].sort()).toEqual([0, 1, 2]);
    for (let i = 1; i < depths.length; i++)
      if (wallOrder === "in-out")
        expect(depths[i]).toBeLessThanOrEqual(depths[i - 1]);
      else expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
  }
});
