import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { primitive, mergedVertices } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import { parseGcode } from "../../src/lib/gcode";

test.use({ hasTouch: true });
for (const width of [1440, 1024, 390])
  test(`interface controls, recovery, portable project and real export at ${width}px`, async ({
    page,
  }) => {
    const phone = width === 390;
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const cube = primitive("cube", 1);
    const model = {
      ...cube,
      name: "Tree canopy",
      positions: Array.from(
        mergedVertices(
          [-6, 6].map((x) => ({
            ...cube,
            position: [x, 0, 14],
            scale: [0.2, 0.2, 0.1],
          })),
        ),
      ),
    };
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Trees.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Trees",
            plates: [1],
            activePlate: 1,
            models: [model],
            printer: PRINTERS[0],
            settings: {
              ...DEFAULT_SETTINGS,
              adhesion: "none",
              minLayerTime: 0,
              firstLayerHeight: 0.2,
            },
          }),
        ),
      });
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    const mode = page.getByRole("combobox", {
      name: "Support generation",
      exact: true,
    });
    const setup = async () => {
      if (phone) await button("Print setup").click();
      await field("Find a setting").fill("interface");
      const section = page.getByRole("button", { name: /^Support & adhesion/ });
      if ((await section.getAttribute("aria-expanded")) !== "true")
        await section.click();
    };
    await setup();
    await mode.click();
    await page
      .getByRole("option", {
        name: "Enforced only · branching trees",
        exact: true,
      })
      .click();
    await expect(field("Overhang angle")).toHaveCount(0);
    await mode.click();
    await page
      .getByRole("option", { name: "Automatic · branching trees", exact: true })
      .click();
    for (const [name, value] of [
      ["Top interface layers", "3"],
      ["Bottom interface layers", "2"],
      ["Interface density", "85"],
      ["Interface angle", "30"],
    ]) {
      await field(name).fill(value);
      await field(name).press("Tab");
    }
    await field("Interface angle").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/stratum-interface-controls-${width}.png`,
      animations: "disabled",
    });
    if (phone) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await setup();
    await expect(mode).toHaveValue("Automatic · branching trees");
    await expect(field("Top interface layers")).toHaveValue("3");
    await expect(field("Bottom interface layers")).toHaveValue("2");
    await expect(field("Interface density")).toHaveValue("85 %");
    await expect(field("Interface angle")).toHaveValue("30°");
    if (phone) await page.keyboard.press("Escape");
    const saved = page.waitForEvent("download");
    await page.locator(".project-menu").click();
    await page.getByRole("menuitem", { name: /^Save project/ }).click();
    const portable = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await saved).path())!))),
    );
    expect(portable.settings).toMatchObject({
      supports: "tree",
      supportTopInterfaceLayers: 3,
      supportBottomInterfaceLayers: 2,
      supportInterfaceDensity: 85,
      supportInterfaceAngle: 30,
    });
    await button("Slice plate").click();
    await expect(button("Export G-code")).toBeVisible({ timeout: 90000 });
    await page.screenshot({
      path: `/tmp/stratum-interface-preview-${width}.png`,
      animations: "disabled",
    });
    const download = page.waitForEvent("download");
    await button("Export G-code").click();
    const result = parseGcode(
      (await readFile((await (await download).path())!)).toString(),
    );
    const supports = result.layers.filter((l) =>
      [...l.features].some((f) => f === 3),
    );
    expect(supports.length).toBeGreaterThan(40);
    // Contact interfaces must be present in the actual downloaded toolpaths.
    const dense = supports.slice(-3).map(
      (l) =>
        [...l.features].filter((f, i) => {
          if (f !== 3) return false;
          const p = l.segments.slice(i * 6, i * 6 + 6),
            dx = p[3] - p[0],
            dy = p[4] - p[1];
          const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180;
          return (
            Math.hypot(dx, dy) > 0.8 &&
            Math.min(Math.abs(angle - 30), Math.abs(angle - 120)) < 1
          );
        }).length,
    );
    expect(dense.every((n) => n >= 6)).toBe(true);
    const widths = supports.map((l) => {
      const x = [...l.features].flatMap((f, i) =>
        f === 3 ? [l.segments[i * 6], l.segments[i * 6 + 3]] : [],
      );
      return Math.max(...x) - Math.min(...x);
    });
    expect(widths[0]).toBeLessThan(Math.max(...widths) - 2);
  });
