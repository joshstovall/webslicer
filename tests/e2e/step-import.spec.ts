import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { parseGcode } from "../../src/lib/gcode";
const stepFile = async () => ({
  name: "Cube.step",
  mimeType: "application/step",
  buffer: await readFile(
    "node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.stp",
  ),
});
test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.locator(".project-menu").click();
  await page
    .getByRole("menuitem", { name: "New project", exact: true })
    .click();
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
});
for (const width of [1440, 1024, 390])
  test(`STEP import, recovery and real slicing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles(await stepFile());
    const dialog = page.getByRole("dialog", { name: "Import STEP model" });
    await expect(dialog).toBeVisible();
    const link = dialog.getByRole("link", {
      name: "CAD converter licenses and source",
    });
    expect(
      (await page.request.get((await link.getAttribute("href"))!)).ok(),
    ).toBe(true);
    await dialog.getByRole("switch", { name: "Import CAD colors" }).uncheck();
    const start = dialog.getByRole("button", {
      name: "Import STEP",
      exact: true,
    });
    const bounds = await start.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(width === 390 ? 844 : 1000);
    await page.screenshot({
      path: `/tmp/stratum-step-${width}.png`,
      animations: "disabled",
    });
    await start.click();
    await expect(dialog).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator(".object-row")).toHaveCount(1);
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const saved = page.waitForEvent("download");
    await page.locator(".project-menu").click();
    await page.getByRole("menuitem", { name: /^Save project/ }).click();
    const project = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await saved).path())!))),
    );
    expect(project.models).toHaveLength(1);
    const positions = project.models[0].positions;
    expect(positions).toHaveLength(108);
    for (let a = 0; a < 3; a++) {
      const coords = positions.filter((_: number, i: number) => i % 3 === a);
      expect(Math.max(...coords) - Math.min(...coords)).toBeCloseTo(10, 3);
    }
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exportButton = page.getByRole("button", {
      name: "Export G-code",
      exact: true,
    });
    await expect(exportButton).toBeVisible({ timeout: 90000 });
    const output = page.waitForEvent("download");
    await exportButton.click();
    const gcode = parseGcode(
      await readFile((await (await output).path())!, "utf8"),
    );
    expect(gcode.layers.length).toBeGreaterThan(20);
    expect(gcode.layers.at(-1)!.z).toBeCloseTo(10, 1);
  });

test("STEP review cancellation and conversion cancellation preserve the plate and permit retry", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const input = page.locator("input[type=file]").first();
  await input.setInputFiles(await stepFile());
  await page
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  await expect(page.locator(".object-row")).toHaveCount(0);
  // Hold the WASM response to exercise cancellation after worker creation deterministically.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/occt-import-js.*\.wasm/, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await input.setInputFiles(await stepFile());
  await page.getByRole("button", { name: "Import STEP", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Loading CAD converter");
  await page
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("dialog", { name: "Import STEP model" }),
  ).toHaveCount(0);
  await expect(page.locator(".object-row")).toHaveCount(0);
  await input.setInputFiles(await stepFile());
  await page.getByRole("button", { name: "Import STEP", exact: true }).click();
  await expect(page.locator(".object-row")).toHaveCount(1, { timeout: 30000 });
});

test("CAD face colors survive project recovery and generate real material toolpaths", async ({
  page,
}) => {
  const { DEFAULT_SETTINGS, PRINTERS } = await import("../../src/lib/profiles");
  const { defaultFilament } = await import("../../src/lib/multimaterial");
  const input = page.locator("input[type=file]").first();
  await input.setInputFiles({
    name: "CAD colors.webslicer",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        name: "CAD colors",
        models: [],
        plates: [1],
        activePlate: 1,
        printer: PRINTERS.find((p) => p.name === "Custom multi-extruder FDM"),
        settings: { ...DEFAULT_SETTINGS, minLayerTime: 0 },
        filaments: [{ ...defaultFilament(DEFAULT_SETTINGS), color: "#cccccc" }],
      }),
    ),
  });
  await input.setInputFiles({
    name: "Colored cube.step",
    mimeType: "application/step",
    buffer: await readFile(
      "node_modules/occt-import-js/test/testfiles/cube-fcstd/cube.step",
    ),
  });
  await page.getByRole("button", { name: "Import STEP", exact: true }).click();
  await expect(page.locator(".object-row")).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.reload();
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const saving = page.waitForEvent("download");
  await page.locator(".project-menu").click();
  await page.getByRole("menuitem", { name: /^Save project/ }).click();
  const saved = JSON.parse(
    strFromU8(gunzipSync(await readFile((await (await saving).path())!))),
  );
  expect(saved.filaments.map((f: any) => f.color).sort()).toEqual(
    ["#cccccc", "#ff0000", "#0000ff", "#00aa00"].sort(),
  );
  expect([...new Set(saved.models[0].faceTools)].sort()).toEqual([0, 1, 2, 3]);
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  const exportButton = page.getByRole("button", {
    name: "Export G-code",
    exact: true,
  });
  await expect(exportButton).toBeVisible({ timeout: 90000 });
  const output = page.waitForEvent("download");
  await exportButton.click();
  const result = parseGcode(
    await readFile((await (await output).path())!, "utf8"),
  );
  const modelTools = new Set<number>();
  for (const layer of result.layers)
    for (let i = 0; i < layer.features.length; i++)
      if (![4, 5].includes(layer.features[i])) modelTools.add(layer.tools[i]);
  expect([...modelTools].sort()).toEqual([0, 1, 2, 3]);
});
