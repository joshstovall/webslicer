import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { paintSurface } from "../../src/lib/surface-paint";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
import { parseGcode } from "../../src/lib/gcode";
test.use({ hasTouch: true });
for (const width of [1440, 390])
  test(`support paint, underside access, undo and recovery produce colored supported exports at ${width}px`, async ({
    page,
  }) => {
    const phone = width === 390;
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const base = {
      ...primitive("cube", 1),
      position: [0, 0, 5] as [number, number, number],
      scale: [1, 1, 0.2] as [number, number, number],
    };
    const model = {
      ...base,
      ...paintSurface(base, {
        point: [0, 0, 9],
        normal: [0, 0, 1],
        mode: "face",
        tool: 1,
        sourceTool: 0,
        radius: 3,
      }),
    };
    const printer = PRINTERS.find((p) => p.id === "generic-multi")!;
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Support painting.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Support painting",
            plates: [1],
            activePlate: 1,
            models: [
              {
                ...model,
                positions: [...model.positions],
                faceTools: [...model.faceTools!],
                paintTriangles: [...model.paintTriangles!],
              },
            ],
            printer,
            settings: {
              ...DEFAULT_SETTINGS,
              adhesion: "none",
              minLayerTime: 0,
            },
            filaments: [0, 1].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
            multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
          }),
        ),
      });
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const select = async (name: string, option: string) => {
      await page.getByRole("combobox", { name, exact: true }).last().click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await button("Paint supports").click();
    await select("Support generation", "Enforced only");
    await select("Paint mode", "Flat face");
    const canvas = page.getByTestId("viewport").locator("canvas"),
      box = (await canvas.boundingBox())!;
    const dab = async () => {
      if (phone)
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height * 0.68,
        );
      else
        await canvas.click({
          position: { x: box.width / 2, y: box.height / 2 },
        });
    };
    if (phone) await button("Hide paint controls").click();
    await dab();
    if (phone) await button("Show paint controls").click();
    await select("Paint mode", "Round brush");
    await select("Support paint", "Block · red");
    if (phone) await button("Hide paint controls").click();
    await dab();
    await page.screenshot({
      path: `/tmp/stratum-support-paint-${width}.png`,
      animations: "disabled",
    });
    await button("Done painting").click();
    const menu = async (name: string) => {
      await page.locator(".project-menu").click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    await menu("Undo");
    await menu("Redo");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await button("Paint supports").click();
    await expect(
      page
        .getByRole("combobox", { name: "Support generation", exact: true })
        .last(),
    ).toHaveValue("Enforced only");
    await button("Done painting").click();
    const saving = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    const project = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await saving).path())!))),
    );
    expect([...new Set(project.models[0].supportPaint.states)].sort()).toEqual([
      0, 1, 2,
    ]);
    expect(project.models[0].faceTools).toEqual([...model.faceTools!]);
    expect(project.models[0].paintTriangles).toEqual([
      ...model.paintTriangles!,
    ]);
    await button("Slice plate").click();
    await expect(button("Export G-code")).toBeVisible({ timeout: 90000 });
    const downloading = page.waitForEvent("download");
    await button("Export G-code").click();
    const result = parseGcode(
      (await readFile((await (await downloading).path())!)).toString(),
    );
    const support = result.layers.flatMap((l) =>
      [...l.features].flatMap((f, i) =>
        f === 3 ? [Array.from(l.segments.slice(i * 6, i * 6 + 6))] : [],
      ),
    );
    expect(support.length).toBeGreaterThan(100);
    let inside = 0;
    for (const p of support)
      for (let i = 0; i <= 10; i++)
        if (
          Math.hypot(
            p[0] + (i / 10) * (p[3] - p[0]) - printer.bed[0] / 2,
            p[1] + (i / 10) * (p[4] - p[1]) - printer.bed[1] / 2,
          ) < 1.5
        )
          inside++;
    expect(inside).toBe(0);
    expect(
      result.layers
        .filter((l) => l.z > 8.5)
        .some((l) =>
          [...l.tools].some(
            (t, i) => t === 1 && l.features[i] !== 4 && l.features[i] !== 5,
          ),
        ),
    ).toBe(true);
  });
