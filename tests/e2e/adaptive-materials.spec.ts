import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";

// Independent raw-command audit: volume per mm of wall must follow the actual
// physical Z increment. Pure-E recovery and machine macros are not deposition.
function checkWallVolume(gcode: string) {
  let x = 0,
    y = 0,
    z = 0,
    previousZ = 0,
    height = 0,
    feature = "",
    printing = false,
    changing = false;
  const totals = new Map<
    number,
    { length: number; e: number; height: number }
  >();
  for (const line of gcode.split(/\r?\n/)) {
    if (line === ";STRATUM_PRINT_BEGIN") printing = true;
    if (line === ";STRATUM_PRINT_END") printing = false;
    if (line.startsWith(";STRATUM_TOOL_CHANGE:")) changing = true;
    if (line === ";STRATUM_TOOL_READY") changing = false;
    if (line.startsWith(";TYPE:")) feature = line.slice(6).trim();
    if (line.startsWith(";Z:")) {
      previousZ = z;
      z = Number(line.slice(3));
      height = z - previousZ;
    }
    if (!/^G[01]\s/.test(line)) continue;
    const args = Object.fromEntries(
      [...line.split(";")[0].matchAll(/([XYE])(-?[\d.]+)/g)].map((m) => [
        m[1],
        Number(m[2]),
      ]),
    );
    const nx = args.X ?? x,
      ny = args.Y ?? y,
      length = Math.hypot(nx - x, ny - y);
    if (
      printing &&
      !changing &&
      feature === "shells" &&
      args.E > 0 &&
      length > 0.5 &&
      height > 0
    ) {
      const sum = totals.get(z) ?? { length: 0, e: 0, height };
      sum.length += length;
      sum.e += args.E;
      totals.set(z, sum);
    }
    x = nx;
    y = ny;
  }
  expect(totals.size).toBeGreaterThan(5);
  // Kiri's documented ellipse extrusion model: E/mm = width*height/diameter².
  for (const sum of totals.values())
    expect(sum.e / sum.length / sum.height).toBeCloseTo(
      DEFAULT_SETTINGS.lineWidth / 1.75 ** 2,
      3,
    );
}

for (const adaptive of [true, false])
  test(`${adaptive ? "adaptive" : "fixed"} materials share physical layers and extrude their actual heights`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (adaptive) => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const { PRINTERS, DEFAULT_SETTINGS } = await import(
        "/src/lib/profiles.ts"
      );
      const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
        "/src/lib/multimaterial.ts"
      );
      const s = {
        ...DEFAULT_SETTINGS,
        adaptive,
        layerHeight: 0.24,
        firstLayerHeight: adaptive ? 0.201 : 0.2,
        minLayerHeight: 0.08,
        adhesion: "none",
        minLayerTime: 0,
      };
      const models = [3.3, 4.7, 0.31].map((height, i) => ({
        ...primitive("cube", 1),
        tool: i % 2,
        scale: [0.3, 0.3, height / 20],
        position: [i * 15 - 15, 0, 0],
      }));
      const r = await slicePlate(
        models,
        PRINTERS.find((p) => p.id === "generic-multi")!,
        s,
        () => {},
        new AbortController().signal,
        [0, 1].map((i) => defaultFilament(s, i)),
        { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
      );
      return {
        gcode: r.gcode,
        layers: r.layers.map((l) => ({
          z: l.z,
          tools: [
            ...new Set(
              [...l.tools].filter((_, i) => ![4, 5].includes(l.features[i])),
            ),
          ],
        })),
      };
    }, adaptive);
    await writeFile(
      `/tmp/stratum-${adaptive ? "adaptive" : "fixed"}-inspect.gcode`,
      result.gcode,
    );
    expect(result.layers[0].z).toBeCloseTo(adaptive ? 0.201 : 0.2, 3);
    for (let i = 1; i < result.layers.length; i++) {
      const delta = result.layers[i].z - result.layers[i - 1].z;
      expect(delta).toBeGreaterThanOrEqual(0.08 - 1e-7);
      expect(delta).toBeLessThanOrEqual(0.24 + 1e-7);
    }
    for (const l of result.layers.filter((l) => l.z < 3.2))
      expect(l.tools.sort()).toEqual([0, 1]);
    expect(result.layers.at(-1)!.z).toBeCloseTo(adaptive ? 4.7 : 4.76, 3);
    checkWallVolume(result.gcode);
  });

