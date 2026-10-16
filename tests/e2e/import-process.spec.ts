import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { process3mf, processConfig } from "../fixtures/process-3mf";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import { parseGcode } from "../../src/lib/gcode";

test.use({ hasTouch: true });
for (const width of [1440, 1024, 390])
  test(`3MF settings review, selection, recovery and real export at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const files = page.locator('input[type="file"]').first();
    const initial = {
      version: 1,
      name: "Import review",
      plates: [1],
      activePlate: 1,
      models: [],
      printer: PRINTERS[0],
      settings: {
        ...DEFAULT_SETTINGS,
        minLayerTime: 0,
        manualLayers: true,
        layerHeightCurve: [
          { z: 0, height: 0.12 },
          { z: 6, height: 0.2 },
        ],
      },
    };
    await files.setInputFiles({
      name: "Initial.webslicer",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(initial)),
    });
    await files.setInputFiles({
      name: "Orca process.3mf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(process3mf(processConfig, true)),
    });
    const dialog = page.getByRole("dialog", { name: "Import 3MF settings" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("checkbox", { name: "Wall loops", exact: true })
      .uncheck();
    await dialog.locator("summary").click();
    await expect(dialog).toContainText(
      "Per-object process overrides are not transferred",
    );
    await expect(dialog).toContainText("variable layer profiles");
    await expect(dialog).toContainText("Painted support selections");
    await expect(dialog).toContainText("machine_start_gcode");
    await dialog.locator("summary").click();
    const transfer = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download transfer report" })
      .click();
    const report = JSON.parse(
      await readFile((await (await transfer).path())!, "utf8"),
    );
    expect(report.selected).not.toContain("wall_loops");
    expect(
      report.skipped.some((s: any) => s.key === "machine_start_gcode"),
    ).toBe(true);
    await dialog
      .locator(".mantine-ScrollArea-viewport")
      .first()
      .evaluate((el) => {
        el.scrollTop = 0;
      });
    const applyBounds = await dialog
      .getByRole("button", { name: "Import selected settings" })
      .boundingBox();
    expect(applyBounds!.y + applyBounds!.height).toBeLessThan(
      (width === 390 ? 844 : 1000) + 1,
    );
    await page.screenshot({
      path: `/tmp/stratum-import-process-${width}.png`,
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Import selected settings" })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".object-row")).toHaveCount(1);
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const saved = page.waitForEvent("download");
    await page.locator(".project-menu").click();
    await page.getByRole("menuitem", { name: /^Save project/ }).click();
    const portable = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await saved).path())!))),
    );
    expect(portable.settings).toMatchObject({
      layerHeight: 0.25,
      firstLayerHeight: 0.25,
      walls: DEFAULT_SETTINGS.walls,
      infill: 25,
      infillPattern: "grid",
      adaptive: false,
      manualLayers: false,
      adhesion: "none",
    });
    expect(portable.settings.lineWidth).toBeCloseTo(0.42);
    expect(portable.printer.startGcode).toBe(PRINTERS[0].startGcode);
    expect(portable.models).toHaveLength(1);
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Export G-code", exact: true }),
    ).toBeVisible({ timeout: 90000 });
    const output = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export G-code", exact: true })
      .click();
    const gcode = await readFile((await (await output).path())!, "utf8");
    expect(gcode).not.toContain("X999");
    const result = parseGcode(gcode);
    expect(result.layers).toHaveLength(24);
    expect(
      result.layers.every((l, i) => Math.abs(l.z - (i + 1) * 0.25) < 0.001),
    ).toBe(true);
    expect(result.layers.some((l) => [...l.features].includes(1))).toBe(true);
  });

test("models-only and cancelled reviews leave process settings intact", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.locator(".project-menu").click();
  await page
    .getByRole("menuitem", { name: "New project", exact: true })
    .click();
  const file = {
    name: "Review.3mf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(process3mf(processConfig)),
  };
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(file);
  await page
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Import 3MF settings" }),
  ).toHaveCount(0);
  await expect(page.locator(".object-row")).toHaveCount(0);
  await input.setInputFiles(file);
  await page.getByRole("button", { name: "Models only", exact: true }).click();
  await expect(page.locator(".object-row")).toHaveCount(1);
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const saved = page.waitForEvent("download");
  await page.locator(".project-menu").click();
  await page.getByRole("menuitem", { name: /^Save project/ }).click();
  const portable = JSON.parse(
    strFromU8(gunzipSync(await readFile((await (await saved).path())!))),
  );
  expect(portable.settings).toMatchObject(DEFAULT_SETTINGS);
});

test("consecutive same-name imports reset selection and each import is one undoable edit", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.locator(".project-menu").click();
  await page
    .getByRole("menuitem", { name: "New project", exact: true })
    .click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(
      [0.25, 0.3].map((height) => ({
        name: "Same name.3mf",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(process3mf({ layer_height: String(height) })),
      })),
    );
  await page.getByRole("button", { name: "Deselect all", exact: true }).click();
  await page.getByRole("button", { name: "Models only", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import 3MF settings" });
  await expect(
    dialog.getByRole("checkbox", { name: "Layer height", exact: true }),
  ).toBeChecked();
  await expect(dialog).toContainText("Import: 0.3 mm");
  await dialog
    .getByRole("button", { name: "Import selected settings", exact: true })
    .click();
  await expect(page.locator(".object-row")).toHaveCount(2);
  const save = async () => {
    const event = page.waitForEvent("download");
    await page.locator(".project-menu").click();
    await page.getByRole("menuitem", { name: /^Save project/ }).click();
    return JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await event).path())!))),
    );
  };
  expect((await save()).settings.layerHeight).toBe(0.3);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".object-row")).toHaveCount(1);
  expect((await save()).settings.layerHeight).toBe(
    DEFAULT_SETTINGS.layerHeight,
  );
});
