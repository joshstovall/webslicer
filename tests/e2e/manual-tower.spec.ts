import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { PRINTERS, DEFAULT_SETTINGS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
import { auditPurgeVolumes } from "../../src/lib/purge-audit";
import { parseGcode } from "../../src/lib/gcode";

const file = {
  name: "Manual towers.webslicer",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({
      version: 1,
      name: "Manual towers",
      plates: [1, 2],
      activePlate: 1,
      printer: PRINTERS.find((p) => p.id === "generic-multi"),
      settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
      filaments: [0, 1].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
      multiMaterial: {
        ...DEFAULT_MULTI_MATERIAL,
        purgeVolume: 20,
        towerPositions: { "2": { x: 100, y: 40, axis: "x" } },
      },
      models: [0, 1].map((tool) => {
        const m = primitive("cube", 1);
        return {
          ...m,
          tool,
          positions: [...m.positions],
          scale: [0.4, 0.4, tool ? 0.06 : 0.3],
          position: [tool ? 12 : -12, 0, 0],
        };
      }),
    }),
  ),
};
for (const width of [1440, 390])
  test(`manual tower placement persists per plate and exports exact coordinates at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.locator('input[type="file"]').first().setInputFiles(file);
    const open = async () => {
      if (width < 761)
        await page
          .getByRole("button", { name: "Print setup", exact: true })
          .click();
      await page
        .getByRole("button", { name: "Manage filaments", exact: true })
        .click();
    };
    const close = async () => {
      await page.keyboard.press("Escape");
      if (width < 761) await page.keyboard.press("Escape");
    };
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    await open();
    await page
      .getByRole("combobox", { name: "Tower placement", exact: true })
      .click();
    await page.getByRole("option", { name: "Manual", exact: true }).click();
    await field("Tower center X").fill("60");
    await field("Tower center Y").fill("50");
    await page
      .getByRole("combobox", { name: "Tower row direction", exact: true })
      .click();
    await page
      .getByRole("option", { name: "+Y · front to back", exact: true })
      .click();
    await close();
    await page.getByRole("button", { name: /^Plate 2/ }).click();
    await open();
    await expect(field("Tower center X")).toHaveValue("100 mm");
    await expect(field("Tower center Y")).toHaveValue("40 mm");
    await close();
    await page
      .getByRole("button", { name: "Remove plate 2", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add build plate", exact: true })
      .click();
    await open();
    await expect(
      page.getByRole("combobox", { name: "Tower placement", exact: true }),
    ).toHaveValue("Automatic");
    await close();
    await page.getByRole("button", { name: /^Plate 1/ }).click();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await open();
    await expect(field("Tower center X")).toHaveValue("60 mm");
    await expect(field("Tower center Y")).toHaveValue("50 mm");
    await expect(
      page.getByRole("combobox", { name: "Tower row direction", exact: true }),
    ).toHaveValue("+Y · front to back");
    await expect(page.locator(".mantine-Notification-root")).toHaveCount(0, {
      timeout: 15000,
    });
    await field("Tower center X").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/stratum-manual-tower-${width}.png` });
    await close();
    if (width === 1440) {
      const saved = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      const bytes = await readFile((await (await saved).path())!);
      const project = JSON.parse(new TextDecoder().decode(gunzipSync(bytes)));
      expect(project.multiMaterial.towerPositions).toEqual({
        "1": { x: 60, y: 50, axis: "y" },
      });
    }
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
    expect(
      auditPurgeVolumes(
        code,
        1.75,
        { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
        true,
      ).length,
    ).toBeGreaterThan(3);
    const result = parseGcode(code);
    const xs: number[] = [],
      ys: number[] = [],
      heights: number[] = [];
    for (const l of result.layers)
      for (let i = 0; i < l.features.length; i++)
        if (l.features[i] === 5) {
          heights.push(l.z);
          for (const end of [0, 3]) {
            xs.push(l.segments[i * 6 + end]);
            ys.push(l.segments[i * 6 + end + 1]);
          }
        }
    expect(xs.length).toBeGreaterThan(50);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(60, 2);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(50, 2);
    expect(Math.max(...heights)).toBeLessThan(2);
    expect(
      result.layers.some(
        (l) => l.z > 5.5 && l.features.some((f) => f !== 4 && f !== 5),
      ),
    ).toBe(true);
  });

test("manual tower collision fails clearly and the same plate can be corrected", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const job = JSON.parse(file.buffer.toString());
  job.multiMaterial.towerPositions[1] = { x: 116, y: 128, axis: "x" };
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ ...file, buffer: Buffer.from(JSON.stringify(job)) });
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(page.getByText(/Manual tower block 1 overlaps/)).toBeVisible({
    timeout: 60000,
  });
  await expect(
    page.locator('iframe[title="Local slicing engine"]'),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Manage filaments", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Tower center X", exact: true }),
  ).toHaveValue("116 mm");
  await page
    .getByRole("textbox", { name: "Tower center Y", exact: true })
    .fill("40");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export G-code", exact: true }),
  ).toBeVisible({ timeout: 60000 });
});
