import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { purgeFrameProject } from "../fixtures/purge-outlines";
import { auditPurgeVolumes } from "../../src/lib/purge-audit";
import { parseGcode } from "../../src/lib/gcode";
for (const [width, mode] of [
  [1440, "automatic"],
  [1024, "manual"],
  [390, "automatic"],
  [390, "manual"],
] as const)
  test(`tower fits inside the frame opening: ${mode}, ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const project = purgeFrameProject(mode);
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Frame.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(project)),
      });
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
    const gcode = await readFile((await (await pending).path())!, "utf8");
    const changes = auditPurgeVolumes(gcode, 1.75, project.multiMaterial);
    expect(changes.length).toBeGreaterThan(0);
    expect(
      changes.every(
        (c) => c.deposited >= c.required && c.deposited < c.required + 0.05,
      ),
    ).toBe(true);
    const tower: number[][] = [];
    for (const layer of parseGcode(gcode).layers)
      for (let i = 0; i < layer.features.length; i++)
        if (layer.features[i] === 5)
          for (const e of [0, 3])
            tower.push([
              layer.segments[i * 6 + e],
              layer.segments[i * 6 + e + 1],
            ]);
    expect(tower.length).toBeGreaterThan(20);
    // The real model's opening is machine XY 7..57. Extrusion must clear its walls.
    for (const p of tower)
      for (const coord of p) {
        expect(coord).toBeGreaterThan(9);
        expect(coord).toBeLessThan(55);
      }
    if (mode === "manual")
      for (const axis of [0, 1])
        expect(
          (Math.min(...tower.map((p) => p[axis])) +
            Math.max(...tower.map((p) => p[axis]))) /
            2,
        ).toBeCloseTo(32, 2);
    await expect(
      page.locator('iframe[title="Local slicing engine"]'),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/stratum-purge-outline-${width}-${mode}.png`,
    });
  });
for (const mode of ["brim", "raft", "roof"])
  test(`manual tower rejects an opening occupied by ${mode}`, async ({
    page,
  }) => {
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Blocked frame.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(purgeFrameProject(mode))),
      });
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    await expect(page.getByText(/Manual tower block 1 overlaps/)).toBeVisible({
      timeout: 60000,
    });
    await expect(
      page.getByRole("button", { name: "Export G-code", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('iframe[title="Local slicing engine"]'),
    ).toHaveCount(0);
  });
