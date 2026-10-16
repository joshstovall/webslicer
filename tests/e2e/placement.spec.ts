import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { nestedProject } from "../fixtures/placement";
import { boundsOf } from "../../src/lib/geometry";
import { parseGcode } from "../../src/lib/gcode";
async function save(page: Page) {
  const pending = page.waitForEvent("download");
  await page.locator(".project-menu").click();
  await page.getByRole("menuitem", { name: /^Save project/ }).click();
  const result = JSON.parse(
    strFromU8(gunzipSync(await readFile((await (await pending).path())!))),
  );
  await expect(page.getByRole("menu")).toBeHidden();
  return result;
}
async function load(page: Page) {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "Placement.webslicer",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(nestedProject())),
    });
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
}
test.use({ hasTouch: true });
for (const width of [1440, 1024, 390])
  test(`shape-aware nesting, collision checks, undo, recovery and G-code at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await load(page);
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    await expect(page.locator(".workspace-alert")).toContainText(
      "Frame and Insert overlap",
    );
    await expect(
      page.locator('iframe[title="Local slicing engine"]'),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Arrange plate", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Arrange plate",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Part spacing" }).fill("2");
    await dialog.getByRole("textbox", { name: "Bed edge clearance" }).fill("2");
    await dialog.getByRole("switch", { name: "Allow 90° rotations" }).uncheck();
    const start = dialog.getByRole("button", {
      name: "Arrange objects",
      exact: true,
    });
    const box = await start.boundingBox();
    expect(box!.y + box!.height).toBeLessThan(width === 390 ? 844 : 1000);
    await page.screenshot({
      path: `/tmp/stratum-placement-${width}.png`,
      animations: "disabled",
    });
    await start.click();
    await expect(dialog).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator(".workspace-alert")).toHaveCount(0);
    const arranged = await save(page);
    const [frame, insert] = arranged.models.map((m: any) =>
      boundsOf({ ...m, positions: Float32Array.from(m.positions) }),
    );
    expect(frame.intersectsBox(insert)).toBe(true);
    for (const axis of ["x", "y"] as const) {
      expect(insert.min[axis] - frame.min[axis]).toBeGreaterThanOrEqual(
        7 - 1e-4,
      );
      expect(insert.max[axis] - frame.min[axis]).toBeLessThanOrEqual(53 + 1e-4);
    }
    await page.locator(".project-menu").click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    const undone = await save(page);
    expect(undone.models.map((m: any) => m.position)).toEqual(
      nestedProject().models.map((m) => m.position),
    );
    await page.locator(".project-menu").click();
    await page.getByRole("menuitem", { name: "Redo", exact: true }).click();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    expect((await save(page)).models.map((m: any) => m.position)).toEqual(
      arranged.models.map((m: any) => m.position),
    );
    await page.screenshot({
      path: `/tmp/stratum-placement-result-${width}.png`,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exportButton = page.getByRole("button", {
      name: "Export G-code",
      exact: true,
    });
    await expect(exportButton).toBeVisible({ timeout: 90000 });
    const pending = page.waitForEvent("download");
    await exportButton.click();
    const result = parseGcode(
      await readFile((await (await pending).path())!, "utf8"),
    );
    expect(result.layers.length).toBeGreaterThan(20);
    let inFrame = 0,
      inInsert = 0,
      outsideMaterial = 0;
    for (const layer of result.layers)
      for (let i = 0; i < layer.features.length; i++) {
        if ([4, 5].includes(layer.features[i])) continue;
        const x = (layer.segments[i * 6] + layer.segments[i * 6 + 3]) / 2 - 40,
          y = (layer.segments[i * 6 + 1] + layer.segments[i * 6 + 4]) / 2 - 40;
        if (
          x >= insert.min.x - 0.01 &&
          x <= insert.max.x + 0.01 &&
          y >= insert.min.y - 0.01 &&
          y <= insert.max.y + 0.01
        )
          inInsert++;
        else {
          const insideBounds =
            x >= frame.min.x - 0.01 &&
            x <= frame.max.x + 0.01 &&
            y >= frame.min.y - 0.01 &&
            y <= frame.max.y + 0.01;
          const insideOpening =
            x > frame.min.x + 5.01 &&
            x < frame.max.x - 5.01 &&
            y > frame.min.y + 5.01 &&
            y < frame.max.y - 5.01;
          if (!insideBounds || insideOpening) outsideMaterial++;
          inFrame++;
        }
      }
    expect(outsideMaterial).toBe(0);
    expect(inFrame).toBeGreaterThan(0);
    expect(inInsert).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

test("cancelled arrangement retains original geometry and can be retried", async ({
  page,
}) => {
  await load(page);
  const before = await save(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/placement-worker/, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: "Arrange plate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Arrange objects", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel arrangement", exact: true })
    .click();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("dialog", { name: "Arrange plate", exact: true }),
  ).toHaveCount(0);
  expect((await save(page)).models).toEqual(before.models);
  await page
    .getByRole("button", { name: "Arrange plate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Arrange objects", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Arrange plate", exact: true }),
  ).toHaveCount(0, { timeout: 30000 });
  expect((await save(page)).models.map((m: any) => m.position)).not.toEqual(
    before.models.map((m: any) => m.position),
  );
});
