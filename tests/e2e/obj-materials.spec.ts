import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { coloredObj, materialLibrary } from "../fixtures/colored-obj";
import { parseGcode } from "../../src/lib/gcode";

for (const width of [1440, 390])
  test(`OBJ plus MTL imports surface colors through recovery and real slicing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.locator(".project-menu").click();
    await page
      .getByRole("menuitem", { name: "New project", exact: true })
      .click();
    if (width < 761)
      await page
        .getByRole("button", { name: "Print setup", exact: true })
        .click();
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page
      .getByRole("option", { name: "Custom multi-extruder FDM", exact: true })
      .click();
    if (width < 761) await page.keyboard.press("Escape");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles([
        {
          name: "colors palette.mtl",
          mimeType: "text/plain",
          buffer: Buffer.from(materialLibrary),
        },
        {
          name: "colored.obj",
          mimeType: "text/plain",
          buffer: Buffer.from(coloredObj(true)),
        },
      ]);
    await expect(
      page.getByRole("button", { name: "Slice plate", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.locator(".project-menu").click();
    const saving = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /^Save project/ }).click();
    const saved = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await saving).path())!))),
    );
    expect(saved.models).toHaveLength(1);
    expect(saved.filaments.map((f: any) => f.color)).toEqual([
      "#91ad87",
      "#ff0000",
      "#ffffff",
    ]);
    expect([...new Set(saved.models[0].faceTools)].sort()).toEqual([1, 2]);
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exportButton = page.getByRole("button", {
      name: "Export G-code",
      exact: true,
    });
    await expect(exportButton).toBeVisible({ timeout: 60000 });
    const pending = page.waitForEvent("download");
    await exportButton.click();
    const result = parseGcode(
      await readFile((await (await pending).path())!, "utf8"),
    );
    expect(result.tools.map((t) => t.tool)).toEqual([1, 2]);
    const low = new Set<number>(),
      high = new Set<number>();
    for (const layer of result.layers)
      for (let i = 0; i < layer.features.length; i++) {
        if (layer.features[i] === 4 || layer.features[i] === 5) continue;
        const x = layer.segments[i * 6] - 128,
          y = layer.segments[i * 6 + 1] - 128;
        if (Math.abs(x) > 3.1 || Math.abs(y) > 3.1) continue;
        if (layer.z < 5.1) low.add(layer.tools[i]);
        if (layer.z > 5.5) high.add(layer.tools[i]);
      }
    expect([...low]).toEqual([1]);
    expect([...high]).toEqual([2]);
    await page
      .getByRole("combobox", { name: "Preview color scheme", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Color by filament", exact: true })
      .click();
    await expect(
      page.locator(".filament-usage-row").filter({ hasText: "Snow" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/stratum-obj-${width}.png` });
  });
