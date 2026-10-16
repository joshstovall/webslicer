import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import { audit } from "../helpers/process-audit";

test.use({ hasTouch: true });
for (const width of [1440, 390])
  test(`regional speed and flow editing, recovery and export at ${width}px`, async ({
    page,
  }) => {
    const phone = width === 390;
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const model = {
      ...primitive("cube", 1),
      name: "Regional block",
      scale: [1, 1, 0.2],
    };
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Regional settings.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Regional settings",
            plates: [1],
            activePlate: 1,
            models: [{ ...model, positions: [...model.positions] }],
            printer: PRINTERS[0],
            settings: {
              ...DEFAULT_SETTINGS,
              adhesion: "none",
              minLayerTime: 0,
              maxFlow: 100,
              infill: 20,
              infillPattern: "grid",
            },
          }),
        ),
      });
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    const open = async () => {
      if (phone) await button("Objects 1").click();
      await button("Regional block").click();
      await page.getByRole("button", { name: /^Object modifiers/ }).click();
    };
    await open();
    await button("Add cube").click();
    await page
      .getByRole("combobox", { name: "Modifier effect", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Print speed and flow", exact: true })
      .click();
    await field("Modifier name").fill("Slow left half");
    await field("Print speed multiplier").fill("50");
    await page
      .getByRole("switch", { name: "Override extrusion flow", exact: true })
      .check();
    await field("Extrusion flow multiplier").fill("150");
    for (const [key, value] of [
      ["position X", "-5"],
      ["position Z", "-1"],
      ["scale X", "50"],
      ["scale Y", "200"],
      ["scale Z", "200"],
    ])
      await field(`Modifier ${key}`).fill(value);
    await button("Isometric").click();
    await field("Print speed multiplier").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/stratum-process-modifier-${width}.png`,
      animations: "disabled",
    });
    await button("Apply modifiers").click();
    const menu = async (name: string) => {
      await page.locator(".project-menu").click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    await menu("Undo");
    await menu("Redo");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await open();
    await expect(field("Print speed multiplier")).toHaveValue("50 %");
    await expect(field("Extrusion flow multiplier")).toHaveValue("150 %");
    await button("Cancel").click();
    const pending = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    const portable = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await pending).path())!))),
    );
    expect(portable.models[0].modifiers[0]).toMatchObject({
      kind: "process",
      speedPercent: 50,
      flowPercent: 150,
    });
    await button("Slice plate").click();
    await expect(button("Export G-code")).toBeVisible({ timeout: 90000 });
    const download = page.waitForEvent("download");
    await button("Export G-code").click();
    const result = audit(
      (await readFile((await (await download).path())!)).toString(),
    );
    expect(result.crossing).toBe(0);
    const [left, right] = result.sides;
    expect(left.length).toBeGreaterThan(100);
    expect(right.length).toBeGreaterThan(100);
    const flowRatio = left.e / left.length / (right.e / right.length);
    const speedRatio = left.length / left.time / (right.length / right.time);
    expect(flowRatio).toBeGreaterThan(1.45);
    expect(flowRatio).toBeLessThan(1.55);
    expect(speedRatio).toBeGreaterThan(0.47);
    expect(speedRatio).toBeLessThan(0.53);
  });
