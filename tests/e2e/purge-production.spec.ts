import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { primitive } from "../../src/lib/geometry";
import { PRINTERS, DEFAULT_SETTINGS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
import { auditPurgeVolumes } from "../../src/lib/purge-audit";
import { parseGcode } from "../../src/lib/gcode";

const multi = { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 };
const projectFile = (full = false) => ({
  name: "Purge placement.webslicer",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({
      version: 1,
      name: "Edge colors",
      plates: [1],
      activePlate: 1,
      printer: {
        ...PRINTERS.find((p) => p.id === "generic-multi"),
        bed: [64, 64, 64],
      },
      settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
      filaments: [0, 1, 2].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
      multiMaterial: multi,
      models: [0, 2].map((tool, i) => {
        const m = primitive("cube", 1);
        return {
          ...m,
          positions: [...m.positions],
          tool,
          name: `Part ${i + 1}`,
          scale: full ? [1.4, 3, 0.05] : [0.4, 0.4, 0.06],
          position: full ? [i ? 15 : -15, 0, 0] : [24, i ? 10 : -10, 0],
        };
      }),
    }),
  ),
});
for (const width of [1440, 390])
  test(`automatic tower placement exports on a ${width}px screen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(projectFile());
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exporting = page.getByRole("button", {
      name: "Export G-code",
      exact: true,
    });
    await expect(exporting).toBeVisible({ timeout: 60000 });
    const download = page.waitForEvent("download");
    await exporting.click();
    const gcode = await readFile((await (await download).path())!, "utf8");
    const volumes = auditPurgeVolumes(gcode, 1.75, multi);
    expect(volumes.length).toBeGreaterThan(3);
    expect(volumes.every((c) => c.deposited >= 20)).toBe(true);
    const result = parseGcode(gcode);
    const tower: number[] = [];
    for (const l of result.layers)
      for (let i = 0; i < l.features.length; i++) {
        if (l.features[i] !== 5) continue;
        for (const endpoint of [0, 3]) {
          const x = l.segments[i * 6 + endpoint],
            y = l.segments[i * 6 + endpoint + 1];
          expect(x).toBeGreaterThan(0.2);
          expect(x).toBeLessThan(63.8);
          expect(y).toBeGreaterThan(0.2);
          expect(y).toBeLessThan(63.8);
          // Both source models occupy x=52..60; the tower is separate from them.
          expect(x).toBeLessThan(50);
          tower.push(x);
        }
      }
    expect(tower.length).toBeGreaterThan(50);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/stratum-purge-${width}.png` });
    if (width === 390) {
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles(projectFile(true));
      await page
        .getByRole("button", { name: "Slice plate", exact: true })
        .click();
      await expect(page.getByText(/No room for 1 purge block/)).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.locator('iframe[title="Local slicing engine"]'),
      ).toHaveCount(0);
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles(projectFile());
      await page
        .getByRole("button", { name: "Slice plate", exact: true })
        .click();
      await expect(exporting).toBeVisible({ timeout: 60000 });
    }
  });

test("an older Bambu project shows its reserved corner and arrangement clears the warning", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const saved = JSON.parse(projectFile().buffer.toString());
  saved.printer = {
    ...PRINTERS.find((p) => p.id === "bambu-p1s"),
    startGcode: "G90",
    endGcode: "M400",
    toolChangeGcode: "T{tool}",
  };
  saved.models = [saved.models[0]];
  saved.models[0].position = [-120, -120, 0];
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "Older Bambu project.webslicer",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(page.locator(".workspace-alert")).toContainText(
    "reserved bed area",
  );
  await expect(
    page.locator('iframe[title="Local slicing engine"]'),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /Arrange/ })
    .first()
    .click();
  await expect(page.locator(".workspace-alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Slice plate", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "/tmp/stratum-bambu-prepare.png" });
});
