import { expect, test } from "@playwright/test";

test("support contacts agree with model quantization at and around a sampling plane", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { paintSupportSurface } = await import("/src/lib/support-paint.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const out = [];
    for (const z of [7.9, 7.9004, 7.8996, 8])
      for (const supports of ["auto", "manual"]) {
        let m = {
          ...primitive("cube", 1),
          position: [0, 0, z],
          scale: [0.5, 0.5, 0.1],
        };
        if (supports === "manual")
          m = {
            ...m,
            ...paintSupportSurface(m, {
              point: [0, 0, z],
              normal: [0, 0, -1],
              tool: 1,
              sourceTool: 0,
              mode: "face",
              radius: 3,
            }),
          };
        const r = await slicePlate(
          [m],
          PRINTERS[0],
          {
            ...DEFAULT_SETTINGS,
            supports,
            firstLayerHeight: 0.2,
            adhesion: "none",
            minLayerTime: 0,
          },
          () => {},
          new AbortController().signal,
        );
        out.push({
          z,
          supports,
          count: r.layers.reduce(
            (n, l) => n + [...l.features].filter((f) => f === 3).length,
            0,
          ),
        });
      }
    return out;
  });
  for (const result of results)
    expect(result.count, JSON.stringify(result)).toBeGreaterThan(30);
});

test("paint survives worker cuts and assembly moves and overrides blocker volumes on shared variable layers", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { paintSupportSurface } = await import("/src/lib/support-paint.ts");
    const { paintSurface } = await import("/src/lib/surface-paint.ts");
    const { editModelSelection } = await import("/src/lib/material-edits.ts");
    const { updateAssembly } = await import("/src/lib/assemblies.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    let model = {
      ...primitive("cube", 1),
      position: [0, 0, 8],
      scale: [1, 1, 0.4],
    };
    model = {
      ...model,
      ...paintSurface(model, {
        point: [0, 0, 16],
        normal: [0, 0, 1],
        mode: "face",
        radius: 4,
        tool: 1,
        sourceTool: 0,
      }),
    };
    model = {
      ...model,
      ...paintSupportSurface(model, {
        point: [0, 0, 8],
        normal: [0, 0, -1],
        mode: "brush",
        radius: 4,
        tool: 1,
        sourceTool: 0,
      }),
      modifiers: [
        {
          ...primitive("cube", 1),
          position: [0, 0, -2],
          scale: [2, 2, 2],
          kind: "support-blocker",
          enabled: true,
          infill: 0,
          infillPattern: "grid",
        },
      ],
    };
    const edited = await editModelSelection(
      [model],
      model.id,
      { kind: "cut", height: 15.5, keep: "lower", flipUpper: false },
      ["#aaaaaa", "#bb5555"],
      0.8,
      true,
      new AbortController().signal,
      () => {},
    );
    const first = edited.models[0];
    const models = updateAssembly(
      edited.models,
      first.id,
      { position: [first.position[0], first.position[1], 8] },
      true,
      false,
    );
    const printer = PRINTERS.find((p) => p.id === "generic-multi")!;
    const outputs = [];
    for (const mode of ["adaptive", "manual"]) {
      const settings = {
        ...DEFAULT_SETTINGS,
        adhesion: "none",
        minLayerTime: 0,
        supports: "manual",
        adaptive: mode === "adaptive",
        manualLayers: mode === "manual",
        layerHeightCurve: [
          { z: 0, height: 0.12 },
          { z: 16, height: 0.2 },
        ],
      };
      const r = await slicePlate(
        models,
        printer,
        settings,
        () => {},
        new AbortController().signal,
        [0, 1, 2].map((i) => defaultFilament(settings, i)),
        { ...DEFAULT_MULTI_MATERIAL, supportTool: 2, purgeVolume: 1 },
      );
      outputs.push({
        mode,
        paths: r.layers.flatMap((l) =>
          [...l.features].flatMap((f, i) =>
            f === 3
              ? [
                  {
                    tool: l.tools[i],
                    a: Array.from(l.segments.slice(i * 6, i * 6 + 3)),
                    b: Array.from(l.segments.slice(i * 6 + 3, i * 6 + 6)),
                  },
                ]
              : [],
          ),
        ),
        modelTools: [
          ...new Set(
            r.layers.flatMap((l) =>
              [...l.tools].filter(
                (_, i) =>
                  l.features[i] !== 3 &&
                  l.features[i] !== 4 &&
                  l.features[i] !== 5,
              ),
            ),
          ),
        ],
      });
    }
    return {
      outputs,
      center: printer.bed[0] / 2,
      paintedParts: models.filter((m) => m.supportPaint).length,
    };
  });
  expect(result.paintedParts).toBe(1);
  for (const output of result.outputs) {
    expect(output.modelTools.sort()).toEqual([0, 1]);
    expect(output.paths.length).toBeGreaterThan(30);
    expect([...new Set(output.paths.map((p) => p.tool))]).toEqual([2]);
    let maximum = 0;
    for (const p of output.paths)
      for (let i = 0; i <= 10; i++)
        maximum = Math.max(
          maximum,
          Math.hypot(
            p.a[0] + (i / 10) * (p.b[0] - p.a[0]) - result.center,
            p.a[1] + (i / 10) * (p.b[1] - p.a[1]) - result.center,
          ),
        );
    expect(maximum).toBeLessThan(4.4);
  }
});

