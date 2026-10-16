import { expect, test } from "@playwright/test";
test("all modifier infill patterns stay inside their masks and zero masks preserve surface skins", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const out = [];
    const model = primitive("cube", 1);
    const modifier = {
      ...primitive("cube", 1),
      enabled: true,
      infill: 35,
      infillPattern: "grid",
      position: [-5, 0, 0],
      scale: [0.5, 2, 2],
    };
    for (const type of [
      "base",
      "empty",
      "gyroid",
      "grid",
      "hex",
      "triangle",
      "linear",
      "cubic",
    ]) {
      const modifiers =
        type === "base"
          ? undefined
          : [
              {
                ...modifier,
                infill: type === "empty" ? 0 : 35,
                infillPattern: type === "empty" ? "grid" : type,
              },
            ];
      const r = await slicePlate(
        [{ ...model, modifiers }],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          adhesion: "none",
          infill: 0,
          minLayerTime: 0,
          firstLayerHeight: 0.2,
        },
        () => {},
        new AbortController().signal,
      );
      out.push({
        type,
        bed: PRINTERS[0].bed,
        layers: r.layers
          .filter((l) => l.z === 0.2 || l.z === 20 || (l.z >= 4 && l.z <= 4.6))
          .map((l) => ({
            z: l.z,
            paths: [...l.features].flatMap((f, i) =>
              f === 1 || f === 2 || f === 6
                ? [Array.from(l.segments.slice(i * 6, i * 6 + 6))]
                : [],
            ),
          })),
      });
    }
    return out;
  });
  const base = result[0];
  const signature = (paths: number[][]) =>
    paths
      .map((p) =>
        [p.slice(0, 3), p.slice(3)]
          .map((p) => p.map((v) => v.toFixed(3)).join(","))
          .sort()
          .join(":"),
      )
      .sort()
      .join("|");
  const fingerprints = new Set();
  for (const r of result) {
    for (const z of [0.2, 20])
      expect(signature(r.layers.find((l) => l.z === z)!.paths)).toBe(
        signature(base.layers.find((l) => l.z === z)!.paths),
      );
    const infill = r.layers
      .filter((l) => l.z >= 4 && l.z <= 4.6)
      .flatMap((l) => l.paths);
    if (["base", "empty"].includes(r.type)) {
      expect(infill).toHaveLength(0);
      continue;
    }
    expect(infill.length, r.type).toBeGreaterThan(0);
    for (const p of infill) {
      expect(p[0], r.type).toBeLessThanOrEqual(r.bed[0] / 2 + 0.001);
      expect(p[3], r.type).toBeLessThanOrEqual(r.bed[0] / 2 + 0.001);
    }
    fingerprints.add(signature(infill));
  }
  expect(fingerprints.size).toBeGreaterThanOrEqual(4);
});
