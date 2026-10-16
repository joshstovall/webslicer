import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import { parseGcode } from "../../src/lib/gcode";

test.use({ hasTouch: true });
for (const width of [1440, 390])
  test(`regional wall count editing, recovery and export at ${width}px`, async ({
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
              firstLayerHeight: 0.2,
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
    await page.getByRole("option", { name: "Wall count", exact: true }).click();
    await field("Modifier name").fill("Five left walls");
    await field("Modifier wall count").fill("5");
    for (const [key, value] of [
      ["position X", "-5"],
      ["position Z", "-1"],
      ["scale X", "50"],
      ["scale Y", "200"],
      ["scale Z", "200"],
    ])
      await field(`Modifier ${key}`).fill(value);
    await button("Isometric").click();
    await field("Modifier wall count").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/stratum-wall-modifier-${width}.png`,
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
    await expect(field("Modifier wall count")).toHaveValue("5");
    await button("Cancel").click();
    const pending = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    const portable = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await pending).path())!))),
    );
    expect(portable.models[0].modifiers[0]).toMatchObject({
      kind: "walls",
      walls: 5,
    });
    await button("Slice plate").click();
    await expect(button("Export G-code")).toBeVisible({ timeout: 90000 });
    const download = page.waitForEvent("download");
    await button("Export G-code").click();
    const result = parseGcode(
      (await readFile((await (await download).path())!)).toString(),
    );
    const layer = result.layers.find((l) => Math.abs(l.z - 2) < 0.01)!;
    expect(layer).toBeTruthy();
    const paths = [...layer.features].flatMap((f, i) =>
      f === 0 ? [[...layer.segments.slice(i * 6, i * 6 + 6)]] : [],
    );
    const center = PRINTERS[0].bed[0] / 2;
    for (const [x, count] of [
      [center - 5, 5],
      [center + 5, 3],
    ]) {
      const crossings = paths.filter(
        (p) =>
          Math.min(p[0], p[3]) < x &&
          Math.max(p[0], p[3]) > x &&
          p[1] < center &&
          p[4] < center,
      );
      expect(crossings).toHaveLength(count);
    }
    expect(
      paths.filter(
        (p) =>
          Math.abs(p[0] - center) < 0.001 && Math.abs(p[3] - center) < 0.001,
      ),
    ).toHaveLength(0);
  });
