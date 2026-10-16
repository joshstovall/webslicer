import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { nestedProject } from "../fixtures/placement";
import { process3mf, processConfig } from "../fixtures/process-3mf";

async function save(page: Page) {
  const pending = page.waitForEvent("download");
  await page.locator(".project-menu").click();
  await page.getByRole("menuitem", { name: /^Save project/ }).click();
  const project = JSON.parse(
    strFromU8(gunzipSync(await readFile((await (await pending).path())!))),
  );
  await expect(page.getByRole("menu")).toBeHidden();
  return project;
}

test("placement cancellation rolls back reviewed process settings and imported filaments together", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const initial = nestedProject();
  initial.models = initial.models.slice(0, 1);
  const input = page.locator("input[type=file]").first();
  await input.setInputFiles({
    name: "Initial.webslicer",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(initial)),
  });
  const before = await save(page);
  const archive = unzipSync(process3mf(processConfig));
  archive["3D/3dmodel.model"] = strToU8(
    strFromU8(archive["3D/3dmodel.model"])
      .replace(
        "<resources>",
        '<resources><basematerials id="2"><base name="Magenta" displaycolor="#ff00ff"/></basematerials>',
      )
      .replace('<object id="1"', '<object pid="2" pindex="0" id="1"'),
  );
  const file = {
    name: "Reviewed colored cube.3mf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(zipSync(archive)),
  };
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocked = false;
  await page.context().route(/placement-worker/, async (route) => {
    blocked = true;
    await held;
    await route.continue().catch(() => {});
  });
  await input.setInputFiles(file);
  await page
    .getByRole("button", { name: "Import selected settings", exact: true })
    .click();
  await expect.poll(() => blocked).toBe(true);
  await page
    .getByRole("dialog", { name: "Place imported models" })
    .getByRole("button", { name: "Cancel operation", exact: true })
    .click();
  release();
  await page.context().unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("dialog", { name: "Place imported models" }),
  ).toHaveCount(0);
  expect(await save(page)).toEqual(before);
  await input.setInputFiles(file);
  await page
    .getByRole("button", { name: "Import selected settings", exact: true })
    .click();
  await expect(page.locator(".object-row")).toHaveCount(2);
  const after = await save(page);
  expect(after.settings.layerHeight).toBe(0.25);
  expect(after.filaments.some((f: any) => f.color === "#ff00ff")).toBe(true);
  const tool = after.filaments.findIndex((f: any) => f.color === "#ff00ff");
  expect(after.models[1].tool).toBe(tool);
  await page.locator(".project-menu").click();
  await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
  expect(await save(page)).toEqual(before);
});
