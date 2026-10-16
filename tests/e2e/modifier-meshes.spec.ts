import { expect, test } from "@playwright/test";

test("spatial infill modifiers preserve shells and obey zero/full density and overlap priority", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS, PRINTERS } = await import("/src/lib/profiles.ts");
    const model = primitive("cube", 1);
    const mask = {
      ...primitive("cube", 1),
      name: "Left infill",
      position: [-5, 0, 5],
      scale: [0.5, 2, 0.5],
      enabled: true,
      infill: 100,
      infillPattern: "grid",
    };
    const out = [];
    for (const mode of [
      "base",
      "dense",
      "empty",
      "overlap",
      "base-solid",
      "base-empty",
    ]) {
      const modifiers =
        mode === "base"
          ? undefined
          : [
              {
                ...mask,
                infill: mode === "empty" || mode === "base-solid" ? 0 : 100,
              },
              ...(mode === "overlap"
                ? [
                    {
                      ...mask,
                      id: "second",
                      position: [-7.5, 0, 5],
                      scale: [0.25, 2, 0.5],
                      infill: 0,
                    },
                  ]
                : []),
            ];
      const r = await slicePlate(
        [{ ...model, modifiers }],
        PRINTERS[0],
        {
          ...DEFAULT_SETTINGS,
          layerHeight: 0.2,
          firstLayerHeight: 0.2,
          adhesion: "none",
          infill: mode === "base-solid" ? 100 : mode === "base-empty" ? 0 : 10,
          infillPattern: "grid",
          minLayerTime: 0,
        },
        () => {},
        new AbortController().signal,
      );
      out.push({
        mode,
        layers: r.layers
          .filter(
            (l) =>
              Math.abs(l.z - 10) < 0.01 ||
              Math.abs(l.z - 3) < 0.01 ||
              Math.abs(l.z - 18) < 0.01,
          )
          .map((l) => ({
            z: l.z,
            paths: [...l.features].flatMap((f, i) =>
              f === 4
                ? []
                : [
                    {
                      f,
                      a: [...l.segments.slice(i * 6, i * 6 + 3)],
                      b: [...l.segments.slice(i * 6 + 3, i * 6 + 6)],
                    },
                  ],
            ),
          })),
      });
    }
    return out;
  });
  const at = (mode: string, z: number) =>
    results.find((r) => r.mode === mode)!.layers.find((l) => l.z === z)!;
  const base = at("base", 10);
  const originX =
    (Math.min(...base.paths.flatMap((p) => [p.a[0], p.b[0]])) +
      Math.max(...base.paths.flatMap((p) => [p.a[0], p.b[0]]))) /
    2;
  const length = (mode: string, side: "left" | "right", z = 10) =>
    at(mode, z)
      .paths.filter(
        (p) =>
          p.f === 1 &&
          (side === "left"
            ? (p.a[0] + p.b[0]) / 2 < originX
            : (p.a[0] + p.b[0]) / 2 > originX),
      )
      .reduce(
        (sum, p) => sum + Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]),
        0,
      );
  const walls = (mode: string, z: number) =>
    at(mode, z)
      .paths.filter((p) => p.f === 0)
      .map((p) =>
        [p.a, p.b]
          .map((v) => v.map((n) => n.toFixed(3)).join(","))
          .sort()
          .join(":"),
      )
      .sort();
  for (const mode of results.map((r) => r.mode))
    expect(walls(mode, 10)).toEqual(walls("base", 10));
  expect(length("dense", "left")).toBeGreaterThan(length("base", "left") * 4);
  expect(length("empty", "left")).toBe(0);
  expect(length("empty", "right")).toBeGreaterThan(0);
  expect(length("base-solid", "left")).toBe(0);
  expect(length("base-solid", "right")).toBeGreaterThan(
    length("base", "right") * 4,
  );
  expect(length("base-empty", "left")).toBeGreaterThan(0);
  expect(length("base-empty", "right")).toBe(0);
  for (const p of at("overlap", 10).paths.filter((p) => p.f === 1))
    expect(Math.min(p.a[0], p.b[0])).toBeGreaterThanOrEqual(
      originX - 5 - 0.001,
    );
  for (const z of [3, 18]) {
    expect(walls("dense", z)).toEqual(walls("base", z));
    expect(length("dense", "left", z)).toBeCloseTo(
      length("base", "left", z),
      2,
    );
  }
});

