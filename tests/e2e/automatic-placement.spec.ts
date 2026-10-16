import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { nestedProject } from "../fixtures/placement";
import {
  primitive,
  exportSTL,
  boundsOf,
  createModel,
} from "../../src/lib/geometry";
import { BoxGeometry } from "three";
import { parseGcode } from "../../src/lib/gcode";
async function load(page: Page, project: any) {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "Automatic placement.webslicer",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
}
async function save(page: Page) {
  const pending = page.waitForEvent("download");
  await page.locator(".project-menu").click();
  await page.getByRole("menuitem", { name: /^Save project/ }).click();
  const data = JSON.parse(
    strFromU8(gunzipSync(await readFile((await (await pending).path())!))),
  );
  await expect(page.getByRole("menu")).toBeHidden();
  return data;
}
async function menu(page: Page, name: string) {
  await page.locator(".project-menu").click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
function frameProject() {
  const p = nestedProject();
  p.models = p.models.slice(0, 1);
  return p;
}
function stl(name = "Insert.stl", size = 20) {
  return {
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(
      exportSTL([createModel("Insert", new BoxGeometry(size, size, 6))]),
    ),
  };
}
function assertNested(project: any) {
  const [frame, insert] = project.models.map((m: any) =>
    boundsOf({ ...m, positions: Float32Array.from(m.positions) }),
  );
  expect(frame.intersectsBox(insert)).toBe(true);
  for (const axis of ["x", "y"] as const) {
    expect(insert.min[axis] - frame.min[axis]).toBeGreaterThanOrEqual(8 - 1e-4);
    expect(insert.max[axis] - frame.min[axis]).toBeLessThanOrEqual(52 + 1e-4);
  }
}
test.use({ hasTouch: true });
for (const width of [1440, 1024, 390])
  test(`automatic model import nests outlines and preserves preferences, undo and real export at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await load(page, frameProject());
    await page
      .getByRole("button", { name: "Arrange plate", exact: true })
      .click();
    const options = page.getByRole("dialog", {
      name: "Arrange plate",
      exact: true,
    });
    await options.getByRole("textbox", { name: "Part spacing" }).fill("3");
    await options
      .getByRole("textbox", { name: "Bed edge clearance" })
      .fill("2");
    await options
      .getByRole("switch", { name: "Allow 90° rotations" })
      .uncheck();
    await options.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page
      .getByRole("button", { name: "Arrange plate", exact: true })
      .click();
    await expect(
      options.getByRole("textbox", { name: "Part spacing" }),
    ).toHaveValue("3 mm");
    await expect(
      options.getByRole("switch", { name: "Allow 90° rotations" }),
    ).not.toBeChecked();
    await options.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.locator("input[type=file]").first().setInputFiles(stl());
    await expect(page.locator(".object-row")).toHaveCount(2, {
      timeout: 30000,
    });
    await expect(
      page.getByRole("dialog", { name: "Place imported models" }),
    ).toHaveCount(0);
    const imported = await save(page);
    assertNested(imported);
    await menu(page, "Undo");
    expect((await save(page)).models).toHaveLength(1);
    await menu(page, "Redo");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    assertNested(await save(page));
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const output = page.getByRole("button", {
      name: "Export G-code",
      exact: true,
    });
    await expect(output).toBeVisible({ timeout: 90000 });
    const pending = page.waitForEvent("download");
    await output.click();
    const result = parseGcode(
      await readFile((await (await pending).path())!, "utf8"),
    );
    expect(result.layers.length).toBeGreaterThan(20);
  });

test("starter creation uses outlines and its complete placement is one undoable edit", async ({
  page,
}) => {
  await load(page, frameProject());
  await page
    .getByRole("button", { name: "Add primitive", exact: true })
    .click();
  await page.getByRole("button", { name: /Calibration cube 20/ }).click();
  await expect(page.locator(".object-row")).toHaveCount(2, { timeout: 30000 });
  assertNested(await save(page));
  await menu(page, "Undo");
  expect((await save(page)).models).toHaveLength(1);
  await menu(page, "Redo");
  expect((await save(page)).models).toHaveLength(2);
});

test("failed automatic placement supports retry, cancel and explicit unarranged retention on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = nestedProject();
  project.models = [];
  project.printer.bed = [30, 30, 50];
  await load(page, project);
  const before = await save(page);
  const input = page.locator("input[type=file]").first();
  await input.setInputFiles(stl("Too large.stl", 40));
  const dialog = page.getByRole("dialog", { name: "Place imported models" });
  await expect(dialog.getByRole("alert")).toContainText("Could not find");
  for (const name of [
    "Cancel operation",
    "Keep without arranging",
    "Retry placement",
  ]) {
    const button = await dialog
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(button).not.toBeNull();
    expect(button!.y).toBeGreaterThanOrEqual(0);
    expect(button!.y + button!.height).toBeLessThan(844);
  }
  await page.screenshot({
    path: "/tmp/stratum-auto-placement-failure-phone.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Cancel operation", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect((await save(page)).models).toEqual(before.models);
  await input.setInputFiles(stl("Too large.stl", 40));
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Keep without arranging", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect((await save(page)).models).toHaveLength(1);
  await menu(page, "Undo");
  await input.setInputFiles(stl("Fits with smaller margins.stl", 20));
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("textbox", { name: "Part spacing" }).fill("2");
  await dialog.getByRole("textbox", { name: "Bed edge clearance" }).fill("2");
  await dialog
    .getByRole("button", { name: "Retry placement", exact: true })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
  expect((await save(page)).models).toHaveLength(1);
});

test("cancelling automatic import placement discards staged geometry and stops the file batch", async ({
  page,
}) => {
  await load(page, frameProject());
  const before = await save(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let blocked = false;
  await page.context().route(/placement-worker/, async (route) => {
    blocked = true;
    await held;
    await route.continue().catch(() => {});
  });
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles([stl("First.stl"), stl("Second.stl")]);
  await expect.poll(() => blocked).toBe(true);
  const dialog = page.getByRole("dialog", { name: "Place imported models" });
  await dialog
    .getByRole("button", { name: "Cancel operation", exact: true })
    .click();
  release();
  await page.context().unrouteAll({ behavior: "wait" });
  await expect(dialog).toHaveCount(0);
  expect((await save(page)).models).toEqual(before.models);
  await page.locator("input[type=file]").first().setInputFiles(stl());
  await expect(page.locator(".object-row")).toHaveCount(2, { timeout: 30000 });
});

test("cancelling cut placement rolls back the completed geometry edit and permits retry", async ({
  page,
}) => {
  const project = frameProject();
  const cube = primitive("cube", 1);
  project.models = [{ ...cube, positions: [...cube.positions] }];
  await load(page, project);
  const before = await save(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let blocked = false;
  await page.context().route(/placement-worker/, async (route) => {
    blocked = true;
    await held;
    await route.continue().catch(() => {});
  });
  await page.getByRole("button", { name: "Cut model", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Height above bed", exact: true })
    .fill("10");
  await page
    .getByRole("button", { name: "Cut and arrange", exact: true })
    .click();
  await expect.poll(() => blocked).toBe(true);
  const dialog = page.getByRole("dialog", {
    name: "Place cut pieces",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Editing materials", exact: true }),
  ).toBeHidden();
  await dialog
    .getByRole("button", { name: "Cancel operation", exact: true })
    .click();
  release();
  await page.context().unrouteAll({ behavior: "wait" });
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Editing materials", exact: true }),
  ).toHaveCount(0);
  expect((await save(page)).models).toEqual(before.models);
  await page.getByRole("button", { name: "Cut model", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Height above bed", exact: true })
    .fill("10");
  await page
    .getByRole("button", { name: "Cut and arrange", exact: true })
    .click();
  await expect(page.locator(".object-row")).toHaveCount(2, { timeout: 30000 });
  const after = await save(page);
  for (const m of after.models)
    expect(
      boundsOf({ ...m, positions: Float32Array.from(m.positions) }).min.z,
    ).toBeCloseTo(0);
  await menu(page, "Undo");
  expect((await save(page)).models).toEqual(before.models);
});

test("cut placement failure can be cancelled or explicitly kept without losing the original undo state", async ({
  page,
}) => {
  await load(page, frameProject());
  const before = await save(page);
  for (const decision of ["Cancel operation", "Keep without arranging"]) {
    await page.getByRole("button", { name: "Cut model", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Height above bed", exact: true })
      .fill("3");
    await page
      .getByRole("button", { name: "Cut and arrange", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Place cut pieces",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toContainText("Could not find");
    await dialog.getByRole("button", { name: decision, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Editing materials", exact: true }),
    ).toHaveCount(0);
    const after = await save(page);
    if (decision === "Cancel operation")
      expect(after.models).toEqual(before.models);
    else {
      expect(after.models).toHaveLength(2);
      await menu(page, "Undo");
      expect((await save(page)).models).toEqual(before.models);
    }
  }
});
