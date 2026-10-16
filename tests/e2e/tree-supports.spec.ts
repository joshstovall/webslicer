import { test, expect } from "@playwright/test";

function contours(paths: number[][]) {
  const vertices = new Map<string, { x: number; y: number; edges: number[] }>(),
    edges: string[][] = [];
  for (const p of paths) {
    const keys = [
      `${p[0].toFixed(2)},${p[1].toFixed(2)}`,
      `${p[3].toFixed(2)},${p[4].toFixed(2)}`,
    ];
    if (keys[0] === keys[1]) continue;
    const index = edges.length;
    edges.push(keys);
    keys.forEach((k, j) => {
      if (!vertices.has(k))
        vertices.set(k, { x: p[j * 3], y: p[j * 3 + 1], edges: [] });
      vertices.get(k)!.edges.push(index);
    });
  }
  const seen = new Set<string>(),
    loops: { x: number; y: number; points: { x: number; y: number }[] }[] = [];
  for (const [start] of vertices) {
    if (seen.has(start)) continue;
    const queue = [start],
      component = [];
    let closed = true;
    while (queue.length) {
      const k = queue.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      const v = vertices.get(k)!;
      component.push(v);
      closed &&= v.edges.length === 2;
      for (const e of v.edges)
        for (const next of edges[e]) if (!seen.has(next)) queue.push(next);
    }
    if (closed && component.length >= 8)
      loops.push({
        x: component.reduce((s, p) => s + p.x, 0) / component.length,
        y: component.reduce((s, p) => s + p.y, 0) / component.length,
        points: component,
      });
  }
  return loops;
}

test("separate canopy contacts form tilted branches that merge into bed trunks", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive, mergedVertices } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const roof = primitive("cube", 1);
    const model = {
      ...roof,
      positions: mergedVertices(
        [-6, 6].map((x) => ({
          ...roof,
          position: [x, 0, 14],
          scale: [0.2, 0.2, 0.1],
        })),
      ),
    };
    const out = [];
    for (const supports of ["auto", "tree"]) {
      const result = await slicePlate(
        [model],
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
        supports,
        layers: result.layers.map((l) => ({
          z: l.z,
          paths: [...l.features].flatMap((f, i) =>
            f === 3 ? [[...l.segments.slice(i * 6, i * 6 + 6)]] : [],
          ),
        })),
      });
    }
    return out;
  });
  const tree = result
    .find((r) => r.supports === "tree")!
    .layers.filter((l) => l.paths.length);
  const normal = result
    .find((r) => r.supports === "auto")!
    .layers.filter((l) => l.paths.length);
  const sections = tree.map((l) => ({ z: l.z, loops: contours(l.paths) }));
  expect(tree.length).toBeGreaterThan(40);
  expect(sections.some((s) => s.loops.length >= 3)).toBe(true);
  expect(sections[0].loops.length).toBeLessThan(
    Math.max(...sections.map((s) => s.loops.length)),
  );
  const at = (layers: typeof tree, z: number) =>
    layers.find((l) => Math.abs(l.z - z) < 0.01)!;
  const width = (paths: number[][]) =>
    Math.max(...paths.flatMap((p) => [p[0], p[3]])) -
    Math.min(...paths.flatMap((p) => [p[0], p[3]]));
  expect(width(at(tree, 1).paths)).toBeLessThan(width(at(normal, 1).paths) - 3);
  expect(
    sections.some((s) => s.loops.some((p) => Math.abs(p.x - 110) < 2)),
  ).toBe(true);
});

