import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { orientationProject } from "../fixtures/orientation";
import { boundsOf } from "../../src/lib/geometry";
import { parseGcode } from "../../src/lib/gcode";
async function load(page: Page, project: any = orientationProject()) {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "Orient.webslicer",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await expect(page.locator(".object-row")).toHaveCount(project.models.length);
}
async function save(page: Page) {
  const pending = page.waitForEvent("download");
  await page.locator(".project-menu").click();
  await page.getByRole("menuitem", { name: /^Save project/ }).click();
  const p = JSON.parse(
    strFromU8(gunzipSync(await readFile((await (await pending).path())!))),
  );
  await expect(page.getByRole("menu")).toBeHidden();
  return p;
}
async function open(page: Page) {
  const objects = page.getByRole("button", { name: /^Objects \d+$/ });
  if (await objects.isVisible()) await objects.click();
  await page.locator(".object-row:visible").first().click();
  await page
    .getByRole("button", { name: "More model tools", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Find printing orientation", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Find printing orientation",
    exact: true,
  });
}
async function exported(page: Page) {
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  const output = page.getByRole("button", {
    name: "Export G-code",
    exact: true,
  });
  await expect(output).toBeVisible({ timeout: 90000 });
  const pending = page.waitForEvent("download");
  await output.click();
  return parseGcode(await readFile((await (await pending).path())!, "utf8"));
}
test.use({ hasTouch: true });
for (const width of [1440, 1024, 390])
  test(`review printing angles, preserve assembly annotations and reduce real supports at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await load(page);
    const before = await save(page);
    const original = await exported(page);
    expect(original.layers.some((l) => [...l.features].includes(3))).toBe(true);
    await page.getByRole("button", { name: "Prepare 1", exact: true }).click();
    const dialog = await open(page);
    await dialog
      .getByRole("button", { name: "Find angles", exact: true })
      .click();
    const apply = dialog.getByRole("button", {
      name: "Apply and arrange",
      exact: true,
    });
    await expect(apply).toBeVisible({ timeout: 30000 });
    const box = await apply.boundingBox();
    expect(box!.y + box!.height).toBeLessThan(width === 390 ? 844 : 1000);
    await expect(dialog.getByLabel("Orientation estimates")).toContainText(
      "0 cm³",
    );
    await page.screenshot({
      path: `/tmp/stratum-orientation-${width}.png`,
      animations: "disabled",
    });
    await apply.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Place oriented models" }),
    ).toHaveCount(0, { timeout: 30000 });
    const after = await save(page);
    for (let i = 0; i < before.models.length; i++)
      for (const field of [
        "id",
        "positions",
        "faceTools",
        "paintTriangles",
        "supportPaint",
        "assemblyId",
        "scale",
      ])
        expect(after.models[i][field]).toEqual(before.models[i][field]);
    expect(after.models[0].rotation).not.toEqual(before.models[0].rotation);
    const bounds = after.models.map((m: any) =>
      boundsOf({ ...m, positions: Float32Array.from(m.positions) }),
    );
    expect(Math.min(...bounds.map((b: any) => b.min.z))).toBeCloseTo(0, 4);
    await page.locator(".project-menu").click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    expect(await save(page)).toEqual(before);
    await page.locator(".project-menu").click();
    await page.getByRole("menuitem", { name: "Redo", exact: true }).click();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    expect((await save(page)).models).toEqual(after.models);
    const result = await exported(page);
    expect(result.layers.length).toBeGreaterThan(20);
    expect(result.layers.some((l) => [...l.features].includes(3))).toBe(false);
  });
test("cancel during orientation search, review and post-rotation placement retains the original project", async ({
  page,
}) => {
  await load(page);
  const before = await save(page);
  for (const pattern of [/orientation-worker/, /placement-worker/]) {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let blocked = false;
    await page.context().route(pattern, async (route) => {
      blocked = true;
      await held;
      await route.continue().catch(() => {});
    });
    const dialog = await open(page);
    await dialog
      .getByRole("button", { name: "Find angles", exact: true })
      .click();
    if (pattern.source.includes("placement"))
      await dialog
        .getByRole("button", { name: "Apply and arrange", exact: true })
        .click();
    await expect.poll(() => blocked).toBe(true);
    await page
      .getByRole("button", {
        name: pattern.source.includes("placement")
          ? "Cancel operation"
          : "Cancel orientation",
        exact: true,
      })
      .click();
    release();
    await page.context().unrouteAll({ behavior: "wait" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await save(page)).toEqual(before);
  }
  const dialog = await open(page);
  await dialog
    .getByRole("button", { name: "Find angles", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Apply and arrange", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Cancel orientation", exact: true })
    .click();
  expect(await save(page)).toEqual(before);
});
test("open mesh errors can be cancelled and a corrected model can be oriented", async ({
  page,
}) => {
  const p = orientationProject();
  p.models[0].positions = p.models[0].positions.slice(9);
  delete (p.models[0] as any).faceTools;
  delete (p.models[0] as any).paintTriangles;
  delete (p.models[0] as any).supportPaint;
  await load(page, p);
  const before = await save(page);
  const dialog = await open(page);
  await dialog
    .getByRole("button", { name: "Find angles", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("closed");
  await dialog
    .getByRole("button", { name: "Cancel orientation", exact: true })
    .click();
  expect(await save(page)).toEqual(before);
  await load(page);
  const retry = await open(page);
  await retry.getByRole("button", { name: "Find angles", exact: true }).click();
  await expect(
    retry.getByRole("button", { name: "Apply and arrange", exact: true }),
  ).toBeVisible();
});
test("reviewing alternatives and changing priorities requires a new search before applying", async ({
  page,
}) => {
  await load(page);
  const before = await save(page),
    dialog = await open(page);
  await dialog
    .getByRole("button", { name: "Find angles", exact: true })
    .click();
  const apply = dialog.getByRole("button", {
    name: "Apply and arrange",
    exact: true,
  });
  await expect(apply).toBeVisible();
  const original = await dialog.getByLabel("Orientation estimates").innerText();
  await dialog
    .getByRole("combobox", { name: "Suggested printing angle", exact: true })
    .click();
  await page.getByRole("option", { name: /^Alternative 1 ·/ }).click();
  await expect(dialog.getByLabel("Orientation estimates")).not.toHaveText(
    original,
  );
  await dialog
    .getByRole("combobox", { name: "Orientation priority", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Lower printing height", exact: true })
    .click();
  await expect(apply).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Search again", exact: true })
    .click();
  await expect(apply).toBeEnabled();
  await expect(dialog.getByLabel("Orientation estimates")).not.toHaveText(
    original,
  );
  await dialog
    .getByRole("button", { name: "Cancel orientation", exact: true })
    .click();
  expect(await save(page)).toEqual(before);
});