for (const width of [1440, 390])
  test(`adaptive two-color vendor export and recovery at ${width}px`, async ({
    page,
  }) => {
    const u1 = width === 390;
    await page.setViewportSize({ width, height: u1 ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const settings = {
      ...DEFAULT_SETTINGS,
      layerHeight: 0.24,
      firstLayerHeight: 0.2,
      minLayerHeight: 0.08,
      adhesion: "none",
      minLayerTime: 0,
    };
    const models = [3.3, 4.7].map((height, tool) => ({
      ...primitive("cube", 1),
      tool,
      scale: [0.3, 0.3, height / 20],
      position: [tool ? 10 : -10, 0, 0],
    }));
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Adaptive materials.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Adaptive materials",
            plates: [1],
            activePlate: 1,
            printer: PRINTERS.find((p) => p.id === "generic-multi"),
            settings,
            filaments: [0, 1].map((i) => defaultFilament(settings, i)),
            multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
            models: models.map((m) => ({ ...m, positions: [...m.positions] })),
          }),
        ),
      });
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    if (u1) await button("Print setup").click();
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page
      .getByRole("option", {
        name: u1 ? "Snapmaker U1" : "Bambu Lab P1S + AMS",
        exact: true,
      })
      .click();
    await page.getByRole("switch", { name: "Advanced", exact: true }).check();
    await page
      .getByRole("switch", { name: "Adaptive layer height", exact: false })
      .check();
    await expect(
      page.getByRole("textbox", { name: "Minimum layer height", exact: true }),
    ).toHaveValue("0.08 mm");
    if (u1) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    if (u1) await button("Print setup").click();
    await page.getByRole("switch", { name: "Advanced", exact: true }).check();
    await expect(
      page.getByRole("switch", { name: "Adaptive layer height", exact: false }),
    ).toBeChecked();
    if (u1) await page.keyboard.press("Escape");
    await button("Slice plate").click();
    const exporter = button(u1 ? "Export G-code" : "Export print 3MF");
    await expect(exporter).toBeVisible({ timeout: 90000 });
    const pending = page.waitForEvent("download");
    await exporter.click();
    const bytes = await readFile((await (await pending).path())!);
    const archive = u1 ? undefined : unzipSync(bytes);
    const code = u1
      ? bytes.toString()
      : new TextDecoder().decode(
          Object.entries(archive!).find(([n]) => n.endsWith(".gcode"))![1],
        );
    const z = [...code.matchAll(/^;Z:([\d.]+)/gm)].map((m) => Number(m[1]));
    expect(z[0]).toBe(0.2);
    expect(z.at(-1)).toBe(4.7);
    expect(new Set(z).size).toBe(z.length);
    for (let i = 1; i < z.length; i++) {
      expect(z[i] - z[i - 1]).toBeGreaterThanOrEqual(0.08 - 1e-7);
      expect(z[i] - z[i - 1]).toBeLessThanOrEqual(0.24 + 1e-7);
    }
    expect(code).toContain(";STRATUM_TOOL_CHANGE:0:1");
    expect(code).toContain(";STRATUM_TOOL_CHANGE:1:0");
    await page.screenshot({ path: `/tmp/stratum-adaptive-${width}.png` });
  });

