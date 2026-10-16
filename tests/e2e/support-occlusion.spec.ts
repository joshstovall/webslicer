import { expect, test } from "@playwright/test";

test("support columns land above neighboring solids and retain clearance through lower layers", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const post = { ...primitive("cube", 1), scale: [0.25, 0.25, 0.25] };
    const roof = {
      ...primitive("cube", 1),
      tool: 1,
      position: [0, 0, 8],
      scale: [1, 1, 0.1],
      modifiers: [
        {
          ...primitive("cube", 1),
          enabled: true,
          kind: "support-enforcer",
          infill: 0,
          infillPattern: "grid",
          position: [0, 0, -1],
          scale: [2, 2, 2],
        },
      ],
    };
    const printer = PRINTERS.find((p) => p.id === "generic-multi")!;
    const out = [];
    for (const supports of ["auto", "manual"]) {
      const settings = {
        ...DEFAULT_SETTINGS,
        supports,
        adhesion: "none",
        minLayerTime: 0,
        adaptive: supports === "manual",
      };
      const r = await slicePlate(
        [post, roof],
        printer,
        settings,
        () => {},
        new AbortController().signal,
        [0, 1, 2].map((i) => defaultFilament(settings, i)),
        { ...DEFAULT_MULTI_MATERIAL, supportTool: 2, purgeVolume: 1 },
      );
      out.push({
        supports,
        center: printer.bed.slice(0, 2).map((v) => v / 2),
        paths: r.layers.flatMap((l) =>
          [...l.features].flatMap((f, i) =>
            f === 3
              ? [
                  {
                    z: l.z,
                    a: Array.from(l.segments.slice(i * 6, i * 6 + 3)),
                    b: Array.from(l.segments.slice(i * 6 + 3, i * 6 + 6)),
                  },
                ]
              : [],
          ),
        ),
      });
    }
    return out;
  });
  for (const r of results) {
    let insideBelow = 0,
      above = 0,
      below = 0;
    for (const p of r.paths)
      for (let i = 0; i <= 10; i++) {
        const x = p.a[0] + (i / 10) * (p.b[0] - p.a[0]) - r.center[0],
          y = p.a[1] + (i / 10) * (p.b[1] - p.a[1]) - r.center[1];
        if (p.z < 5) {
          below++;
          if (Math.abs(x) < 2.9 && Math.abs(y) < 2.9) insideBelow++;
        }
        if (p.z > 5.5 && Math.abs(x) < 2 && Math.abs(y) < 2) above++;
      }
    expect(insideBelow, r.supports).toBe(0);
    expect(below, r.supports).toBeGreaterThan(100);
    expect(above, r.supports).toBeGreaterThan(0);
  }
});

test("material boundaries do not create supports through another solid", async ({
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
    const models = [0, 1].map((tool) => ({
      ...primitive("cube", 1),
      tool,
      assemblyId: "stack",
      scale: [0.5, 0.5, 0.25],
      position: [0, 0, tool * 5],
    }));
    const mask = {
      ...primitive("cube", 1),
      kind: "support-enforcer",
      enabled: true,
      infill: 0,
      infillPattern: "grid",
      scale: [4, 4, 4],
    };
    const result = [];
    for (const supports of ["auto", "manual"]) {
      models[0].modifiers = supports === "manual" ? [mask] : [];
      const settings = {
        ...DEFAULT_SETTINGS,
        supports,
        adhesion: "none",
        minLayerTime: 0,
      };
      const r = await slicePlate(
        models,
        PRINTERS.find((p) => p.id === "generic-multi")!,
        settings,
        () => {},
        new AbortController().signal,
        [0, 1, 2].map((i) => defaultFilament(settings, i)),
        { ...DEFAULT_MULTI_MATERIAL, supportTool: 2, purgeVolume: 1 },
      );
      result.push({
        supports,
        count: r.layers.reduce(
          (n, l) => n + [...l.features].filter((f) => f === 3).length,
          0,
        ),
      });
    }
    return result;
  });
  for (const r of result) expect(r.count, r.supports).toBe(0);
});
