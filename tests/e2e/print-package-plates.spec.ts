import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { multiPlateFiles } from "../fixtures/multi-plate";

for (const width of [1440, 390])
  test(`multi-plate archives select matching materials and retain the original download at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const files: Record<string, Uint8Array> = multiPlateFiles();
    files["Metadata/plate_4.gcode"] = strToU8("G90\nM83\n");
    const bytes = Buffer.from(zipSync(files));
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "multi.gcode.3mf",
      mimeType: "application/octet-stream",
      buffer: bytes,
    });
    const plate = page.getByRole("combobox", {
      name: "Archive plate",
      exact: true,
    });
    await expect(plate).toHaveValue("2. Base");
    await expect(page.locator(".preview-card-heading")).toContainText(
      "Bambu Lab P1S",
    );
    await page
      .getByRole("combobox", { name: "Preview color scheme", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Color by filament", exact: true })
      .click();
    await expect(page.locator(".filament-usage-row")).toHaveCount(1);
    await expect(page.locator(".filament-usage-row")).toContainText(
      "1. Original PLA",
    );
    await expect(page.locator(".filament-usage-row > span")).toHaveCSS(
      "background-color",
      "rgb(204, 51, 34)",
    );
    await plate.click();
    await expect(
      page.getByRole("option", {
        name: "3. Plate 3 · Empty G-code",
        exact: true,
      }),
    ).toHaveAttribute("data-combobox-disabled", "true");
    await page
      .getByRole("option", { name: "10. Cap & clip", exact: true })
      .click();
    await expect(plate).toHaveValue("10. Cap & clip");
    await expect(page.locator(".plate-label strong")).toHaveText("Cap & clip");
    await expect(page.locator(".plate-number")).toHaveText("10");
    await expect(page.locator(".preview-card-heading")).toContainText(
      "Bambu Lab A1 mini",
    );
    await expect(page.locator(".filament-usage-row")).toHaveCount(1);
    await expect(page.locator(".filament-usage-row")).toContainText(
      "3. PETG 3",
    );
    await expect(page.locator(".filament-usage-row > span")).toHaveCSS(
      "background-color",
      "rgb(34, 51, 170)",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/stratum-archive-${width}.png` });
    // A failed selection keeps the last valid preview and can be followed by another selection.
    await plate.click();
    await page.getByRole("option", { name: "4. Plate 4", exact: true }).click();
    await expect(
      page.getByText("No extrusion paths found on this plate.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(plate).toHaveValue("10. Cap & clip");
    await expect(page.locator(".plate-label strong")).toHaveText("Cap & clip");
    await expect(page.locator(".plate-number")).toHaveText("10");
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download original", exact: true })
      .click();
    expect(await readFile((await (await pending).path())!)).toEqual(bytes);
    await plate.click();
    await page.getByRole("option", { name: "2. Base", exact: true }).click();
    await expect(plate).toHaveValue("2. Base");
    await expect(page.locator(".filament-usage-row")).toContainText(
      "1. Original PLA",
    );
  });

test("a selected plate's checksum warning is visible without discarding the original file", async ({
  page,
}) => {
  await page.goto("./");
  const files = multiPlateFiles();
  files["Metadata/plate_2.gcode.md5"] = strToU8("0".repeat(32));
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "checksum.gcode.3mf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(zipSync(files)),
    });
  await expect(
    page.getByText(/G-code checksum does not match the archive/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download original", exact: true }),
  ).toBeVisible();
});

test("leaving preview cancels a pending archive plate selection", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "pending.gcode.3mf",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(zipSync(multiPlateFiles())),
    });
  const selector = page.getByRole("combobox", {
    name: "Archive plate",
    exact: true,
  });
  await expect(selector).toHaveValue("2. Base");
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === "pending.gcode.3mf")
        await new Promise<void>((resolve) => {
          (window as any).releaseArchiveRead = resolve;
        });
      return original.call(this);
    };
  });
  await selector.click();
  await page
    .getByRole("option", { name: "10. Cap & clip", exact: true })
    .click();
  await expect(selector).toBeDisabled();
  const prepare = page.getByRole("button", { name: "Prepare 1", exact: true });
  await prepare.click();
  await page.evaluate(async () => {
    (window as any).releaseArchiveRead();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  await expect(prepare).toHaveClass("active");
  await expect(page.locator(".preview-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Preview 2", exact: true }).click();
  await expect(selector).toHaveValue("2. Base");
});
