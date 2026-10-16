import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { PRINTERS, DEFAULT_SETTINGS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
import { auditPurgeVolumes } from "../../src/lib/purge-audit";

const fixture = {
  name: "Layer cooling.webslicer",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({
      version: 1,
      name: "Layer cooling",
      plates: [1],
      activePlate: 1,
      printer: PRINTERS.find((p) => p.id === "generic-multi"),
      settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
      filaments: [0, 1].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
      multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
      models: [0, 1].map((tool) => {
        const m = primitive("cube", 1);
        return {
          ...m,
          tool,
          positions: [...m.positions],
          scale: [0.2, 0.2, 0.06],
          position: [tool ? 10 : -10, 0, 0],
        };
      }),
    }),
  ),
};
for (const variant of [
  { width: 1440, name: "Bambu Lab P1S + AMS", bambu: true },
  { width: 390, name: "Snapmaker U1", bambu: false },
])
  test(`whole-layer cooling and fan ramps survive recovery and export on ${variant.name} at ${variant.width}px`, async ({
    page,
  }) => {
    const { width, bambu } = variant;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.locator('input[type="file"]').first().setInputFiles(fixture);
    const setup = async () => {
      if (width < 761)
        await page
          .getByRole("button", { name: "Print setup", exact: true })
          .click();
    };
    await setup();
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page.getByRole("option", { name: variant.name, exact: true }).click();
    await page
      .getByRole("button", { name: "Manage filaments", exact: true })
      .click();
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    const set = async (name: string, value: number) => {
      await field(name).fill(String(value));
      await page.keyboard.press("Tab");
    };
    for (const i of [1, 2]) {
      if (i === 2)
        await page
          .getByRole("button", { name: "2. PLA 2", exact: true })
          .click();
      await set(`Filament ${i} cooling fan`, i === 1 ? 90 : 60);
      await set(`Filament ${i} fan starts at layer`, i === 1 ? 2 : 1);
      await page
        .getByRole("button", {
          name: `Filament ${i} layer cooling`,
          exact: true,
        })
        .click();
      await set(`Filament ${i} fan ramp length`, i === 1 ? 3 : 2);
      await set(`Filament ${i} minimum layer time`, i === 1 ? 30 : 40);
      await set(`Filament ${i} minimum cooling speed`, 20);
    }
    await page.keyboard.press("Escape");
    if (width < 761) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await setup();
    await page
      .getByRole("button", { name: "Manage filaments", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Filament 1 layer cooling", exact: true })
      .click();
    await expect(field("Filament 1 fan ramp length")).toHaveValue("3 layers");
    await expect(field("Filament 1 minimum layer time")).toHaveValue("30 s");
    await expect(field("Filament 1 minimum cooling speed")).toHaveValue(
      "20 mm/s",
    );
    await expect(page.locator(".mantine-Notification-root")).toHaveCount(0, {
      timeout: 15000,
    });
    await field("Filament 1 minimum layer time").scrollIntoViewIfNeeded();
    await expect(field("Filament 1 minimum cooling speed")).toBeInViewport({
      ratio: 1,
    });
    await expect(
      page
        .getByText(
          "If slowing is insufficient, the head retracts and lifts while cooling. Spiral vase mode stays continuous. The preview reports any cooling target that cannot be reached safely.",
          { exact: true },
        )
        .first(),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `/tmp/stratum-layer-cooling-${width}.png` });
    await page.keyboard.press("Escape");
    if (width < 761) await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exporting = page.getByRole("button", {
      name: bambu ? "Export print 3MF" : "Export G-code",
      exact: true,
    });
    await expect(exporting).toBeVisible({ timeout: 60000 });
    const pending = page.waitForEvent("download");
    await exporting.click();
    const bytes = await readFile((await (await pending).path())!);
    const archive = bambu ? unzipSync(bytes) : undefined;
    const code = new TextDecoder().decode(
      archive
        ? archive[Object.keys(archive).find((n) => n.endsWith(".gcode"))!]
        : bytes,
    );
    expect(
      auditPurgeVolumes(
        code,
        1.75,
        { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
        true,
      ).length,
    ).toBeGreaterThan(3);
    // Independent timing audit of emitted motion and waits; opaque machine
    // changes and temperature waits do not satisfy the layer-time target.
    let active = false,
      changing = false,
      layer = -1,
      tool = 0,
      x = 0,
      y = 0,
      z = 0,
      feed = 600,
      relativeE = false;
    const layers: { seconds: number; tools: Set<number> }[] = [];
    const fans = new Map<string, number>();
    let waits = 0;
    for (const line of code.split("\n")) {
      if (line === ";STRATUM_PRINT_BEGIN") active = true;
      if (line === ";STRATUM_PRINT_END") active = false;
      const initial = line.match(/^;STRATUM_INITIAL_TOOL:(\d+)/);
      if (initial) tool = Number(initial[1]);
      const change = line.match(/^;STRATUM_TOOL_CHANGE:\d+:(\d+)/);
      if (change) {
        changing = true;
        tool = Number(change[1]);
      }
      if (line === ";STRATUM_TOOL_READY") changing = false;
      if (active && /^;LAYER:/.test(line)) {
        layer++;
        layers.push({ seconds: 0, tools: new Set() });
      }
      const text = line.split(";")[0].trim();
      const args: Record<string, number> = {};
      for (const match of text.matchAll(/\b([XYZEFPS])(-?[\d.]+)/g))
        args[match[1]] = Number(match[2]);
      const planned = active && !changing && layer >= 0;
      if (text === "M83") relativeE = true;
      if (text === "M82") relativeE = false;
      if (/^G92\b/.test(text)) {
        x = args.X ?? x;
        y = args.Y ?? y;
        z = args.Z ?? z;
      }
      if (
        planned &&
        /^M106\b/.test(text) &&
        (bambu ? args.P === 1 : args.P === undefined)
      )
        fans.set(`${layer}:${tool}`, args.S);
      if (planned && /^G4\b/.test(text)) {
        layers[layer].seconds += (args.P ?? 0) / 1000;
        waits++;
      }
      if (/^G[01]\b/.test(text)) {
        const nx = args.X ?? x,
          ny = args.Y ?? y,
          nz = args.Z ?? z;
        feed = args.F ?? feed;
        const distance = Math.hypot(nx - x, ny - y, nz - z);
        if (planned) {
          layers[layer].seconds +=
            ((distance || Math.abs(args.E ?? 0)) * 60) / feed;
          if (args.E > 0 && distance > 1e-6) {
            expect(relativeE).toBe(true);
            layers[layer].tools.add(tool);
            expect(
              (args.E * Math.PI * (1.75 / 2) ** 2 * feed) / 60 / distance,
            ).toBeLessThanOrEqual(15.0001);
          }
          expect(nz).toBeLessThanOrEqual(bambu ? 256 : 270);
        }
        x = nx;
        y = ny;
        z = nz;
      }
    }
    expect(waits).toBeGreaterThan(2);
    expect(layers.length).toBeGreaterThan(4);
    for (const [index, current] of layers.entries()) {
      const target = current.tools.has(1) ? 40 : current.tools.has(0) ? 30 : 0;
      expect(current.seconds, `Layer ${index + 1}`).toBeGreaterThanOrEqual(
        target - 0.01,
      );
      for (const t of current.tools) {
        const elapsed = index + 1 - (t === 0 ? 2 : 1) + 1;
        const expected = Math.round(
          ((t === 0 ? 90 : 60) *
            Math.min(1, Math.max(0, elapsed / (t === 0 ? 3 : 2))) *
            255) /
            100,
        );
        // Unchanged modal fans need not be emitted at every layer boundary.
        const actual =
          fans.get(`${index}:${t}`) ?? fans.get(`${index - 1}:${t}`);
        expect(actual).toBe(expected);
      }
    }
  });
