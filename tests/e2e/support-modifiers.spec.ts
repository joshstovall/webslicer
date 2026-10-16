import { expect, test } from "@playwright/test";
import { primitive, mergedVertices } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import { parseGcode } from "../../src/lib/gcode";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";

function fixture() {
  const stem = {
    ...primitive("cube", 1),
    scale: [0.25, 0.5, 0.4] as [number, number, number],
  };
  const cap = {
    ...primitive("cube", 1),
    scale: [1.5, 0.5, 0.15] as [number, number, number],
    position: [0, 0, 7.9] as [number, number, number],
  };
  return {
    ...stem,
    name: "Support test",
    positions: Array.from(mergedVertices([stem, cap])),
    scale: [1, 1, 1],
  };
}

test("hollow transformed enforcers stay scoped to linked materials and a dedicated support tool", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive, mergedVertices } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const models = [-1, 1].map((side, tool) => {
      const m = {
        ...primitive("cube", 1),
        position: [side * 12.5, 0, 8],
        scale: [1.25, 2.5, 0.1],
      };
      return {
        ...m,
        tool,
        assemblyId: "cap",
        positions: mergedVertices([m]),
        position: [0, 0, 0],
        scale: [1, 1, 1],
      };
    });
    models[0].modifiers = [
      {
        ...primitive("torus", 1),
        enabled: true,
        kind: "support-enforcer",
        infill: 0,
        infillPattern: "grid",
        position: [0, 0, 6.9],
        scale: [0.5, 0.3, 0.2],
        rotation: [0, 0, 30],
      },
    ];
    const settings = {
      ...DEFAULT_SETTINGS,
      supports: "manual",
      adhesion: "none",
      minLayerTime: 0,
      adaptive: true,
    };
    const unrelated = {
      ...primitive("cube", 1),
      position: [50, 0, 8],
      scale: [0.5, 0.5, 0.1],
      tool: 1,
    };
    const printer = PRINTERS.find((p) => p.id === "generic-multi")!;
    const r = await slicePlate(
      [...models, unrelated],
      printer,
      settings,
      () => {},
      new AbortController().signal,
      [0, 1, 2].map((i) => defaultFilament(settings, i)),
      { ...DEFAULT_MULTI_MATERIAL, supportTool: 2, purgeVolume: 1 },
    );
    return {
      bed: printer.bed,
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
    };
  });
  expect(result.paths.length).toBeGreaterThan(100);
  expect([...new Set(result.paths.map((p) => p.tool))]).toEqual([2]);
  let minimum = Infinity,
    maximum = -Infinity;
  for (const p of result.paths)
    for (let step = 0; step <= 10; step++) {
      const t = step / 10,
        x = p.a[0] + t * (p.b[0] - p.a[0]) - result.bed[0] / 2,
        y = p.a[1] + t * (p.b[1] - p.a[1]) - result.bed[1] / 2;
      const a = -Math.PI / 6,
        u = (x * Math.cos(a) - y * Math.sin(a)) / 0.5,
        v = (x * Math.sin(a) + y * Math.cos(a)) / 0.3;
      minimum = Math.min(minimum, Math.hypot(u, v));
      maximum = Math.max(maximum, Math.hypot(u, v));
    }
  expect(minimum).toBeGreaterThan(14.5);
  expect(maximum).toBeLessThan(29);
});

test("enforcers support shallow slopes excluded by automatic detection and fixed layers keep exact tops", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive, mergedVertices } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const cap = {
      ...primitive("cube", 1),
      scale: [1.5, 0.5, 0.15],
      position: [0, 0, 8],
    };
    const positions = mergedVertices([cap]);
    for (let i = 0; i < positions.length; i += 3)
      positions[i + 2] += positions[i] * 0.4;
    const model = { ...cap, positions, scale: [1, 1, 1], position: [0, 0, 0] };
    const mask = {
      ...primitive("cube", 1),
      enabled: true,
      kind: "support-enforcer",
      infill: 0,
      infillPattern: "grid",
      scale: [2, 2, 2],
    };
    const out = [];
    for (const first of [0.25, 0.201])
      for (const enforce of [false, true]) {
        const r = await slicePlate(
          [{ ...model, modifiers: enforce ? [mask] : [] }],
          PRINTERS[0],
          {
            ...DEFAULT_SETTINGS,
            supports: "auto",
            supportAngle: 85,
            adhesion: "none",
            minLayerTime: 0,
            firstLayerHeight: first,
            layerHeight: 0.25,
          },
          () => {},
          new AbortController().signal,
        );
        out.push({
          first,
          enforce,
          z: r.layers
            .filter((l) => [...l.features].some((f) => f === 3))
            .map((l) => l.z),
          count: r.layers.reduce(
            (n, l) => n + [...l.features].filter((f) => f === 3).length,
            0,
          ),
        });
      }
    return out;
  });
  for (const r of result) {
    if (!r.enforce) expect(r.count).toBe(0);
    else {
      expect(r.count).toBeGreaterThan(50);
      expect(Math.min(...r.z)).toBe(r.first);
      for (const z of r.z)
        expect((z - r.first) / 0.25).toBeCloseTo(
          Math.round((z - r.first) / 0.25),
          5,
        );
    }
  }
});