for (const schedule of ["fixed", "adaptive", "manual"])
  test(`tree contacts avoid neighboring solids and use a shared ${schedule} material grid`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (schedule) => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const { DEFAULT_SETTINGS, PRINTERS } = await import(
        "/src/lib/profiles.ts"
      );
      const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
        "/src/lib/multimaterial.ts"
      );
      const cube = primitive("cube", 1);
      const models = [
        { ...cube, id: "post", scale: [0.25, 0.25, 0.25] },
        ...[-6, 6].map((x, i) => ({
          ...cube,
          id: `roof-${i}`,
          tool: i,
          position: [x, 0, 14],
          scale: [0.2, 0.2, 0.1],
        })),
      ];
      const settings = {
        ...DEFAULT_SETTINGS,
        supports: "tree",
        adhesion: "none",
        minLayerTime: 0,
        firstLayerHeight: 0.2,
        layerHeight: schedule === "manual" ? 0.28 : 0.2,
        adaptive: schedule === "adaptive",
        minLayerHeight: 0.1,
        manualLayers: schedule === "manual",
        layerHeightCurve: [
          { z: 0, height: 0.12 },
          { z: 7, height: 0.28 },
          { z: 16, height: 0.12 },
        ],
      };
      const printer = PRINTERS.find((p) => p.id === "generic-multi")!;
      const result = await slicePlate(
        models,
        printer,
        settings,
        () => {},
        new AbortController().signal,
        [0, 1, 2].map((i) => defaultFilament(settings, i)),
        { ...DEFAULT_MULTI_MATERIAL, supportTool: 2, purgeVolume: 1 },
      );
      return {
        layers: result.layers.map((l) => ({
          z: l.z,
          paths: [...l.features].flatMap((f, i) =>
            f === 3
              ? [
                  {
                    tool: l.tools[i],
                    p: [...l.segments.slice(i * 6, i * 6 + 6)],
                  },
                ]
              : [],
          ),
        })),
      };
    }, schedule);
    let count = 0,
      below = 0,
      collisions = 0,
      wrongTools = 0;
    for (const layer of result.layers)
      for (const { tool, p } of layer.paths) {
        if (tool !== 2) wrongTools++;
        count++;
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const x = p[0] + (p[3] - p[0]) * t - 128,
            y = p[1] + (p[4] - p[1]) * t - 128;
          if (layer.z < 5) {
            below++;
            if (Math.abs(x) < 2.89 && Math.abs(y) < 2.89) collisions++;
          }
        }
      }
    expect(collisions).toBe(0);
    expect(wrongTools).toBe(0);
    expect(count).toBeGreaterThan(100);
    expect(below).toBeGreaterThan(100);
    const keys = result.layers.flatMap((l) =>
      l.paths.map(
        ({ p }) =>
          `${l.z}:${[
            p
              .slice(0, 3)
              .map((x) => x.toFixed(3))
              .join(","),
            p
              .slice(3)
              .map((x) => x.toFixed(3))
              .join(","),
          ]
            .sort()
            .join(":")}`,
      ),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

for (const contactMode of ["automatic", "volume", "paint"])
  test(`wide canopy trees land on a post and retain ${contactMode} contacts`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (contactMode) => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { paintSupportSurface } = await import("/src/lib/support-paint.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const { DEFAULT_SETTINGS, PRINTERS } = await import(
        "/src/lib/profiles.ts"
      );
      let roof = {
        ...primitive("cube", 1),
        position: [0, 0, 12],
        scale: [1, 1, 0.1],
      };
      if (contactMode === "paint")
        roof = {
          ...roof,
          ...paintSupportSurface(roof, {
            point: [0, 0, 12],
            normal: [0, 0, -1],
            mode: "face",
            radius: 4,
            tool: 1,
            sourceTool: 0,
          }),
        };
      if (contactMode === "volume")
        roof.modifiers = [
          {
            ...primitive("cube", 1),
            enabled: true,
            kind: "support-enforcer",
            infill: 0,
            infillPattern: "grid",
            position: [0, 0, -1],
            scale: [2, 2, 2],
          },
        ];
      const result = await slicePlate(
        [{ ...primitive("cube", 1), scale: [0.25, 0.25, 0.25] }, roof],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          supports: contactMode === "automatic" ? "tree" : "tree-manual",
          adhesion: "none",
          minLayerTime: 0,
          firstLayerHeight: 0.2,
        },
        () => {},
        new AbortController().signal,
      );
      return result.layers.map((l) => ({
        z: l.z,
        paths: [...l.features].flatMap((f, i) =>
          f === 3 ? [[...l.segments.slice(i * 6, i * 6 + 6)]] : [],
        ),
      }));
    }, contactMode);
    let landing = 0,
      roots = 0,
      collisions = 0;
    for (const layer of result)
      for (const p of layer.paths) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const x = p[0] + t * (p[3] - p[0]) - 110,
            y = p[1] + t * (p[4] - p[1]) - 110;
          if (layer.z < 5) {
            roots++;
            if (Math.abs(x) < 2.89 && Math.abs(y) < 2.89) collisions++;
          }
          if (
            layer.z > 5.2 &&
            layer.z < 6 &&
            Math.abs(x) < 2 &&
            Math.abs(y) < 2
          )
            landing++;
        }
      }
    expect(collisions).toBe(0);
    expect(roots).toBeGreaterThan(100);
    expect(landing).toBeGreaterThan(0);
  });

test("manual trees obey paint blockers and volume contacts without inventing automatic contacts", async ({
  page,
}) => {
  await page.goto("/");
  const counts = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { paintSupportSurface } = await import("/src/lib/support-paint.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const roof = {
      ...primitive("cube", 1),
      position: [0, 0, 8],
      scale: [0.4, 0.4, 0.1],
    };
    const enforced = {
      ...roof,
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
    const blocked = {
      ...enforced,
      ...paintSupportSurface(enforced, {
        point: [0, 0, 8],
        normal: [0, 0, -1],
        mode: "face",
        radius: 3,
        tool: 2,
        sourceTool: 0,
      }),
    };
    const counts = [];
    for (const model of [roof, enforced, blocked]) {
      const r = await slicePlate(
        [model],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          supports: "tree-manual",
          adhesion: "none",
          minLayerTime: 0,
        },
        () => {},
        new AbortController().signal,
      );
      counts.push(
        r.layers.reduce(
          (n, l) => n + [...l.features].filter((f) => f === 3).length,
          0,
        ),
      );
    }
    return counts;
  });
  expect(counts[0]).toBe(0);
  expect(counts[1]).toBeGreaterThan(100);
  expect(counts[2]).toBe(0);
});

