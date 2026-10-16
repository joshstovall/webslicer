import { expect, test } from "@playwright/test";

test("a brush on a sloped underside supports only the projected painted surface", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive, mergedVertices } = await import("/src/lib/geometry.ts");
    const { paintSupportSurface } = await import("/src/lib/support-paint.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const base = {
      ...primitive("cube", 1),
      scale: [1.5, 0.5, 0.15],
      position: [0, 0, 8],
    };
    const positions = mergedVertices([base]);
    for (let i = 0; i < positions.length; i += 3)
      positions[i + 2] += positions[i] * 0.4;
    let m = { ...base, positions, scale: [1, 1, 1], position: [0, 0, 0] };
    m = {
      ...m,
      ...paintSupportSurface(m, {
        point: [-5, 0, 6],
        normal: [0.4, 0, -1],
        radius: 3,
        tool: 1,
        sourceTool: 0,
        mode: "brush",
      }),
    };
    const r = await slicePlate(
      [m],
      PRINTERS[0],
      {
        ...DEFAULT_SETTINGS,
        supports: "manual",
        adhesion: "none",
        minLayerTime: 0,
        adaptive: true,
      },
      () => {},
      new AbortController().signal,
    );
    return {
      center: PRINTERS[0].bed[0] / 2,
      paths: r.layers.flatMap((l) =>
        [...l.features].flatMap((f, i) =>
          f === 3 ? [Array.from(l.segments.slice(i * 6, i * 6 + 6))] : [],
        ),
      ),
    };
  });
  expect(result.paths.length).toBeGreaterThan(30);
  let radius = 0;
  for (const p of result.paths)
    for (let i = 0; i <= 10; i++) {
      const x = p[0] + (i / 10) * (p[3] - p[0]) - result.center + 5,
        y = p[1] + (i / 10) * (p[4] - p[1]) - result.center;
      radius = Math.max(radius, Math.hypot(x, y, x * 0.4));
    }
  expect(radius).toBeLessThan(3.4);
});