test("adaptive dedicated supports and raft retain consistent material layer elevations", async ({
  page,
}) => {
  await page.goto("/");
  const cases = await page.evaluate(async () => {
    const geo = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const stem = { ...geo.primitive("cube", 1), scale: [0.2, 0.3, 0.2] };
    const beam = {
      ...geo.primitive("cube", 1),
      scale: [0.9, 0.3, 0.07],
      position: [0, 0, 4],
    };
    const overhang = {
      ...stem,
      tool: 1,
      scale: [1, 1, 1],
      positions: geo.mergedVertices([stem, beam]),
    };
    const second = {
      ...geo.primitive("sphere", 1),
      tool: 0,
      position: [25, 0, 0],
      scale: [0.2, 0.2, 0.12],
    };
    const results = [];
    for (const [supports, adhesion] of [
      ["auto", "none"],
      ["tree", "raft"],
    ]) {
      const s = {
        ...DEFAULT_SETTINGS,
        adaptive: true,
        firstLayerHeight: 0.2,
        layerHeight: 0.24,
        minLayerHeight: 0.08,
        supports,
        adhesion,
        minLayerTime: 0,
      };
      const r = await slicePlate(
        [overhang, second],
        PRINTERS.find((p) => p.id === "generic-multi")!,
        s,
        () => {},
        new AbortController().signal,
        [0, 1, 2].map((i) => defaultFilament(s, i)),
        { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1, supportTool: 2 },
      );
      results.push({
        supports,
        adhesion,
        layers: r.layers.map((l) => ({
          z: l.z,
          model: [...l.features].some((f) => ![3, 4, 5].includes(f)),
          supportTools: [
            ...new Set([...l.tools].filter((_, i) => l.features[i] === 3)),
          ],
        })),
      });
    }
    return results;
  });
  for (const c of cases) {
    expect(c.layers.flatMap((l) => l.supportTools)).toContain(2);
    expect(new Set(c.layers.map((l) => l.z)).size).toBe(c.layers.length);
    const modelLayers = c.layers
      .slice(c.adhesion === "raft" ? 4 : 0)
      .filter((l) => l.model);
    expect(modelLayers[0].z).toBeCloseTo(c.adhesion === "raft" ? 1.66 : 0.2, 3);
    for (let i = 1; i < modelLayers.length; i++) {
      expect(modelLayers[i].z - modelLayers[i - 1].z).toBeGreaterThanOrEqual(
        0.08 - 1e-7,
      );
      expect(modelLayers[i].z - modelLayers[i - 1].z).toBeLessThanOrEqual(
        0.24 + 1e-7,
      );
    }
  }
});

test("adaptive linked color boundaries keep shared planes without false bridges", async ({
  page,
}) => {
  await page.goto("/");
  const layers = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const s = {
      ...DEFAULT_SETTINGS,
      adaptive: true,
      firstLayerHeight: 0.2,
      layerHeight: 0.24,
      minLayerHeight: 0.08,
      adhesion: "none",
      minLayerTime: 0,
    };
    const models = [0, 1].map((tool) => ({
      ...primitive("cube", 1),
      tool,
      assemblyId: "stack",
      scale: [0.3, 0.3, tool ? 0.07 : 0.165],
      position: [0, 0, tool ? 3.3 : 0],
    }));
    const r = await slicePlate(
      models,
      PRINTERS.find((p) => p.id === "generic-multi")!,
      s,
      () => {},
      new AbortController().signal,
      [0, 1].map((i) => defaultFilament(s, i)),
      { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
    );
    return r.layers.map((l) => ({
      z: l.z,
      tools: [
        ...new Set(
          [...l.tools].filter((_, i) => ![4, 5].includes(l.features[i])),
        ),
      ],
      bridges: [...l.features].includes(6),
    }));
  });
  expect(layers.some((l) => l.z === 3.3)).toBe(true);
  expect(layers.at(-1)!.z).toBe(4.7);
  for (const l of layers) {
    expect(l.tools).toEqual([l.z <= 3.3 ? 0 : 1]);
    expect(l.bridges).toBe(false);
  }
});

test("adaptive spiral vase remains continuous across variable layer heights", async ({
  page,
}) => {
  await page.goto("/");
  const z = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const s = {
      ...DEFAULT_SETTINGS,
      adaptive: true,
      vase: true,
      firstLayerHeight: 0.2,
      layerHeight: 0.24,
      minLayerHeight: 0.08,
      adhesion: "none",
      minLayerTime: 0,
    };
    const r = await slicePlate(
      [{ ...primitive("sphere", 1), scale: [0.2, 0.2, 0.12] }],
      PRINTERS[0],
      s,
      () => {},
      new AbortController().signal,
    );
    return r.layers.flatMap((l) =>
      [...l.features].flatMap((f, i) =>
        f === 4 ? [] : [l.segments[i * 6 + 5]],
      ),
    );
  });
  expect(z.length).toBeGreaterThan(500);
  expect(z.at(-1)).toBeGreaterThan(4.5);
  expect(z.at(-1)).toBeLessThanOrEqual(4.801);
  for (let i = 1; i < z.length; i++)
    expect(z[i]).toBeGreaterThanOrEqual(z[i - 1] - 1e-4);
});
