import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { PRINTERS, DEFAULT_SETTINGS as settings } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
for (const width of [1440, 390])
  test(`bridge and auxiliary cooling on real two-color arches at ${width}px`, async ({
    page,
  }) => {
    const u1 = width === 390;
    await page.setViewportSize({ width, height: u1 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const models = [0, 1].flatMap((tool) =>
      [-1, 1, 0].map((part) => {
        const m = primitive("cube", 1);
        const x = tool ? 20 : -20;
        return {
          ...m,
          tool,
          assemblyId: `arch-${tool}`,
          positions: [...m.positions],
          scale: part ? [0.2, 0.3, 0.2] : [0.8, 0.3, 0.08],
          position: part ? [x + part * 6, 0, 0] : [x, 0, 4],
        };
      }),
    );
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Bridge fans.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Bridge fans",
            plates: [1],
            activePlate: 1,
            printer: PRINTERS.find((p) => p.id === "generic-multi"),
            settings: { ...settings, adhesion: "none", minLayerTime: 0 },
            filaments: [0, 1].map((i) => ({
              ...defaultFilament(settings, i),
              minLayerTime: 0,
              fan: 20,
              fanLayer: 1,
            })),
            multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
            models,
          }),
        ),
      });
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const setup = async () => {
      if (u1) await button("Print setup").click();
    };
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    const set = async (name: string, value: number) => {
      await field(name).fill(String(value));
      await page.keyboard.press("Tab");
    };
    await setup();
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page
      .getByRole("option", {
        name: u1 ? "Snapmaker U1" : "Bambu Lab P1S + AMS",
        exact: true,
      })
      .click();
    await button("Manage filaments").click();
    for (const i of [1, 2]) {
      if (i === 2) {
        await button("1. PLA 1").click();
        await button("2. PLA 2").click();
      }
      await button(`Filament ${i} layer cooling`).click();
      await page
        .getByRole("switch", {
          name: `Filament ${i} bridge fan override`,
          exact: true,
        })
        .check();
      await set(`Filament ${i} bridge fan`, i === 1 ? 90 : 70);
      await page
        .getByRole("switch", {
          name: `Filament ${i} auxiliary fan override`,
          exact: true,
        })
        .check();
      await set(`Filament ${i} auxiliary fan`, i === 1 ? 60 : 30);
      await set(`Filament ${i} auxiliary fan starts at layer`, 2);
      await set(`Filament ${i} auxiliary fan ramp length`, 2);
    }
    await expect(page.locator(".mantine-Notification-root")).toHaveCount(0, {
      timeout: 15000,
    });
    await field("Filament 2 auxiliary fan").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/stratum-bridge-cooling-${width}.png` });
    await page.keyboard.press("Escape");
    if (u1) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    await setup();
    await button("Manage filaments").click();
    await button("Filament 1 layer cooling").click();
    await expect(field("Filament 1 bridge fan")).toHaveValue("90 %");
    await expect(field("Filament 1 auxiliary fan")).toHaveValue("60 %");
    await expect(field("Filament 1 auxiliary fan starts at layer")).toHaveValue(
      "2",
    );
    await page.keyboard.press("Escape");
    if (u1) await page.keyboard.press("Escape");
    await button("Slice plate").click();
    const exporter = button(u1 ? "Export G-code" : "Export print 3MF");
    await expect(exporter).toBeVisible({ timeout: 90000 });
    const pending = page.waitForEvent("download");
    await exporter.click();
    const bytes = await readFile((await (await pending).path())!);
    const archive = u1 ? undefined : unzipSync(bytes);
    const code = new TextDecoder().decode(
      archive
        ? archive[Object.keys(archive).find((k) => k.endsWith(".gcode"))!]
        : bytes,
    );
    await writeFile(`/tmp/stratum-bridge-${width}.gcode`, code);
    let active = false,
      changing = false,
      bridge = false,
      tool = 0,
      fan = -1,
      aux = -1,
      layer = -1;
    const bridges = new Set<number>(),
      normals = new Set<number>(),
      ramps = new Set<string>();
    for (const line of code.split(/\r?\n/)) {
      if (line === ";STRATUM_PRINT_BEGIN") active = true;
      if (line === ";STRATUM_PRINT_END") active = false;
      const change = line.match(/^;STRATUM_TOOL_CHANGE:\d+:(\d+)/);
      if (change) {
        tool = Number(change[1]);
        changing = true;
      }
      if (line === ";STRATUM_TOOL_READY") changing = false;
      if (!active || changing) continue;
      if (line.startsWith(";LAYER:")) layer++;
      const bm = line.match(/^;STRATUM_BRIDGE:([01])$/);
      if (bm) bridge = bm[1] === "1";
      const fm = line.match(u1 ? /^M106 S(\d+)/ : /^M106 P1 S(\d+)/);
      if (fm) fan = Number(fm[1]);
      const am = line.match(/^M106 P2 S(\d+)/);
      if (am) {
        aux = Number(am[1]);
        ramps.add(`${tool}:${aux}`);
      }
      if (
        /^G1 /.test(line) &&
        /\bE(?!-)([\d.]+)/.test(line) &&
        /\b[XY][\d.-]/.test(line)
      ) {
        if (bridge) {
          expect(layer).toBeGreaterThan(10);
          expect(fan).toBe(tool === 0 ? 230 : 179);
          bridges.add(tool);
        } else {
          expect(fan).toBe(51);
          normals.add(tool);
        }
        const target =
          layer === 0
            ? 0
            : Math.round(
                (((tool === 0 ? 60 : 30) * 255) / 100) *
                  (layer === 1 ? 0.5 : 1),
              );
        expect(aux).toBe(target);
      }
    }
    expect([...bridges].sort()).toEqual([0, 1]);
    expect([...normals].sort()).toEqual([0, 1]);
    const heights = [...code.matchAll(/^;Z:([\d.]+)/gm)].map((m) =>
      Number(m[1]),
    );
    expect(new Set(heights).size).toBe(heights.length);
    expect(ramps.has("0:77"), JSON.stringify([...ramps])).toBe(true);
    expect(ramps.has("1:38")).toBe(true);
    expect(code).toContain("M106 P2 S0\n;STRATUM_PRINT_END");
  });

test("solid color boundaries share one layer grid and do not become bridges", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { PRINTERS, DEFAULT_SETTINGS: s } = await import(
      "/src/lib/profiles.ts"
    );
    const { defaultFilament, DEFAULT_MULTI_MATERIAL: m } = await import(
      "/src/lib/multimaterial.ts"
    );
    const p = PRINTERS.find((p) => p.id === "generic-multi");
    const fs = [0, 1].map((i) => ({
      ...defaultFilament(s, i),
      bridgeFan: 90,
      minLayerTime: 0,
    }));
    const models = [0, 1].map((tool) => ({
      ...primitive("cube", 1),
      tool,
      assemblyId: "stack",
      scale: [0.5, 0.5, 0.1],
      position: [0, 0, tool * 2],
    }));
    const r = await slicePlate(
      models,
      p,
      { ...s, adhesion: "none", minLayerTime: 0 },
      () => {},
      new AbortController().signal,
      fs,
      { ...m, purgeVolume: 1 },
    );
    return {
      heights: r.layers.map((l) => l.z),
      details: r.gcode
        .split(";LAYER:")
        .map((chunk, i) => ({
          i,
          z: chunk.match(/;Z:([^\n]+)/)?.[1],
          bridges: (chunk.match(/;STRATUM_BRIDGE:1/g) ?? []).length,
        }))
        .filter((x) => x.bridges),
      bridges: (r.gcode.match(/;STRATUM_BRIDGE:1/g) ?? []).length,
      markers: (r.gcode.match(/;STRATUM_BRIDGE:0/g) ?? []).length,
      tools: r.tools.map((t) => t.tool),
    };
  });
  expect(result.bridges, JSON.stringify(result)).toBe(0);
  expect(new Set(result.heights).size).toBe(result.heights.length);
  for (let i = 1; i < result.heights.length; i++)
    expect(result.heights[i] - result.heights[i - 1]).toBeCloseTo(0.2, 3);
  expect(result.markers).toBeGreaterThan(5);
  expect(result.tools).toEqual([0, 1]);
});
