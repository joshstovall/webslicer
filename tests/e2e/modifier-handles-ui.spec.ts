import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { Vector3 } from "three";
import { parseGcode } from "../../src/lib/gcode";
import { matrixOf, primitive } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
const { PNG } = createRequire(import.meta.url)(
  "playwright-core/lib/utilsBundle",
);

// Find an actual rendered axis, so a missing/occluded gizmo cannot pass through
// programmatically calling Three controls. Coordinates come from visible pixels.
async function axisPoint(page: Page, channel: number, edge = false) {
  await page.mouse.move(2, 2);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const canvas = page.getByTestId("viewport").locator("canvas");
  const rect = (await canvas.boundingBox())!;
  const drawer = (await page
    .getByRole("dialog", { name: "Object modifiers", exact: true })
    .boundingBox())!;
  const png = PNG.sync.read(await canvas.screenshot());
  const points: { x: number; y: number }[] = [];
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const gx = rect.x + x,
        gy = rect.y + y;
      if (gx >= drawer.x && gx <= drawer.x + drawer.width && gy >= drawer.y)
        continue;
      const i = (y * png.width + x) * 4;
      if (
        png.data[i + channel] > 120 &&
        png.data[i + channel] > png.data[i + ((channel + 1) % 3)] + 45 &&
        png.data[i + channel] > png.data[i + ((channel + 2) % 3)] + 45
      )
        points.push({ x: gx, y: gy });
    }
  expect(points.length, "Visible colored transform handle").toBeGreaterThan(8);
  const selected = edge
    ? points.filter((p) =>
        channel === 2
          ? p.y <= Math.min(...points.map((q) => q.y)) + 2
          : p.x >= Math.max(...points.map((q) => q.x)) - 8,
      )
    : points;
  return {
    x: selected.reduce((a, p) => a + p.x, 0) / selected.length,
    y: selected.reduce((a, p) => a + p.y, 0) / selected.length,
  };
}
async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  touch: boolean,
) {
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [from],
    });
    for (let i = 1; i <= 12; i++)
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: from.x + (dx * i) / 12, y: from.y + (dy * i) / 12 }],
      });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
    await page.mouse.up();
  }
}
test.use({ hasTouch: true });
for (const width of [1440, 1024, 390])
  test(`modifier handles move rotate scale and persist at ${width}px`, async ({
    page,
  }) => {
    const phone = width === 390;
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const modifier = {
      ...primitive("cube", 1),
      id: "mask",
      name: "Handle mask",
      kind: "infill",
      enabled: true,
      infill: 0,
      infillPattern: "grid",
      position: [-3, 0, 0],
      scale: [0.4, 0.8, 0.5],
    };
    const model = {
      ...primitive("cube", 1),
      name: "Handle parent",
      rotation: [0, 0, 25],
      scale: [1.3, 0.8, 0.5],
      modifiers: [modifier],
    };
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Handles.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Handles",
            plates: [1],
            activePlate: 1,
            models: [
              {
                ...model,
                positions: [...model.positions],
                modifiers: [
                  { ...modifier, positions: [...modifier.positions] },
                ],
              },
            ],
            printer: PRINTERS[0],
            settings: {
              ...DEFAULT_SETTINGS,
              adhesion: "none",
              minLayerTime: 0,
            },
          }),
        ),
      });
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const open = async () => {
      if (phone) await button("Objects 1").click();
      await button("Handle parent").click();
      await page.getByRole("button", { name: /^Object modifiers/ }).click();
    };
    await open();
    await button("Hide modifier settings").click();
    // View controls live in the expanded section; choose top before collapsing.
    await button("Show modifier settings").click();
    await button("Top").click();
    await button("Hide modifier settings").click();
    await page.screenshot({ path: `/tmp/stratum-handles-${width}.png` });
    // A cancelled native touch gesture must restore the draft and release orbit.
    const cancelled = await axisPoint(page, 0, true);
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [cancelled],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: cancelled.x + 20, y: cancelled.y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await session.detach();
    await button("Show modifier settings").click();
    await expect(
      page.getByRole("textbox", { name: "Modifier position X", exact: true }),
    ).toHaveValue("-3");
    await button("Hide modifier settings").click();
    const first = await axisPoint(page, 0, true);
    await drag(page, first, 30, 0, width !== 1440);
    await button("Show modifier settings").click();
    const x = Number(
      await page
        .getByRole("textbox", { name: "Modifier position X", exact: true })
        .inputValue(),
    );
    expect(Math.abs(x + 3)).toBeGreaterThan(0.2);
    await button("Hide modifier settings").click();
    await button("Scale modifier volume").click();
    await drag(page, await axisPoint(page, 0, true), 25, -5, width !== 1440);
    await button("Show modifier settings").click();
    const scale = Number(
      await page
        .getByRole("textbox", { name: "Modifier scale X", exact: true })
        .inputValue(),
    );
    expect(Math.abs(scale - 40)).toBeGreaterThan(1);
    await button("Top").click();
    await button("Rotate modifier volume").click();
    await button("Hide modifier settings").click();
    await drag(page, await axisPoint(page, 2, true), 30, 15, width !== 1440);
    await button("Show modifier settings").click();
    const rotation = await Promise.all(
      ["X", "Y", "Z"].map(async (a) =>
        Number(
          await page
            .getByRole("textbox", {
              name: `Modifier rotation ${a}`,
              exact: true,
            })
            .inputValue(),
        ),
      ),
    );
    expect(Math.max(...rotation.map(Math.abs))).toBeGreaterThan(2);
    await button("Apply modifiers").click();
    const downloadProject = async () => {
      const pending = page.waitForEvent("download");
      await page.keyboard.press("ControlOrMeta+s");
      const bytes = await readFile((await (await pending).path())!);
      return JSON.parse(strFromU8(gunzipSync(bytes)));
    };
    const menu = async (name: string) => {
      await page.locator(".project-menu").click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    await menu("Undo");
    expect((await downloadProject()).models[0].modifiers[0].position).toEqual(
      modifier.position,
    );
    await menu("Redo");
    const saved = await downloadProject();
    expect(saved.models[0].position).toEqual(model.position);
    expect(saved.models[0].rotation).toEqual(model.rotation);
    expect(saved.models[0].scale).toEqual(model.scale);
    expect(saved.models[0].modifiers[0].position[0]).toBeCloseTo(x, 2);
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await open();
    expect(
      Number(
        await page
          .getByRole("textbox", { name: "Modifier position X", exact: true })
          .inputValue(),
      ),
    ).toBeCloseTo(x, 2);
    await page
      .getByRole("textbox", { name: "Modifier position X", exact: true })
      .fill("999");
    await button("Cancel").click();
    expect((await downloadProject()).models[0].modifiers).toEqual(
      saved.models[0].modifiers,
    );
    await button("Slice plate").click();
    await expect(button("Export G-code")).toBeVisible({ timeout: 90000 });
    const gcode = page.waitForEvent("download");
    await button("Export G-code").click();
    const result = parseGcode(
      (await readFile((await (await gcode).path())!)).toString(),
    );
    const localCenter = new Vector3(0, 0, 10).applyMatrix4(
      matrixOf(saved.models[0].modifiers[0]),
    );
    expect(Math.abs(localCenter.x)).toBeLessThan(9.9);
    expect(Math.abs(localCenter.y)).toBeLessThan(9.9);
    expect(localCenter.z).toBeGreaterThan(2);
    expect(localCenter.z).toBeLessThan(18);
    const inverse = matrixOf(saved.models[0])
      .multiply(matrixOf(saved.models[0].modifiers[0]))
      .invert();
    let checked = 0,
      inside = 0;
    for (const layer of result.layers)
      for (let i = 0; i < layer.features.length; i++) {
        if (layer.features[i] !== 1) continue;
        const p = layer.segments.slice(i * 6, i * 6 + 6);
        if (Math.hypot(p[3] - p[0], p[4] - p[1]) < 0.5) continue;
        for (const t of [0.25, 0.5, 0.75]) {
          const point = new Vector3(
            p[0] + (p[3] - p[0]) * t - 110,
            p[1] + (p[4] - p[1]) * t - 110,
            p[2],
          ).applyMatrix4(inverse);
          checked++;
          if (
            Math.abs(point.x) < 9.95 &&
            Math.abs(point.y) < 9.95 &&
            point.z > 0.05 &&
            point.z < 19.95
          )
            inside++;
        }
      }
    expect(checked).toBeGreaterThan(100);
    expect(
      inside,
      "No sparse infill inside the moved, rotated and scaled zero-infill volume",
    ).toBe(0);
  });