test("tree bed roots remain on the plate and receive a raft beneath an elevated hollow part", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const roof = {
      ...primitive("torus", 1),
      scale: [0.3, 0.3, 0.3],
      position: [0, 0, 8],
    };
    const result = await slicePlate(
      [roof],
      PRINTERS[0],
      {
        ...DEFAULT_SETTINGS,
        supports: "tree",
        adhesion: "raft",
        minLayerTime: 0,
      },
      () => {},
      new AbortController().signal,
    );
    return result.layers.map((l) => ({
      z: l.z,
      paths: [...l.features].flatMap((f, i) =>
        f === 3 ? [{ p: [...l.segments.slice(i * 6, i * 6 + 6)] }] : [],
      ),
      all: [...l.segments],
    }));
  });
  const support = result.filter((l) => l.paths.length);
  expect(support.length).toBeGreaterThan(20);
  const before = result.filter((l) => l.z < support[0].z);
  expect(before.length).toBeGreaterThan(0);
  const raft = before.at(-1)!.all;
  const xs = raft.filter((_, i) => i % 3 === 0),
    ys = raft.filter((_, i) => i % 3 === 1);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  let outsideRaft = 0,
    outsideBed = 0;
  for (const { p } of support[0].paths)
    for (const i of [0, 3])
      if (
        p[i] < minX - 0.01 ||
        p[i] > maxX + 0.01 ||
        p[i + 1] < minY - 0.01 ||
        p[i + 1] > maxY + 0.01
      )
        outsideRaft++;
  for (const l of support)
    for (const { p } of l.paths)
      for (const i of [0, 3])
        if (p[i] <= 0 || p[i] >= 220 || p[i + 1] <= 0 || p[i + 1] >= 220)
          outsideBed++;
  expect(outsideRaft).toBe(0);
  expect(outsideBed).toBe(0);
});

test("cancelling while growing trees cleans up workers and permits a subsequent tree export", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const model = {
      ...primitive("cube", 1),
      position: [0, 0, 12],
      scale: [1, 1, 0.1],
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      supports: "tree",
      adhesion: "none",
      minLayerTime: 0,
    };
    const controller = new AbortController();
    let cancelled = false,
      error = "";
    try {
      await slicePlate(
        [model],
        PRINTERS[0],
        settings,
        (_, stage) => {
          if (stage === "Growing tree supports") {
            cancelled = true;
            controller.abort();
          }
        },
        controller.signal,
      );
    } catch (e) {
      error = String(e);
    }
    const frames = document.querySelectorAll(
      'iframe[title="Local slicing engine"]',
    ).length;
    const result = await slicePlate(
      [{ ...model, scale: [0.2, 0.2, 0.1] }],
      PRINTERS[0],
      settings,
      () => {},
      new AbortController().signal,
    );
    return {
      cancelled,
      error,
      frames,
      segments: result.layers.reduce(
        (n, l) => n + [...l.features].filter((f) => f === 3).length,
        0,
      ),
      remaining: document.querySelectorAll(
        'iframe[title="Local slicing engine"]',
      ).length,
    };
  });
  expect(result.cancelled).toBe(true);
  expect(result.error).toMatch(/cancel|abort/i);
  expect(result.frames).toBe(0);
  expect(result.remaining).toBe(0);
  expect(result.segments).toBeGreaterThan(100);
});

test("Bambu tree supports retain the reserved corner and use the selected filament", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const printer = await loadVendorPrinter(
      VENDOR_PRINTERS.find((p) => p.id === "bambu-p1s")!,
    );
    const model = {
      ...primitive("cube", 1),
      position: [-106, -114, 10],
      scale: [0.2, 0.3, 0.1],
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      supports: "tree",
      adhesion: "none",
      minLayerTime: 0,
    };
    const result = await slicePlate(
      [model],
      printer,
      settings,
      () => {},
      new AbortController().signal,
      [0, 1].map((i) => defaultFilament(settings, i)),
      { ...DEFAULT_MULTI_MATERIAL, supportTool: 1, purgeVolume: 1 },
    );
    return {
      paths: result.layers.flatMap((l) =>
        [...l.features].flatMap((f, i) =>
          f === 3
            ? [{ p: [...l.segments.slice(i * 6, i * 6 + 6)], tool: l.tools[i] }]
            : [],
        ),
      ),
      warnings: result.warnings,
    };
  });
  expect(result.paths.length).toBeGreaterThan(100);
  let collision = 0,
    wrongTool = 0;
  for (const { p, tool } of result.paths) {
    if (tool !== 1) wrongTool++;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const x = p[0] + t * (p[3] - p[0]),
        y = p[1] + t * (p[4] - p[1]);
      if (x < 18 && y < 28) collision++;
    }
  }
  expect(collision).toBe(0);
  expect(wrongTool).toBe(0);
});