import { primitive, exportSTL } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import { parseGcode } from "../../src/lib/gcode";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
for (const width of [1440, 390])
  test(`modifier editor, undo, recovery and sliced output at ${width}px`, async ({
    page,
  }) => {
    const phone = width === 390;
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const model = { ...primitive("cube", 1), name: "Modifier block" };
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Modifier test.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Modifier test",
            plates: [1],
            activePlate: 1,
            models: [{ ...model, positions: [...model.positions] }],
            printer: PRINTERS[0],
            settings: {
              ...DEFAULT_SETTINGS,
              adhesion: "none",
              infill: 10,
              infillPattern: "grid",
              minLayerTime: 0,
              firstLayerHeight: 0.2,
            },
          }),
        ),
      });
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    const open = async () => {
      if (phone) await button("Objects 1").click();
      await button("Modifier block").click();
      await page.getByRole("button", { name: /^Object modifiers/ }).click();
    };
    await open();
    const dialog = page.getByRole("dialog", { name: "Object modifiers" });
    await button("Add sphere").click();
    await button("Cancel").click();
    await expect(dialog).not.toBeVisible();
    await open();
    await expect(
      page.getByRole("combobox", { name: "Modifier volume" }),
    ).not.toBeVisible();
    if (phone) {
      await page
        .getByLabel("Import modifier mesh", { exact: true })
        .setInputFiles({
          name: "Imported cutter.stl",
          mimeType: "model/stl",
          buffer: Buffer.from(exportSTL([primitive("cube", 1)])),
        });
    } else await button("Add cube").click();
    await field("Modifier name").fill("Empty left core");
    await field("Modifier infill density").fill("0");
    for (const [name, value] of [
      ["position X", "-5"],
      ["position Z", "5"],
      ["scale X", "50"],
      ["scale Y", "200"],
      ["scale Z", "50"],
    ])
      await field(`Modifier ${name}`).fill(value);
    await button("Isometric").click();
    await field("Modifier name").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/stratum-modifier-${width}.png`,
      animations: "disabled",
    });
    await button("Apply modifiers").click();
    await expect(dialog).not.toBeVisible();
    const menu = async (name: string) => {
      await page.locator(".project-menu").click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    await menu("Undo");
    await menu("Redo");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await open();
    await expect(field("Modifier name")).toHaveValue("Empty left core");
    await expect(field("Modifier infill density")).toHaveValue("0 %");
    await expect(field("Modifier scale X")).toHaveValue("50");
    await button("Cancel").click();
    const pending = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    const portable = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await pending).path())!))),
    );
    expect(portable.models[0].modifiers[0].positions).toHaveLength(108);
    expect(portable.models[0].modifiers[0].infill).toBe(0);
    await button("Slice plate").click();
    await expect(button("Export G-code")).toBeVisible({ timeout: 90000 });
    const download = page.waitForEvent("download");
    await button("Export G-code").click();
    const code = (await readFile((await (await download).path())!)).toString();
    const layer = parseGcode(code).layers.find(
      (l) => Math.abs(l.z - 10) < 0.01,
    )!;
    expect(layer).toBeTruthy();
    const infill = [...layer.features].flatMap((f, i) =>
      f === 1 ? [Array.from(layer.segments.slice(i * 6, i * 6 + 6))] : [],
    );
    expect(infill.length).toBeGreaterThan(0);
    for (const segment of infill)
      expect(Math.min(segment[0], segment[3])).toBeGreaterThanOrEqual(
        PRINTERS[0].bed[0] / 2 - 0.001,
      );
  });

test("hollow and rotated mesh modifiers retain holes across shared multicolor adaptive layers", async ({
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
      adhesion: "none",
      infill: 0,
      minLayerTime: 0,
      adaptive: true,
      minLayerHeight: 0.08,
    };
    const ring = {
      ...primitive("torus", 1),
      enabled: true,
      infill: 50,
      infillPattern: "linear",
      position: [0, 0, 4],
      scale: [0.3, 0.6, 1],
      rotation: [0, 0, 30],
    };
    // Each model is a 20 mm half of a 40 mm-wide assembly; modifier coordinates belong to the left half.
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
    // Put the ring's center at the assembly boundary in the owner's local frame.
    ring.position = [10, 0, 4];
    const r = await slicePlate(
      [left, right],
      PRINTERS.find((p) => p.id === "generic-multi")!,
      settings,
      () => {},
      new AbortController().signal,
      [0, 1].map((i) => defaultFilament(settings, i)),
      { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
    );
    const bad = {
      ...left,
      modifiers: [{ ...ring, positions: ring.positions.slice(9) }],
    };
    let error = "";
    try {
      await slicePlate(
        [bad],
        PRINTERS[0],
        settings,
        () => {},
        new AbortController().signal,
      );
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      error,
      bed: PRINTERS.find((p) => p.id === "generic-multi")!.bed,
      layers: r.layers
        .filter((l) => l.z > 9 && l.z < 11)
        .map((l) => ({
          z: l.z,
          paths: [...l.features].flatMap((f, i) =>
            f === 1
              ? [
                  {
                    tool: l.tools[i],
                    a: [...l.segments.slice(i * 6, i * 6 + 3)],
                    b: [...l.segments.slice(i * 6 + 3, i * 6 + 6)],
                  },
                ]
              : [],
          ),
        })),
    };
  });
  expect(result.error).toMatch(/closed, consistently oriented/);
  expect(result.layers.length).toBeGreaterThan(4);
  expect(
    [
      ...new Set(result.layers.flatMap((l) => l.paths.map((p) => p.tool))),
    ].sort(),
  ).toEqual([0, 1]);
  for (const layer of result.layers) {
    expect(layer.paths.length).toBeGreaterThan(0);
    for (const p of layer.paths) {
      for (let step = 0; step <= 10; step++) {
        const t = step / 10,
          x = p.a[0] + t * (p.b[0] - p.a[0]) - result.bed[0] / 2,
          y = p.a[1] + t * (p.b[1] - p.a[1]) - result.bed[1] / 2;
        const angle = -Math.PI / 6;
        const u = (x * Math.cos(angle) - y * Math.sin(angle)) / 0.3,
          v = (x * Math.sin(angle) + y * Math.cos(angle)) / 0.6;
        const radius = Math.hypot(u, v);
        // Torus XY midsection spans radii 16..28; faceting only shrinks this slightly.
        expect(radius).toBeGreaterThan(15.8);
        expect(radius).toBeLessThan(28.2);
      }
    }
  }
});