test("support-contact volumes change real support paths with priority and preserve model deposition", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(
    async ({ model }) => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const { DEFAULT_SETTINGS, PRINTERS } = await import(
        "/src/lib/profiles.ts"
      );
      const cube = primitive("cube", 1);
      const mask = {
        ...cube,
        enabled: true,
        kind: "support-blocker",
        infill: 0,
        infillPattern: "grid",
        position: [-10, 0, 7],
        scale: [1, 1, 0.1],
      };
      const outputs = [];
      for (const mode of [
        "auto",
        "left-block",
        "off-contact",
        "manual",
        "left-enforce",
        "block-last",
        "enforce-last",
        "disabled-mask",
        "adaptive",
        "manual-layers",
      ]) {
        const enforced = [
          "left-enforce",
          "block-last",
          "enforce-last",
          "adaptive",
          "manual-layers",
        ].includes(mode);
        const mods = ["auto", "manual"].includes(mode)
          ? []
          : [
              {
                ...mask,
                kind: enforced ? "support-enforcer" : "support-blocker",
                enabled: mode !== "disabled-mask",
                position: mode === "off-contact" ? [-10, 0, 2] : mask.position,
              },
            ];
        if (["block-last", "enforce-last"].includes(mode)) {
          mods[0].kind =
            mode === "block-last" ? "support-enforcer" : "support-blocker";
          mods.push({
            ...mods[0],
            id: "last",
            kind:
              mode === "block-last" ? "support-blocker" : "support-enforcer",
          });
        }
        const r = await slicePlate(
          [
            {
              ...model,
              positions: new Float32Array(model.positions),
              modifiers: mods,
            },
          ],
          PRINTERS[0],
          {
            ...DEFAULT_SETTINGS,
            supports: enforced || mode === "manual" ? "manual" : "auto",
            adhesion: "none",
            infill: 100,
            minLayerTime: 0,
            layerHeight: 0.25,
            firstLayerHeight: 0.25,
            adaptive: mode === "adaptive",
            manualLayers: mode === "manual-layers",
            layerHeightCurve: [
              { z: 0, height: 0.16 },
              { z: 11, height: 0.25 },
            ],
          },
          () => {},
          new AbortController().signal,
        );
        outputs.push({
          mode,
          paths: r.layers.flatMap((l) =>
            [...l.features].flatMap((f, i) =>
              f === 4
                ? []
                : [
                    {
                      f,
                      z: l.z,
                      a: Array.from(l.segments.slice(i * 6, i * 6 + 3)),
                      b: Array.from(l.segments.slice(i * 6 + 3, i * 6 + 6)),
                    },
                  ],
            ),
          ),
        });
      }
      return { outputs, center: PRINTERS[0].bed[0] / 2 };
    },
    { model: fixture() },
  );
  const paths = (mode: string) =>
    result.outputs.find((r) => r.mode === mode)!.paths;
  const supports = (mode: string) => paths(mode).filter((p) => p.f === 3);
  const left = (mode: string) =>
    supports(mode).filter((p) => Math.max(p.a[0], p.b[0]) < result.center - 2);
  const right = (mode: string) =>
    supports(mode).filter((p) => Math.min(p.a[0], p.b[0]) > result.center + 2);
  expect(left("auto").length).toBeGreaterThan(30);
  expect(right("auto").length).toBeGreaterThan(30);
  expect(left("left-block")).toHaveLength(0);
  expect(right("left-block").length).toBeGreaterThan(30);
  expect(supports("manual")).toHaveLength(0);
  expect(supports("block-last")).toHaveLength(0);
  for (const mode of [
    "left-enforce",
    "enforce-last",
    "adaptive",
    "manual-layers",
  ]) {
    expect(left(mode).length).toBeGreaterThan(30);
    expect(right(mode)).toHaveLength(0);
    expect(Math.min(...supports(mode).map((p) => p.z))).toBe(0.25);
  }
  const fingerprint = (mode: string, f: (n: number) => boolean) =>
    paths(mode)
      .filter((p) => f(p.f))
      // Fill linking depends on the preceding support travel. Compare walls and
      // deposition strokes, excluding the short connectors between strokes.
      .filter(
        (p) => p.f === 0 || Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1]) > 2,
      )
      .map(
        (p) =>
          `${p.f}:` +
          [p.a, p.b]
            .map((v) => v.map((n) => n.toFixed(3)).join(","))
            .sort()
            .join(":"),
      )
      .sort();
  for (const mode of [
    "left-block",
    "off-contact",
    "manual",
    "left-enforce",
    "block-last",
    "enforce-last",
    "disabled-mask",
  ])
    expect(
      fingerprint(mode, (f) => f !== 3),
      mode,
    ).toEqual(fingerprint("auto", (f) => f !== 3));
  for (const mode of ["off-contact", "disabled-mask"])
    expect(fingerprint(mode, (f) => f === 3)).toEqual(
      fingerprint("auto", (f) => f === 3),
    );
});