test("touch selects another volume directly and disabled/deleted volumes release handles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const model = primitive("cube", 1);
  const modifiers = [-18, 18].map((x, i) => ({
    ...primitive("cube", 1),
    id: `mask-${i}`,
    name: i ? "Right mask" : "Left mask",
    position: [x, 0, 0],
    scale: [0.4, 0.4, 0.4],
    enabled: true,
    kind: i ? "skins" : "infill",
    topLayers: i ? 0 : undefined,
    infill: 0,
    infillPattern: "grid",
  }));
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "Selection.webslicer",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          name: "Selection",
          plates: [1],
          activePlate: 1,
          models: [
            {
              ...model,
              name: "Selection parent",
              positions: [...model.positions],
              modifiers: modifiers.map((m) => ({
                ...m,
                positions: [...m.positions],
              })),
            },
          ],
          printer: PRINTERS[0],
          settings: DEFAULT_SETTINGS,
        }),
      ),
    });
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await button("Objects 1").click();
  await button("Selection parent").click();
  await page.getByRole("button", { name: /^Object modifiers/ }).click();
  await button("Top").click();
  await button("Hide modifier settings").click();
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
  const canvas = page.getByTestId("viewport").locator("canvas"),
    rect = (await canvas.boundingBox())!;
  const drawer = (await page
    .getByRole("dialog", { name: "Object modifiers", exact: true })
    .boundingBox())!;
  const png = PNG.sync.read(await canvas.screenshot());
  const cyan: { x: number; y: number }[] = [];
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if (
        rect.y + y < drawer.y &&
        png.data[i + 1] > png.data[i] + 55 &&
        png.data[i + 2] > png.data[i] + 55
      )
        cyan.push({ x: rect.x + x, y: rect.y + y });
    }
  expect(cyan.length).toBeGreaterThan(20);
  const x =
    (Math.min(...cyan.map((p) => p.x)) + Math.max(...cyan.map((p) => p.x))) / 2;
  const y =
    (Math.min(...cyan.map((p) => p.y)) + Math.max(...cyan.map((p) => p.y))) / 2;
  await page.touchscreen.tap(x, y);
  await expect(
    page.getByRole("combobox", { name: "Modifier volume", exact: true }),
  ).toHaveValue("2. Right mask");
  await button("Show modifier settings").click();
  await page
    .getByRole("switch", { name: "Enable modifier", exact: true })
    .uncheck();
  await expect(button("Move modifier volume")).toBeDisabled();
  await button("Remove volume").click();
  await expect(
    page.getByRole("combobox", { name: "Modifier volume", exact: true }),
  ).toHaveValue("1. Left mask");
  await expect(button("Move modifier volume")).toBeEnabled();
  await button("Cancel").click();
  await expect(button("Slice plate")).toBeEnabled();
});
