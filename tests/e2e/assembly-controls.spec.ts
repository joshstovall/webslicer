import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
import { parseGcode } from "../../src/lib/gcode";

async function savedProject(page: Page) {
  await page.locator(".project-menu").click();
  const pending = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^Save project/ }).click();
  const file = await pending;
  return JSON.parse(
    strFromU8(gunzipSync(await readFile((await file.path())!))),
  );
}
async function menuAction(page: Page, name: string) {
  await page.locator(".project-menu").click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
for (const width of [1440, 390])
  test(`assembly membership and overlap priority change real exports at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const models = [-1, 1].map((x, i) => ({
      ...primitive("cube", 1),
      name: i ? "Blue part" : "Red part",
      tool: i,
      position: [x, 0, 0],
      scale: [0.2, 0.2, 0.1],
    }));
    const project = {
      version: 1,
      name: "Assembly workflow",
      models: models.map((m) => ({ ...m, positions: [...m.positions] })),
      printer: PRINTERS.find((p) => p.id === "generic-multi"),
      settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
      filaments: [0, 1].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
      multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
      plates: [1],
      activePlate: 1,
    };
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "assembly.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(project)),
      });
    const objects = async () => {
      if (width < 761)
        await page
          .getByRole("button", { name: "Objects 2", exact: true })
          .click();
    };
    const closeObjects = async () => {
      if (width < 761) await page.keyboard.press("Escape");
    };
    await objects();
    await page
      .getByRole("button", { name: "Manage assembly", exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: "Include Blue part in assembly",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Link selected parts", exact: true })
      .click();
    await expect(
      page.getByRole("switch", { name: /^Transform assembly/ }),
    ).toBeChecked();
    await closeObjects();
    const linked = await savedProject(page);
    expect(linked.models[0].assemblyId).toBeTruthy();
    expect(linked.models[0].assemblyId).toBe(linked.models[1].assemblyId);
    await menuAction(page, "Undo");
    expect(
      (await savedProject(page)).models.every((m: any) => !m.assemblyId),
    ).toBe(true);
    await menuAction(page, "Redo");
    await objects();
    await page
      .getByRole("button", { name: "Manage assembly", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Increase priority of Red part",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Increase priority of Red part",
        exact: true,
      }),
    ).toBeDisabled();
    await page.screenshot({ path: `/tmp/stratum-assembly-${width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await closeObjects();
    const prioritized = await savedProject(page);
    expect(prioritized.models.map((m: any) => m.name)).toEqual([
      "Blue part",
      "Red part",
    ]);
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    if (width >= 761) {
      await page.getByRole("button", { name: "Top view", exact: true }).click();
      const canvas = page.getByTestId("viewport").locator("canvas");
      const box = (await canvas.boundingBox())!;
      await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
      await objects();
      await expect(
        page.getByRole("textbox", { name: "Object name", exact: true }),
      ).toHaveValue("Red part");
      await closeObjects();
    }
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exportButton = page.getByRole("button", {
      name: "Export G-code",
      exact: true,
    });
    await expect(exportButton).toBeVisible({ timeout: 60000 });
    const download = page.waitForEvent("download");
    await exportButton.click();
    const result = parseGcode(
      await readFile((await (await download).path())!, "utf8"),
    );
    const xs = [[], []] as number[][];
    for (const layer of result.layers)
      for (let i = 0; i < layer.features.length; i++) {
        if (layer.features[i] === 4 || layer.features[i] === 5) continue;
        xs[layer.tools[i]].push(
          layer.segments[i * 6] - 128,
          layer.segments[i * 6 + 3] - 128,
        );
      }
    expect(result.tools.map((t) => t.tool)).toEqual([0, 1]);
    // Red's higher priority owns the overlap through X=1; blue starts to its right.
    expect(Math.max(...xs[0])).toBeGreaterThan(0.5);
    expect(Math.max(...xs[0])).toBeLessThanOrEqual(1.01);
    expect(Math.min(...xs[1])).toBeGreaterThanOrEqual(0.99);
    await page.getByRole("button", { name: /^Prepare/ }).click();
    await objects();
    await page
      .getByRole("button", { name: "Manage assembly", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Separate all parts", exact: true })
      .click();
    await expect(
      page.getByRole("switch", { name: /^Transform assembly/ }),
    ).toHaveCount(0);
    await closeObjects();
    const separated = await savedProject(page);
    expect(separated.models.every((m: any) => !m.assemblyId)).toBe(true);
    expect(
      separated.models.map((m: any) => [m.positions, m.position, m.tool]),
    ).toEqual(
      prioritized.models.map((m: any) => [m.positions, m.position, m.tool]),
    );
  });
