import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function seed(page: Page, disconnected = false) {
  await page.goto("/");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.evaluate(async (disconnected) => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { paintSurface } = await import("/src/lib/surface-paint.ts");
    const { assembleModels } = await import("/src/lib/assemblies.ts");
    const { saveLocal } = await import("/src/lib/project.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    let m = primitive("cube", 1);
    m = { ...m, positions: m.positions.map((v) => v * 0.4) };
    m = {
      ...m,
      paintDepth: 1.5,
      ...paintSurface(m, {
        mode: "face",
        point: [4, 0, 4],
        normal: [1, 0, 0],
        tool: 1,
        sourceTool: 0,
        radius: 3,
      }),
    };
    const models = disconnected
      ? assembleModels([m, { ...m, id: "second", position: [15, 0, 0] }])
      : [m];
    await saveLocal({
      version: 1,
      name: "Paint edit",
      models,
      printer: PRINTERS.find((p) => p.id === "generic-multi")!,
      settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
      plates: [1],
      activePlate: 1,
      filaments: [0, 1, 2].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
      multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
    });
  }, disconnected);
  await page.reload();
}
async function state(page: Page) {
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  return page.evaluate(async () => {
    const { loadLocal } = await import("/src/lib/project.ts");
    const { boundsOf } = await import("/src/lib/geometry.ts");
    return (await loadLocal())!.models.map((m) => ({
      id: m.id,
      tool: m.tool,
      assembly: m.assemblyId,
      painted: !!m.faceTools,
      bounds: [boundsOf(m).min.toArray(), boundsOf(m).max.toArray()],
    }));
  });
}
for (const width of [1440, 390])
  test(`painted height edits preserve lower colors through undo, recovery and real slicing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await seed(page);
    if (width === 390)
      await page
        .getByRole("button", { name: "Objects 1", exact: true })
        .click();
    await page.locator(".object-row:visible").first().click();
    await page
      .getByRole("button", { name: "More model tools", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Color by height", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Color boundary above bed", exact: true })
      .fill("4");
    await page
      .getByRole("combobox", { name: "Filament above boundary", exact: true })
      .click();
    await page.getByRole("option", { name: "3. PLA 3", exact: true }).click();
    await page
      .getByRole("button", { name: "Apply height color", exact: true })
      .click();
    await expect(page.locator(".object-row:visible")).toHaveCount(3);
    const after = await state(page);
    expect(new Set(after.map((m) => m.assembly)).size).toBe(1);
    expect(after.map((m) => m.tool).sort()).toEqual([0, 1, 2]);
    if (width === 390) await page.keyboard.press("Escape");
    if (width === 390) {
      await page.locator(".project-menu").click();
      await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    } else
      await page
        .getByRole("button", { name: "Undo (⌘Z)", exact: true })
        .click();
    expect((await state(page)).map((m) => m.painted)).toEqual([true]);
    if (width === 390) {
      await page.locator(".project-menu").click();
      await page.getByRole("menuitem", { name: "Redo", exact: true }).click();
    } else
      await page
        .getByRole("button", { name: "Redo (⇧⌘Z)", exact: true })
        .click();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    const paths = await page.evaluate(async () => {
      const { loadLocal } = await import("/src/lib/project.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const p = (await loadLocal())!;
      const r = await slicePlate(
        p.models,
        p.printer,
        p.settings,
        () => {},
        new AbortController().signal,
        p.filaments,
        p.multiMaterial,
      );
      const low = new Set<number>(),
        high = new Set<number>(),
        side: number[] = [];
      for (const l of r.layers)
        for (let i = 0; i < l.tools.length; i++) {
          if (l.features[i] === 4 || l.features[i] === 5) continue;
          if (l.z < 3.8) {
            low.add(l.tools[i]);
            if (l.tools[i] === 1) side.push(l.segments[i * 6 + 3] - 128);
          }
          if (l.z > 4.2) high.add(l.tools[i]);
        }
      return {
        low: [...low].sort(),
        high: [...high],
        minSide: Math.min(...side),
        maxSide: Math.max(...side),
      };
    });
    expect(paths.low).toEqual([0, 1]);
    expect(paths.high).toEqual([2]);
    expect(paths.minSide).toBeGreaterThanOrEqual(2.49);
    expect(paths.maxSide).toBeLessThanOrEqual(4.01);
  });
test("cut and split preserve the geometry and grouping of painted pieces", async ({
  page,
}) => {
  await seed(page, true);
  await page.locator(".object-row").first().click();
  await page
    .getByRole("button", { name: "More model tools", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Split connected parts", exact: true })
    .click();
  await expect(page.locator(".object-row")).toHaveCount(4);
  const split = await state(page);
  expect(new Set(split.map((m) => m.assembly)).size).toBe(2);
  for (const id of new Set(split.map((m) => m.assembly)))
    expect(
      split
        .filter((m) => m.assembly === id)
        .map((m) => m.tool)
        .sort(),
    ).toEqual([0, 1]);
  await page.getByRole("button", { name: "Undo (⌘Z)", exact: true }).click();
  await expect(page.locator(".object-row")).toHaveCount(2);
  await page.locator(".object-row").first().click();
  await page.getByRole("button", { name: "Cut model", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Height above bed", exact: true })
    .fill("4");
  await page
    .getByRole("button", { name: "Cut and arrange", exact: true })
    .click();
  await expect(page.locator(".object-row")).toHaveCount(8);
  const cut = await state(page);
  expect(new Set(cut.map((m) => m.assembly)).size).toBe(2);
  for (const id of new Set(cut.map((m) => m.assembly))) {
    const group = cut.filter((m) => m.assembly === id);
    expect(group.map((m) => m.tool).sort()).toEqual([0, 0, 1, 1]);
    expect(Math.min(...group.map((m) => m.bounds[0][2]))).toBeCloseTo(0);
    expect(Math.max(...group.map((m) => m.bounds[1][2]))).toBeCloseTo(4);
  }
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export G-code", exact: true }),
  ).toBeVisible({ timeout: 60000 });
});
test("cancelling an editing worker leaves the original painted project unchanged and permits retry", async ({
  page,
}) => {
  await seed(page);
  const original = await state(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/manifold.wasm*", async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page.getByRole("button", { name: "Cut model", exact: true }).click();
  await page
    .getByRole("button", { name: "Cut and arrange", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel edit", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel edit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cancel edit", exact: true }),
  ).toBeHidden();
  expect(await state(page)).toEqual(original);
  release();
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("button", { name: "Cut model", exact: true }).click();
  await page
    .getByRole("button", { name: "Cut and arrange", exact: true })
    .click();
  await expect(page.locator(".object-row")).toHaveCount(4);
});
