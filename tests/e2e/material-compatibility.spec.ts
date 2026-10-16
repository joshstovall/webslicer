import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync, strFromU8 } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { PRINTERS, DEFAULT_SETTINGS as settings } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
for (const width of [390, 1440])
  test(`material hardware, feed approval and recovery at ${width}px`, async ({
    page,
  }) => {
    const u1 = width === 390;
    await page.setViewportSize({ width, height: u1 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Material requirements.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Material requirements",
            plates: [1],
            activePlate: 1,
            printer: PRINTERS.find((p) => p.id === "generic-multi"),
            settings: { ...settings, adhesion: "none", minLayerTime: 0 },
            filaments: [0, 1].map((i) => ({
              ...defaultFilament(settings, i),
              minLayerTime: 0,
            })),
            multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
            models: [0, 1].map((tool) => {
              const m = primitive("cube", 1);
              return {
                ...m,
                tool,
                positions: [...m.positions],
                scale: [0.2, 0.2, 0.04],
                position: [tool ? 10 : -10, 0, 0],
              };
            }),
          }),
        ),
      });
    const setup = async () => {
      if (u1)
        await page
          .getByRole("button", { name: "Print setup", exact: true })
          .click();
    };
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    const select = async (name: string, option: string) => {
      const input = page.getByRole("combobox", { name, exact: true });
      await expect(async () => {
        await input.scrollIntoViewIfNeeded();
        await expect(input).toBeInViewport({ ratio: 1, timeout: 500 });
      }).toPass({ timeout: 10000 });
      await input.click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await setup();
    await select("Printer", u1 ? "Snapmaker U1" : "Bambu Lab P1S + AMS");
    await button("Manage filaments").click();
    await button("1. PLA 1").click();
    await button("2. PLA 2").click();
    await button("Filament 2 material requirements").click();
    await field("Filament 2 material code").fill(u1 ? "PA6-CF" : "TPU 95A");
    await expect(
      page
        .getByText(
          u1
            ? /requires an enclosure or top cover/
            : /is not configured as compatible with AMS/,
        )
        .first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    if (u1) await page.keyboard.press("Escape");
    await button("Slice plate").click();
    await expect(page.locator(".workspace-alert")).toContainText(
      u1 ? "requires an enclosure" : "compatible with AMS",
    );
    await expect(
      page.locator('iframe[title="Local slicing engine"]'),
    ).toHaveCount(0);
    await setup();
    if (u1) {
      await button("Edit printer").click();
      await button("Installed material hardware").click();
      await select(
        "Installed enclosure or top cover",
        "Enclosure or top cover installed",
      );
      await page
        .getByRole("combobox", {
          name: "Heads equipped for abrasive filament",
          exact: true,
        })
        .click();
      await page
        .getByRole("option", { name: "Physical head 2", exact: true })
        .click();
      await button("Installed material hardware").click();
      await button("Save printer").click();
    }
    await button("Manage filaments").click();
    await button("1. PLA 1").click();
    await button("2. PLA 2").click();
    await button("Filament 2 material requirements").click();
    if (!u1)
      await select(
        "Filament 2 AMS compatibility",
        "Manufacturer-approved for this feed system",
      );
    await page
      .getByRole("switch", {
        name: "Filament 2 restrict shared bed temperature",
        exact: true,
      })
      .check();
    await field("Filament 2 minimum bed temperature").fill("55");
    await field("Filament 2 maximum bed temperature").fill("70");
    await page.keyboard.press("Tab");
    await expect(
      page.getByText("Material compatibility", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".mantine-Notification-root")).toHaveCount(0, {
      timeout: 15000,
    });
    await field("Filament 2 maximum bed temperature").scrollIntoViewIfNeeded();
    await expect(
      button("Reset material requirements to defaults").last(),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: `/tmp/stratum-material-requirements-${width}.png`,
    });
    await page.keyboard.press("Escape");
    if (u1) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await setup();
    await button("Manage filaments").click();
    await button("1. PLA 1").click();
    await button("2. PLA 2").click();
    await button("Filament 2 material requirements").click();
    await expect(field("Filament 2 material code")).toHaveValue(
      u1 ? "PA6-CF" : "TPU 95A",
    );
    await expect(field("Filament 2 minimum bed temperature")).toHaveValue(
      "55 °C",
    );
    await expect(
      page.getByText("Material compatibility", { exact: true }),
    ).toHaveCount(0);
    if (!u1)
      await expect(
        page.getByRole("combobox", {
          name: "Filament 2 AMS compatibility",
          exact: true,
        }),
      ).toHaveValue("Manufacturer-approved for this feed system");
    await page.keyboard.press("Escape");
    if (u1) await page.keyboard.press("Escape");
    if (!u1) {
      const pending = page.waitForEvent("download");
      await button("Save project").click();
      const bytes = await readFile((await (await pending).path())!);
      const saved = JSON.parse(strFromU8(gunzipSync(bytes)));
      expect(saved.filaments[1].requirements).toMatchObject({
        feedSystem: "AMS",
        feedCompatibility: "compatible",
        bedRange: [55, 70],
      });
    }
    await button("Slice plate").click();
    await expect(button(u1 ? "Export G-code" : "Export print 3MF")).toBeVisible(
      { timeout: 60000 },
    );
  });
