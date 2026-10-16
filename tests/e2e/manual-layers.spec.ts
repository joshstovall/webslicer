import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync, gunzipSync, strFromU8 } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { PRINTERS, DEFAULT_SETTINGS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";

function auditWalls(
  code: string,
  width = DEFAULT_SETTINGS.lineWidth,
  firstHeight = 0.2,
) {
  let x = 0,
    y = 0,
    z = 0,
    height = 0,
    printing = false,
    changing = false,
    feature = "";
  const totals = new Map<
    number,
    { length: number; e: number; height: number }
  >();
  for (const line of code.split("\n")) {
    if (line === ";STRATUM_PRINT_BEGIN") printing = true;
    if (line === ";STRATUM_PRINT_END") printing = false;
    if (line.startsWith(";STRATUM_TOOL_CHANGE:")) changing = true;
    if (line === ";STRATUM_TOOL_READY") changing = false;
    if (line.startsWith(";TYPE:")) feature = line.slice(6).trim();
    if (line.startsWith(";Z:")) {
      const next = Number(line.slice(3));
      height = next - z;
      z = next;
    }
    if (!/^G[01]\s/.test(line)) continue;
    const a = Object.fromEntries(
      [...line.split(";")[0].matchAll(/([XYE])(-?[\d.]+)/g)].map((m) => [
        m[1],
        Number(m[2]),
      ]),
    );
    const nx = a.X ?? x,
      ny = a.Y ?? y,
      d = Math.hypot(nx - x, ny - y);
    if (printing && !changing && feature === "shells" && a.E > 0 && d > 0.5) {
      const t = totals.get(z) ?? { length: 0, e: 0, height };
      t.length += d;
      t.e += a.E;
      totals.set(z, t);
    }
    x = nx;
    y = ny;
  }
  expect(totals.size).toBeGreaterThan(20);
  expect([...totals.keys()][0]).toBeCloseTo(firstHeight, 3);
  for (const t of totals.values())
    expect(t.e / t.length / t.height).toBeCloseTo(width / 1.75 ** 2, 3);
  return [...totals].map(([z, t]) => ({ z, height: t.height }));
}

test("manual curves drive shared two-color layers and actual extrusion, including steep transitions", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { PRINTERS, DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const { planManualLayers } = await import("/engine/layer-plan.js");
    const curves = [
      [
        { z: 0, height: 0.24 },
        { z: 2, height: 0.08 },
        { z: 4, height: 0.08 },
        { z: 7.13, height: 0.24 },
      ],
      [
        { z: 0, height: 0.08 },
        { z: 2, height: 0.08 },
        { z: 2.001, height: 0.24 },
        { z: 4, height: 0.24 },
        { z: 4.001, height: 0.08 },
      ],
    ];
    const out = [];
    for (const layerHeightCurve of curves) {
      const s = {
        ...DEFAULT_SETTINGS,
        manualLayers: true,
        layerHeightCurve,
        layerHeight: 0.24,
        minLayerHeight: 0.08,
        firstLayerHeight: 0.201,
        adhesion: "none",
        minLayerTime: 0,
      };
      const models = [3.3, 7.13].map((h, tool) => ({
        ...primitive("cube", 1),
        tool,
        scale: [0.4, 0.4, h / 20],
        position: [tool ? 10 : -10, 0, 0],
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
      out.push({
        gcode: r.gcode,
        layers: r.layers.map((l) => l.z),
        tools: r.tools.map((t) => t.tool),
        expected: planManualLayers([{ vertices: [0, 0, 7.13] }], {
          sliceHeight: 0.24,
          sliceMinHeight: 0.08,
          firstSliceHeight: 0.201,
          stratumLayerCurve: layerHeightCurve,
        })!.map((l) => l.top),
      });
    }
    return out;
  });
  for (const r of results) {
    expect(r.layers).toEqual(r.expected);
    expect(r.tools).toEqual([0, 1]);
    const layers = auditWalls(r.gcode, DEFAULT_SETTINGS.lineWidth, 0.201);
    expect(layers.at(-1)!.z).toBe(7.13);
    expect(layers.some((l) => Math.abs(l.height - 0.08) < 0.001)).toBe(true);
    expect(layers.some((l) => l.height > 0.22)).toBe(true);
  }
});

for (const width of [1440, 390])
  test(`manual layer editor, undo, recovery and export at ${width}px`, async ({
    page,
  }) => {
    const phone = width === 390;
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const settings = {
      ...DEFAULT_SETTINGS,
      layerHeight: 0.24,
      minLayerHeight: 0.08,
      firstLayerHeight: 0.2,
      adhesion: "none",
      minLayerTime: 0,
    };
    const models = [3.3, 7.13].map((h, tool) => ({
      ...primitive("cube", 1),
      tool,
      scale: [0.4, 0.4, h / 20],
      position: [tool ? 10 : -10, 0, 0],
    }));
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Manual layers.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Manual layers",
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
    const field = (name: string) =>
      page.getByRole("textbox", { name, exact: true });
    if (phone) await button("Print setup").click();
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page
      .getByRole("option", {
        name: phone ? "Snapmaker U1" : "Bambu Lab P1S + AMS",
        exact: true,
      })
      .click();
    await page.getByRole("switch", { name: "Advanced", exact: true }).check();
    await page
      .getByRole("switch", { name: "Manual layer heights", exact: false })
      .check();
    await expect(
      page.getByRole("switch", { name: "Adaptive layer height", exact: false }),
    ).not.toBeChecked();
    await button("Edit layer curve").click();
    const dialog = page.getByRole("dialog", { name: "Variable layer heights" });
    await button("Add point").click();
    // Exercise native pointer dragging (touch events on phones) independently of numeric controls.
    const graph = page.getByRole("group", {
      name: "Layer height curve",
      exact: true,
    });
    await graph.scrollIntoViewIfNeeded();
    await expect(dialog).toHaveCSS("opacity", "1");
    const r = (await graph.boundingBox())!;
    const point = (await graph
      .locator('circle[data-index="1"]')
      .boundingBox())!;
    const x = point.x + point.width / 2,
      y = point.y + point.height / 2,
      toY = r.y + (r.height * 125) / 255;
    if (phone) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 5,
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: toY }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, toY, { steps: 8 });
      await page.mouse.up();
    }
    await expect(field("Layer height at point")).toHaveValue("0.16 mm");
    if (!phone) {
      await graph.locator('circle[data-index="1"]').focus();
      await page.keyboard.press("ArrowDown");
      await expect(field("Layer height at point")).toHaveValue("0.15 mm");
    }
    await field("Point height (Z)").fill("3");
    await field("Layer height at point").fill("0.08");
    await button("Cancel").click();
    await button("Edit layer curve").click();
    expect(await graph.locator('circle[role="button"]').count()).toBe(2);
    await button("Add point").click();
    await field("Point height (Z)").fill("3");
    await field("Layer height at point").fill("0.08");
    await graph.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/stratum-manual-curve-${width}.png`,
      animations: "disabled",
    });
    await button("Apply layer curve").click();
    await expect(dialog).not.toBeVisible();
    if (phone) await page.keyboard.press("Escape");
    if (phone) {
      await button("Manual layers").click();
      await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
      await button("Manual layers").click();
      await page.getByRole("menuitem", { name: "Redo", exact: true }).click();
    } else {
      await button("Undo (⌘Z)").click();
      await button("Redo (⇧⌘Z)").click();
    }
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    if (phone) await button("Print setup").click();
    await page.getByRole("switch", { name: "Advanced", exact: true }).check();
    await expect(
      page.getByRole("switch", { name: "Manual layer heights", exact: false }),
    ).toBeChecked();
    await button("Edit layer curve").click();
    expect(await graph.locator('circle[role="button"]').count()).toBe(3);
    await page
      .getByRole("combobox", { name: "Control point", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Point 2 · Z 3 mm", exact: true })
      .click();
    await expect(field("Layer height at point")).toHaveValue("0.08 mm");
    await button("Cancel").click();
    if (phone) await page.keyboard.press("Escape");
    const pendingProject = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    const project = JSON.parse(
      strFromU8(
        gunzipSync(await readFile((await (await pendingProject).path())!)),
      ),
    );
    expect(project.settings.manualLayers).toBe(true);
    expect(project.settings.layerHeightCurve).toEqual([
      { z: 0, height: 0.24 },
      { z: 3, height: 0.08 },
      { z: 7.13, height: 0.24 },
    ]);
    await button("Slice plate").click();
    const exporter = button(phone ? "Export G-code" : "Export print 3MF");
    await expect(exporter).toBeVisible({ timeout: 90000 });
    const pending = page.waitForEvent("download");
    await exporter.click();
    const bytes = await readFile((await (await pending).path())!);
    const code = phone
      ? bytes.toString()
      : strFromU8(unzipSync(bytes)["Metadata/plate_1.gcode"]);
    const layers = auditWalls(code);
    expect(layers.at(-1)!.z).toBe(7.13);
    expect(layers.some((l) => l.z > 2.8 && l.z < 3.2 && l.height < 0.1)).toBe(
      true,
    );
    expect(code).toContain(";STRATUM_TOOL_CHANGE:0:1");
  });

test("manual heights preserve dedicated supports, raft offsets and continuous vase extrusion", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
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
      positions: new Float32Array([
        ...geo.transformedGeometry(stem).getAttribute("position").array,
        ...geo.transformedGeometry(beam).getAttribute("position").array,
      ]),
      scale: [1, 1, 1],
    };
    const out = [];
    let raw = "";
    window.addEventListener("message", (e) => {
      if (e.data?.stratumEngine && e.data.type === "complete")
        raw = e.data.gcode;
    });
    for (const mode of [
      "auto",
      "tree",
      "vase",
      "raft-no-support",
      "raft-single",
    ]) {
      const s = {
        ...DEFAULT_SETTINGS,
        manualLayers: !mode.startsWith("raft-"),
        layerHeightCurve: [
          { z: 0, height: 0.24 },
          { z: 3, height: 0.08 },
          { z: 6, height: 0.24 },
        ],
        layerHeight: 0.24,
        minLayerHeight: 0.08,
        firstLayerHeight: 0.2,
        minLayerTime: 0,
        supports:
          mode === "vase" || mode === "raft-single"
            ? "disabled"
            : mode.startsWith("raft-")
              ? "auto"
              : mode,
        adhesion: mode === "tree" || mode.startsWith("raft-") ? "raft" : "none",
        vase: mode === "vase",
      };
      try {
        const r = await slicePlate(
          mode === "vase"
            ? [{ ...geo.primitive("sphere", 1), scale: [0.2, 0.2, 0.12] }]
            : mode.startsWith("raft-")
              ? [
                  {
                    ...geo.primitive("cube", 1),
                    tool: 1,
                    scale: [0.3, 0.3, 0.2],
                  },
                ]
              : [overhang],
          PRINTERS.find((p) => p.id === "generic-multi")!,
          s,
          () => {},
          new AbortController().signal,
          [0, 1, 2].map((i) => defaultFilament(s, i)),
          { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1, supportTool: 2 },
        );
        out.push({
          mode,
          error: "",
          used: r.tools.map((t) => t.tool),
          initial: r.gcode.match(/;STRATUM_INITIAL_TOOL:(\d+)/)?.[1],
          layers: r.layers.map((l) => ({
            z: l.z,
            tower: [...l.features].some((f) => f === 5),
            depositedTools: [
              ...new Set([...l.tools].filter((_, i) => l.features[i] !== 4)),
            ],
            tools: [
              ...new Set([...l.tools].filter((_, i) => l.features[i] === 3)),
            ],
          })),
          extrusionZ: r.layers.flatMap((l) =>
            [...l.features].flatMap((f, i) =>
              f === 4 ? [] : [l.segments[i * 6 + 5]],
            ),
          ),
        });
      } catch (e) {
        out.push({ mode, error: (e as Error).message, raw });
      }
    }
    return out;
  });
  for (const r of results)
    if (r.error)
      await writeFile(`/tmp/stratum-manual-${r.mode}-failure.gcode`, r.raw!);
  expect(results.map((r) => ({ mode: r.mode, error: r.error }))).toEqual(
    results.map((r) => ({ mode: r.mode, error: "" })),
  );
  for (const r of results) {
    expect(new Set(r.layers.map((l) => l.z)).size).toBe(r.layers.length);
    if (r.mode === "auto" || r.mode === "tree")
      expect(r.layers.flatMap((l) => l.tools)).toContain(2);
    if (r.mode === "auto") expect(r.layers[0].z).toBe(0.2);
    if (r.mode === "tree" || r.mode === "raft-no-support") {
      expect(r.initial).toBe("2");
      expect(r.used.sort()).toEqual([1, 2]);
      expect(r.layers.slice(0, 5).map((l) => l.z)).toEqual([
        0.63, 0.84, 1.05, 1.26, 1.46,
      ]);
      for (const l of r.layers.slice(0, 5)) {
        expect(l.tower).toBe(true);
        expect(l.depositedTools).toEqual([2]);
      }
      expect(r.layers.some((l) => Math.abs(l.z - 1.66) < 0.001)).toBe(true);
    }
    if (r.mode === "raft-single") {
      expect(r.initial).toBe("1");
      expect(r.used).toEqual([1]);
      expect(r.layers.some((l) => l.tower)).toBe(false);
    }
    if (r.mode === "vase") {
      expect(r.extrusionZ.at(-1)).toBeGreaterThan(4.5);
      for (let i = 1; i < r.extrusionZ.length; i++)
        expect(r.extrusionZ[i]).toBeGreaterThanOrEqual(
          r.extrusionZ[i - 1] - 0.0001,
        );
    }
  }
});

test("Bambu and U1 raft jobs begin on their configured nonzero support head", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const out = [];
    for (const preset of [VENDOR_PRINTERS[1], VENDOR_PRINTERS[5]]) {
      const printer = await loadVendorPrinter(preset);
      const s = {
        ...DEFAULT_SETTINGS,
        adhesion: "raft",
        supports: "auto",
        minLayerTime: 0,
        manualLayers: true,
        minLayerHeight: 0.08,
        layerHeightCurve: [
          { z: 0, height: 0.2 },
          { z: 4, height: 0.08 },
        ],
      };
      const r = await slicePlate(
        [{ ...primitive("cube", 1), tool: 3, scale: [0.3, 0.3, 0.2] }],
        printer,
        s,
        () => {},
        new AbortController().signal,
        [0, 1, 2, 3].map((i) => defaultFilament(s, i)),
        { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1, supportTool: 1 },
      );
      out.push({
        id: preset.id,
        used: r.tools.map((t) => t.tool),
        initial: [
          ...r.gcode
            .split(";STRATUM_PRINT_BEGIN")[0]
            .matchAll(/^\s*T([0-3])(?:\s|$)/gm),
        ].at(-1)?.[1],
        change: r.gcode.includes(";STRATUM_TOOL_CHANGE:1:3"),
        layers: r.layers.slice(0, 5).map((l) => ({
          z: l.z,
          tools: [
            ...new Set([...l.tools].filter((_, i) => l.features[i] !== 4)),
          ],
        })),
        unresolved: r.gcode
          .split("\n")
          .filter((l) =>
            /[{}\[\]]|NaN|Infinity|undefined/.test(l.split(";")[0]),
          ),
      });
    }
    return out;
  });
  for (const r of result) {
    expect(r.initial).toBe("1");
    expect(r.used.sort()).toEqual([1, 3]);
    expect(r.change).toBe(true);
    expect(r.unresolved).toEqual([]);
    expect(r.layers.map((l) => l.z)).toEqual([0.63, 0.84, 1.05, 1.26, 1.46]);
    for (const l of r.layers) expect(l.tools).toEqual([1]);
  }
});
