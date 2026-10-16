import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
import { auditPurgeVolumes } from "../../src/lib/purge-audit";

const file = {
  name: "Independent budgets.webslicer",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({
      version: 1,
      name: "Independent budgets",
      plates: [1],
      activePlate: 1,
      printer: PRINTERS.find((p) => p.id === "generic-multi"),
      settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
      filaments: [0, 1].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
      multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
      models: [0, 1].map((tool) => {
        const m = primitive("cube", 1);
        return {
          ...m,
          tool,
          positions: [...m.positions],
          scale: [0.4, 0.4, 0.06],
          position: [tool ? 12 : -12, 0, 0],
        };
      }),
    }),
  ),
};
for (const width of [1440, 390])
  test(`independent station and exact tower budgets survive recovery and Bambu export at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.locator('input[type="file"]').first().setInputFiles(file);
    const setup = async () => {
      if (width < 761)
        await page
          .getByRole("button", { name: "Print setup", exact: true })
          .click();
    };
    await setup();
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page
      .getByRole("option", { name: "Bambu Lab P1S + AMS", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage filaments", exact: true })
      .click();
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    await expect(field("Station flushing volume per change")).toHaveValue(
      "20 mm³",
    );
    await field("Tower priming volume per change").fill("12");
    await page.keyboard.press("Tab");
    await expect(field("Station flushing volume per change")).toHaveValue(
      "20 mm³",
    );
    await field("Station flushing volume per change").fill("135");
    await page.keyboard.press("Tab");
    await page
      .getByRole("button", { name: "Directional purge volumes", exact: true })
      .click();
    await field("Purge for this change").fill("25");
    await page.keyboard.press("Tab");
    await field("Station flushing for this change").fill("240");
    await page.keyboard.press("Tab");
    await page
      .getByRole("combobox", { name: "Purge from filament", exact: true })
      .click();
    await page.getByRole("option", { name: "2. PLA 2", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Purge to filament", exact: true })
      .click();
    await page.getByRole("option", { name: "1. PLA 1", exact: true }).click();
    await field("Purge for this change").fill("8");
    await page.keyboard.press("Tab");
    await field("Station flushing for this change").fill("70");
    await page.keyboard.press("Tab");
    await expect(page.locator(".mantine-Notification-root")).toHaveCount(0, {
      timeout: 15000,
    });
    await page.screenshot({ path: `/tmp/stratum-purge-budgets-${width}.png` });
    await page.keyboard.press("Escape");
    if (width < 761) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await setup();
    await page
      .getByRole("button", { name: "Manage filaments", exact: true })
      .click();
    await expect(field("Tower priming volume per change")).toHaveValue(
      "12 mm³",
    );
    await expect(field("Station flushing volume per change")).toHaveValue(
      "135 mm³",
    );
    await page
      .getByRole("button", { name: "Directional purge volumes", exact: true })
      .click();
    await expect(field("Purge for this change")).toHaveValue("25 mm³");
    await expect(field("Station flushing for this change")).toHaveValue(
      "240 mm³",
    );
    await page.keyboard.press("Escape");
    if (width < 761) await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exporting = page.getByRole("button", {
      name: "Export print 3MF",
      exact: true,
    });
    await expect(exporting).toBeVisible({ timeout: 60000 });
    const pending = page.waitForEvent("download");
    await exporting.click();
    const bytes = await readFile((await (await pending).path())!);
    const zip = unzipSync(bytes);
    const code = new TextDecoder().decode(
      zip[Object.keys(zip).find((n) => n.endsWith(".gcode"))!],
    );
    const multi = {
      ...DEFAULT_MULTI_MATERIAL,
      purgeVolume: 12,
      purgeVolumes: { "0:1": 25, "1:0": 8 },
    };
    const changes = auditPurgeVolumes(code, 1.75, multi, true);
    expect(changes.length).toBeGreaterThan(3);
    expect(new Set(changes.map((c) => c.required))).toEqual(new Set([8, 25]));
    expect(
      changes.every(
        (c) => c.deposited >= c.required && c.deposited < c.required + 0.05,
      ),
    ).toBe(true);
    // Sum actual E commands only inside the official P1S FLUSH_START/END regions.
    // The pinned template adds a separate 2 mm spillage-compensation extrusion.
    const flushed: number[] = [];
    let incoming = -1,
      active = false,
      amount = 0,
      compensation = 0;
    for (const line of code.split("\n")) {
      const change = line.match(/^;STRATUM_TOOL_CHANGE:\d+:(\d+)/);
      if (change) {
        incoming = Number(change[1]);
        amount = 0;
        compensation = 0;
      }
      if (line.includes("; FLUSH_START") && incoming >= 0) active = true;
      if (line.includes("; FLUSH_END")) active = false;
      if (active && /^G1\s/.test(line)) {
        const e = Number(line.match(/\bE(-?[\d.]+)/)?.[1] ?? 0);
        amount += e;
        if (/Compensate for filament spillage/i.test(line)) compensation += e;
      }
      if (line === ";STRATUM_MACHINE_CHANGE_END" && incoming >= 0) {
        expect(compensation).toBe(2);
        const volume = (amount - compensation) * Math.PI * (1.75 / 2) ** 2;
        expect(volume).toBeCloseTo(incoming === 1 ? 240 : 70, 1);
        flushed.push(volume);
        incoming = -1;
      }
    }
    expect(flushed).toHaveLength(changes.length);
    expect(code).toContain(";TYPE:purge tower structure");
    if (width === 1440) {
      await page
        .getByRole("switch", { name: "Current layer only", exact: true })
        .check();
      await page.getByRole("button", { name: "Top view", exact: true }).click();
      await page.screenshot({ path: "/tmp/stratum-metered-tower-layer.png" });
    }
  });