test("painted support contacts enforce, block and erase actual paths independently of material colors", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive, mergedVertices } = await import("/src/lib/geometry.ts");
    const { paintSupportSurface } = await import("/src/lib/support-paint.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const stem = { ...primitive("cube", 1), scale: [0.25, 0.5, 0.4] };
    const cap = {
      ...primitive("cube", 1),
      scale: [1.5, 0.5, 0.15],
      position: [0, 0, 7.9],
    };
    const model = {
      ...stem,
      positions: mergedVertices([stem, cap]),
      scale: [1, 1, 1],
    };
    const stroke = {
      point: [-9, 0, 7.9],
      normal: [0, 0, -1],
      mode: "brush",
      radius: 4,
      tool: 1,
      sourceTool: 0,
    };
    const enforced = { ...model, ...paintSupportSurface(model, stroke) };
    const blocked = {
      ...model,
      ...paintSupportSurface(model, { ...stroke, tool: 2 }),
    };
    const erased = {
      ...enforced,
      ...paintSupportSurface(enforced, { ...stroke, tool: 0 }),
    };
    const topOnly = {
      ...model,
      ...paintSupportSurface(model, {
        ...stroke,
        point: [-9, 0, 10.9],
        normal: [0, 0, 1],
      }),
    };
    const out = [];
    for (const [mode, m, supports] of [
      ["auto", model, "auto"],
      ["enforce", enforced, "manual"],
      ["block", blocked, "auto"],
      ["erase", erased, "manual"],
      ["top", topOnly, "manual"],
    ]) {
      const r = await slicePlate(
        [m],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          supports,
          adhesion: "none",
          minLayerTime: 0,
          firstLayerHeight: 0.2,
        },
        () => {},
        new AbortController().signal,
      );
      out.push({
        mode,
        paths: r.layers.flatMap((l) =>
          [...l.features].flatMap((f, i) =>
            f === 3
              ? [
                  {
                    a: Array.from(l.segments.slice(i * 6, i * 6 + 3)),
                    b: Array.from(l.segments.slice(i * 6 + 3, i * 6 + 6)),
                  },
                ]
              : [],
          ),
        ),
      });
    }
    return { out, center: PRINTERS[0].bed[0] / 2 };
  });
  const paths = (mode: string) =>
    result.out.find((r) => r.mode === mode)!.paths;
  expect(paths("auto").length).toBeGreaterThan(100);
  expect(paths("enforce").length).toBeGreaterThan(30);
  expect(paths("erase")).toHaveLength(0);
  expect(paths("top")).toHaveLength(0);
  let radius = 0,
    insideBlock = 0,
    right = 0;
  for (const p of paths("enforce"))
    for (let i = 0; i <= 10; i++) {
      const x = p.a[0] + (i / 10) * (p.b[0] - p.a[0]) - result.center + 9,
        y = p.a[1] + (i / 10) * (p.b[1] - p.a[1]) - result.center;
      radius = Math.max(radius, Math.hypot(x, y));
    }
  // Support-brush boundary triangles use <= 0.15 * radius detail.
  expect(radius).toBeLessThan(4.4);
  for (const p of paths("block"))
    for (let i = 0; i <= 10; i++) {
      const x = p.a[0] + (i / 10) * (p.b[0] - p.a[0]) - result.center,
        y = p.a[1] + (i / 10) * (p.b[1] - p.a[1]) - result.center;
      if (Math.hypot(x + 9, y) < 3) insideBlock++;
      if (x > 3) right++;
    }
  expect(insideBlock).toBe(0);
  expect(right).toBeGreaterThan(100);
});
