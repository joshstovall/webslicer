import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { primitive } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
const fixture = (multi = true) => ({
  name: "Cooling.webslicer",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({
      version: 1,
      name: "Cooling",
      plates: [1],
      activePlate: 1,
      printer:
        PRINTERS.find((p) => p.id === (multi ? "generic-multi" : "generic")) ??
        PRINTERS[0],
      settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
      filaments: Array.from({ length: multi ? 2 : 1 }, (_, i) => ({
        ...defaultFilament(DEFAULT_SETTINGS, i),
        maxFlow: 1,
        flow: i ? 0.9 : 1,
      })),
      multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
      models: Array.from({ length: multi ? 2 : 1 }, (_, tool) => {
        const m = primitive("cube", 1);
        return {
          ...m,
          name: `Part ${tool + 1}`,
          positions: [...m.positions],
          tool,
          scale: [0.3, 0.3, 0.06],
          position: [tool ? 12 : -12, 0, 0],
        };
      }),
    }),
  ),
});
function verifyFlow(gcode: string) {
  let x = 0,
    y = 0,
    z = 0,
    feed = 0,
    relative = false,
    printing = false,
    changing = false,
    count = 0;
  for (const line of gcode.split("\n")) {
    if (line === ";STRATUM_PRINT_BEGIN") printing = true;
    if (line === ";STRATUM_PRINT_END") printing = false;
    if (line.startsWith(";STRATUM_TOOL_CHANGE:")) changing = true;
    if (line === ";STRATUM_TOOL_READY") changing = false;
    const code = line.split(";")[0].trim();
    if (code === "M83") relative = true;
    if (code === "M82") relative = false;
    const a: Record<string, number> = {};
    for (const m of code.matchAll(/\b([XYZEF])(-?[\d.]+)/g))
      a[m[1]] = Number(m[2]);
    if (/^G92\b/.test(code)) {
      x = a.X ?? x;
      y = a.Y ?? y;
      z = a.Z ?? z;
    }
    if (!/^G[01]\b/.test(code)) continue;
    const nx = a.X ?? x,
      ny = a.Y ?? y,
      nz = a.Z ?? z;
    feed = a.F ?? feed;
    const length = Math.hypot(nx - x, ny - y, nz - z);
    if (printing && !changing && a.E > 0 && length > 1e-6) {
      expect(relative).toBe(true);
      expect(
        (a.E * Math.PI * (1.75 / 2) ** 2 * feed) / 60 / length,
      ).toBeLessThanOrEqual(1.00001);
      count++;
    }
    x = nx;
    y = ny;
    z = nz;
  }
  expect(count).toBeGreaterThan(30);
}
for (const width of [1440, 390])
  test(`per-filament cooling survives recovery and controls actual export at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.locator('input[type="file"]').first().setInputFiles(fixture());
    if (width < 761)
      await page
        .getByRole("button", { name: "Print setup", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Manage filaments", exact: true })
      .click();
    const set = async (name: string, value: string) => {
      await page.getByRole("textbox", { name, exact: true }).fill(value);
      await page.keyboard.press("Tab");
    };
    await set("Filament 1 cooling fan", "25");
    await set("Filament 1 fan starts at layer", "3");
    await page.getByRole("button", { name: "2. PLA 2", exact: true }).click();
    await set("Filament 2 cooling fan", "80");
    await set("Filament 2 fan starts at layer", "1");
    await page.screenshot({ path: `/tmp/stratum-materials-${width}.png` });
    await page.keyboard.press("Escape");
    if (width < 761) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    if (width < 761)
      await page
        .getByRole("button", { name: "Print setup", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Manage filaments", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", {
        name: "Filament 1 cooling fan",
        exact: true,
      }),
    ).toHaveValue("25 %");
    await expect(
      page.getByRole("textbox", {
        name: "Filament 1 fan starts at layer",
        exact: true,
      }),
    ).toHaveValue("3");
    await page.keyboard.press("Escape");
    if (width < 761) await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exporting = page.getByRole("button", {
      name: "Export G-code",
      exact: true,
    });
    await expect(exporting).toBeVisible({ timeout: 60000 });
    const pending = page.waitForEvent("download");
    await exporting.click();
    const code = await readFile((await (await pending).path())!, "utf8");
    verifyFlow(code);
    let tool = 0,
      layer = 0,
      fan = -1,
      printing = false,
      changes = false,
      checked = 0;
    for (const line of code.split("\n")) {
      if (line === ";STRATUM_PRINT_BEGIN") printing = true;
      if (line === ";STRATUM_PRINT_END") printing = false;
      const initial = line.match(/^;STRATUM_INITIAL_TOOL:(\d+)/);
      if (initial) tool = Number(initial[1]);
      const change = line.match(/^;STRATUM_TOOL_CHANGE:\d+:(\d+)/);
      if (change) {
        tool = Number(change[1]);
        changes = true;
      }
      if (line === ";STRATUM_TOOL_READY") changes = false;
      if (line.startsWith(";LAYER:")) layer++;
      const f = line.match(/^M106 S(\d+)/);
      if (f) fan = Number(f[1]);
      if (
        printing &&
        !changes &&
        /^G1 .*\b[XY]/.test(line) &&
        /\bE0\.[1-9]/.test(line)
      ) {
        expect(fan).toBe(tool === 1 ? 204 : layer >= 3 ? 64 : 0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
test("single-spool preset import updates its cooling and actual flow-limited G-code", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fixture(false));
  await page
    .getByRole("button", { name: "Manage print presets", exact: true })
    .click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({
    name: "my-preset.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        settings: {
          ...DEFAULT_SETTINGS,
          fan: 35,
          fanLayer: 3,
          maxFlow: 1,
          adhesion: "none",
        },
      }),
    ),
  });
  await expect(page.getByText("Preset applied.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Manage filaments", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Filament 1 cooling fan", exact: true }),
  ).toHaveValue("35 %");
  await expect(
    page.getByRole("textbox", {
      name: "Filament 1 fan starts at layer",
      exact: true,
    }),
  ).toHaveValue("3");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  const exporting = page.getByRole("button", {
    name: "Export G-code",
    exact: true,
  });
  await expect(exporting).toBeVisible({ timeout: 60000 });
  const pending = page.waitForEvent("download");
  await exporting.click();
  const code = await readFile((await (await pending).path())!, "utf8");
  expect(code).toContain("M106 S89");
  verifyFlow(code);
});
