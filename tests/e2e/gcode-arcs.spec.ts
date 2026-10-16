import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";

const arcJob = `; printer_model = Snapmaker U1
; filament_colour = #ffffff;#cc3344;#00aa44;#3366cc
; filament_settings_id = White;Coral;Green;Blue
G90
M83
G92 X175 Y135 Z0.2 E0
; CHANGE_LAYER
; FEATURE: Outer wall
T1
G3 X95 Y135 I-40 E20 F1200
T3
G3 X175 Y135 I40 E40
; CHANGE_LAYER
G1 Z0.4
T1
G2 X95 Y135 R40 E20
T3
G2 X175 Y135 R40 E40
`;

for (const width of [1440, 390]) {
  test(`multicolor arc-only G-code and archive plates preview and download at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({
      name: "curves.gcode",
      mimeType: "text/plain",
      buffer: Buffer.from(arcJob),
    });
    await expect(page.locator(".preview-card-heading")).toContainText(
      "2 layers · Snapmaker U1",
    );
    await page
      .getByRole("combobox", { name: "Preview color scheme", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Color by filament", exact: true })
      .click();
    await expect(page.locator(".filament-usage-row")).toHaveCount(2);
    await expect(page.locator(".filament-usage-row").nth(0)).toContainText(
      "2. Coral · 0.12 g",
    );
    await expect(page.locator(".filament-usage-row").nth(1)).toContainText(
      "4. Blue · 0.24 g",
    );
    await expect(page.locator(".filament-usage-row > span").nth(0)).toHaveCSS(
      "background-color",
      "rgb(204, 51, 68)",
    );
    await expect(page.locator(".filament-usage-row > span").nth(1)).toHaveCSS(
      "background-color",
      "rgb(51, 102, 204)",
    );
    await expect(
      page.getByText("Arc moves are not displayed", { exact: false }),
    ).toHaveCount(0);
    const rawDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download original", exact: true })
      .click();
    expect(await readFile((await (await rawDownload).path())!)).toEqual(
      Buffer.from(arcJob),
    );
    await expect(page.locator(".mantine-Notification-root")).toHaveCount(0, {
      timeout: 15000,
    });
    await page.screenshot({ path: `/tmp/stratum-arcs-${width}.png` });

    const archive = Buffer.from(
      zipSync({
        "Metadata/plate_1.gcode": strToU8(arcJob),
        "Metadata/plate_2.gcode": strToU8(
          arcJob
            .replace("Snapmaker U1", "Bambu Lab P1S")
            .replaceAll("; CHANGE_LAYER", ";LAYER_CHANGE"),
        ),
      }),
    );
    await input.setInputFiles({
      name: "curves.gcode.3mf",
      mimeType: "application/octet-stream",
      buffer: archive,
    });
    const plate = page.getByRole("combobox", {
      name: "Archive plate",
      exact: true,
    });
    await expect(plate).toHaveValue("1. Plate 1");
    await expect(page.locator(".preview-card-heading")).toContainText(
      "2 layers · Snapmaker U1",
    );
    await plate.click();
    await page.getByRole("option", { name: "2. Plate 2", exact: true }).click();
    await expect(page.locator(".preview-card-heading")).toContainText(
      "2 layers · Bambu Lab P1S",
    );
    await expect(page.locator(".filament-usage-row")).toHaveCount(2);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download original", exact: true })
      .click();
    expect(await readFile((await (await download).path())!)).toEqual(archive);
  });
}
