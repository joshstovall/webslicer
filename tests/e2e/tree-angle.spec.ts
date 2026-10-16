import { expect, test } from "@playwright/test";
type Point = { x: number; y: number };
function loops(paths: number[][]) {
  const out: Point[][] = [];
  let pts: Point[] = [],
    seen = new Map<string, number>();
  const key = (p: Point) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  for (const p of paths) {
    let a = { x: p[0], y: p[1] },
      b = { x: p[3], y: p[4] };
    if (!pts.length || key(pts.at(-1)!) !== key(a)) {
      pts = [a];
      seen = new Map([[key(a), 0]]);
    }
    const k = key(b);
    if (seen.has(k)) {
      const loop = pts.slice(seen.get(k));
      if (loop.length >= 8) out.push(loop);
      pts = [b];
      seen = new Map([[k, 0]]);
    } else {
      seen.set(k, pts.length);
      pts.push(b);
    }
  }
  return out;
}
function distanceToRegion(p: Point, ring: Point[]) {
  let inside = false,
    d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    d = Math.min(d, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return inside ? 0 : d;
}
for (const [angle, manual] of [
  [15, false],
  [40, false],
  [60, false],
  [40, true],
] as const)
  test(`exported tree footprints respect a ${angle} degree branch slope on ${manual ? "manual" : "fixed"} layers`, async ({
    page,
  }) => {
    await page.goto("/");
    const layers = await page.evaluate(
      async ({ angle, manual }) => {
        const { primitive, mergedVertices } = await import(
          "/src/lib/geometry.ts"
        );
        const { slicePlate } = await import("/src/lib/slicer.ts");
        const { DEFAULT_SETTINGS, PRINTERS } = await import(
          "/src/lib/profiles.ts"
        );
        const cube = primitive("cube", 1);
        const model = {
          ...cube,
          positions: mergedVertices(
            [-6, 6].map((x) => ({
              ...cube,
              position: [x, 0, 14],
              scale: [0.2, 0.2, 0.1],
            })),
          ),
        };
        const r = await slicePlate(
          [model],
          PRINTERS[0],
          {
            ...DEFAULT_SETTINGS,
            supports: "tree",
            treeBranchAngle: angle,
            manualLayers: manual,
            minLayerHeight: 0.1,
            layerHeightCurve: [
              { z: 0, height: 0.1 },
              { z: 7, height: 0.2 },
              { z: 16, height: 0.1 },
            ],
            adhesion: "none",
            minLayerTime: 0,
            firstLayerHeight: 0.2,
          },
          () => {},
          new AbortController().signal,
        );
        return r.layers
          .map((l) => ({
            z: l.z,
            paths: [...l.features].flatMap((f, i) =>
              f === 3 ? [[...l.segments.slice(i * 6, i * 6 + 6)]] : [],
            ),
          }))
          .filter((l) => l.paths.length);
      },
      { angle, manual },
    );
    let audited = 0,
      maxExcess = 0;
    for (let i = 1; i < layers.length; i++) {
      const lower = loops(layers[i - 1].paths),
        upper = loops(layers[i].paths);
      expect(lower.length).toBeGreaterThan(0);
      expect(upper.length).toBeGreaterThan(0);
      const allowance =
        (layers[i].z - layers[i - 1].z) * Math.tan((angle * Math.PI) / 180);
      for (const ring of upper)
        for (const p of ring) {
          maxExcess = Math.max(
            maxExcess,
            Math.min(...lower.map((r) => distanceToRegion(p, r))) - allowance,
          );
          audited++;
        }
    }
    expect(audited).toBeGreaterThan(500);
    expect(maxExcess).toBeLessThan(0.04);
  });