for (const width of [1440, 390])
  test(`support modifier editor, recovery and actual export at ${width}px`, async ({
    page,
  }) => {
    const phone = width === 390;
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Supports.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Supports",
            models: [fixture()],
            plates: [1],
            activePlate: 1,
            printer: PRINTERS[0],
            settings: {
              ...DEFAULT_SETTINGS,
              supports: "auto",
              adhesion: "none",
              minLayerTime: 0,
            },
          }),
        ),
      });
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    if (phone) {
      await button("Print setup").click();
      await page.getByRole("button", { name: /Support & adhesion/ }).click();
      await page
        .getByRole("combobox", { name: "Support generation", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Enforced only", exact: true })
        .click();
      await page.keyboard.press("Escape");
    }
    const effect = phone
      ? "Enforce support contacts"
      : "Block support contacts";
    const open = async () => {
      if (phone) await button("Objects 1").click();
      await button("Support test").click();
      await page.getByRole("button", { name: /^Object modifiers/ }).click();
    };
    await open();
    await button("Add cube").click();
    await page
      .getByRole("combobox", { name: "Modifier effect", exact: true })
      .click();
    await page.getByRole("option", { name: effect, exact: true }).click();
    await expect(field("Modifier infill density")).not.toBeVisible();
    await field("Modifier name").fill(
      phone ? "Left underside enforcer" : "Left underside blocker",
    );
    for (const [name, value] of [
      ["position X", "-10"],
      ["position Z", "7"],
      ["scale Z", "10"],
    ])
      await field(`Modifier ${name}`).fill(value);
    await button("Isometric").click();
    await field("Modifier name").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/stratum-support-modifier-${width}.png`,
      animations: "disabled",
    });
    await button("Apply modifiers").click();
    const menu = async (name: string) => {
      await page.locator(".project-menu").click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    await menu("Undo");
    await menu("Redo");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await open();
    await expect(
      page.getByRole("combobox", { name: "Modifier effect", exact: true }),
    ).toHaveValue(effect);
    await expect(field("Modifier position Z")).toHaveValue("7");
    await button("Cancel").click();
    const saving = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    const project = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await saving).path())!))),
    );
    expect(project.models[0].modifiers[0].kind).toBe(
      phone ? "support-enforcer" : "support-blocker",
    );
    await button("Slice plate").click();
    await expect(button("Export G-code")).toBeVisible({ timeout: 90000 });
    const downloading = page.waitForEvent("download");
    await button("Export G-code").click();
    const code = (
      await readFile((await (await downloading).path())!)
    ).toString();
    const supports = parseGcode(code).layers.flatMap((l) =>
      [...l.features].flatMap((f, i) =>
        f === 3 ? [Array.from(l.segments.slice(i * 6, i * 6 + 6))] : [],
      ),
    );
    expect(supports.length).toBeGreaterThan(30);
    for (const p of supports) {
      if (phone)
        expect(Math.max(p[0], p[3])).toBeLessThan(PRINTERS[0].bed[0] / 2);
      else expect(Math.min(p[0], p[3])).toBeGreaterThan(PRINTERS[0].bed[0] / 2);
    }
  });
