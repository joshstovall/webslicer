import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { primitive } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
import { readGcodeMetadata } from "../../src/lib/gcode-metadata";
import { parseGcode } from "../../src/lib/gcode";
const filaments = [0, 1, 2, 3].map((i) => ({
  ...defaultFilament(DEFAULT_SETTINGS, i),
  name: `Slot ${i + 1}`,
  color: ["#ffffff", "#cc3344", "#00aa44", "#3366cc"][i],
}));
const project = {
  name: "U1 job.webslicer",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({
      version: 1,
      name: "U1 job",
      plates: [1],
      activePlate: 1,
      printer: PRINTERS.find((p) => p.id === "generic-multi"),
      settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
      filaments,
      multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
      models: [1, 3].map((tool, i) => {
        const m = primitive("cube", 1);
        return {
          ...m,
          tool,
          positions: [...m.positions],
          scale: [0.3, 0.3, 0.05],
          position: [i ? 12 : -12, 0, 0],
        };
      }),
    }),
  ),
};
for (const width of [1440, 390])
  test(`native U1 metadata, thumbnails, upload and reopening work at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.locator('input[type="file"]').first().setInputFiles(project);
    if (width < 761)
      await page
        .getByRole("button", { name: "Print setup", exact: true })
        .click();
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page
      .getByRole("option", { name: "Snapmaker U1", exact: true })
      .click();
    if (width < 761) await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Slice plate", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exporting = page.getByRole("button", {
      name: "Export G-code",
      exact: true,
    });
    await expect(exporting).toBeVisible({ timeout: 60000 });
    const download = page.waitForEvent("download");
    await exporting.click();
    const bytes = await readFile((await (await download).path())!),
      code = bytes.toString("utf8");
    const metadata = readGcodeMetadata(code);
    expect(metadata.printer?.id).toBe("snapmaker-u1");
    expect(
      metadata.estimates?.tools
        .filter((t) => (t.filament ?? 0) > 0)
        .map((t) => t.tool),
    ).toEqual([1, 3]);
    expect(metadata.filaments?.map((f) => f.color)).toEqual(
      filaments.map((f) => f.color),
    );
    const parsed = parseGcode(code, {
      diameter: 1.75,
      density: 1.24,
      cost: 25,
      filaments,
    });
    expect(metadata.estimates?.filament).toBeCloseTo(parsed.filament, 4);
    const blocks = [
      ...code.matchAll(
        /; thumbnail begin (\d+)x\d+ (\d+)\n([\s\S]*?); thumbnail end/g,
      ),
    ];
    expect(blocks.map((b) => Number(b[1]))).toEqual([48, 300]);
    for (const block of blocks) {
      const data = block[3]
        .trimEnd()
        .split("\n")
        .map((l) => l.slice(2))
        .join("");
      expect(data.length).toBe(Number(block[2]));
      const png = Buffer.from(data, "base64");
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(png.readUInt32BE(16)).toBe(Number(block[1]));
      expect(png.readUInt32BE(20)).toBe(Number(block[1]));
      if (width === 1440 && block[1] === "300")
        await writeFile("/tmp/stratum-u1-native-300.png", png);
    }
    await writeFile(`/tmp/stratum-u1-native-${width}.gcode`, code);
    await writeFile(
      `/tmp/stratum-u1-native-${width}.json`,
      JSON.stringify({
        tools: metadata.estimates?.tools,
        seconds: metadata.estimates?.seconds,
      }),
    );
    if (width === 1440) {
      let upload = "";
      await page.route("https://printer.test/**", async (route) => {
        if (route.request().method() === "POST")
          upload = route.request().postData() ?? "";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ result: { klippy_connected: true } }),
        });
      });
      await page
        .getByRole("button", { name: "Connect printer", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Printer server URL", exact: true })
        .fill("https://printer.test");
      await page.getByText("Moonraker", { exact: true }).click();
      await page
        .getByRole("button", { name: "Test connection", exact: true })
        .click();
      await expect(
        page.getByText("Connected successfully.", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Upload G-code", exact: true })
        .click();
      await expect.poll(() => upload).toContain("; thumbnail begin 300x300");
      expect(upload).toContain("; printer_model = Snapmaker U1");
      expect(upload).not.toContain('name="print"\r\n\r\ntrue');
      await page.keyboard.press("Escape");
    }
    // A different editable printer must not determine this imported job's preview.
    await page.locator('input[type="file"]').first().setInputFiles(project);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "Native U1.gcode",
      mimeType: "text/plain",
      buffer: bytes,
    });
    await expect(page.locator(".preview-card-heading")).toContainText(
      "Snapmaker U1",
    );
    await expect(page.locator(".file-estimates")).toContainText(
      "Stratum motion estimate",
    );
    await expect(page.locator(".file-estimates")).toContainText("Filament 4:");
    await page
      .getByRole("combobox", { name: "Preview color scheme", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Color by filament", exact: true })
      .click();
    await expect(page.locator(".filament-usage-row")).toHaveCount(2);
    await expect(page.locator(".filament-usage-row").first()).toContainText(
      "2. Slot 2",
    );
    await expect(page.locator(".filament-usage-row").last()).toContainText(
      "4. Slot 4",
    );
    await expect(page.locator(".mantine-Notification-root")).toHaveCount(0, {
      timeout: 15000,
    });
    await page.screenshot({ path: `/tmp/stratum-u1-preview-${width}.png` });
    const original = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download original", exact: true })
      .click();
    expect(await readFile((await (await original).path())!)).toEqual(bytes);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
