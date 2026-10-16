import { test, expect } from "@playwright/test";

test("official Bambu and U1 templates compile around actual two-color toolpaths", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } =
      await import("/src/lib/vendor-printers.ts");
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } =
      await import("/src/lib/multimaterial.ts");
    const a = primitive("cube", 1),
      b = primitive("cube", 1);
    a.scale = b.scale = [0.25, 0.25, 0.05];
    a.position = [-10, 0, 0];
    b.position = [10, 0, 0];
    b.tool = 1;
    const s = { ...DEFAULT_SETTINGS, adhesion: "none" };
    const filaments = [
      defaultFilament(s),
      { ...defaultFilament(s, 1), nozzleTemp: 220, firstNozzleTemp: 225 },
    ];
    const output = [];
    for (const preset of VENDOR_PRINTERS) {
      try {
        const p = await loadVendorPrinter(preset);
        const r = await slicePlate(
          [a, b],
          p,
          s,
          () => {},
          new AbortController().signal,
          filaments,
          { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 70 },
        );
        output.push({
          id: p.id,
          layers: r.layers.length,
          tools: r.tools.map((t) => t.tool),
          changes: r.toolChanges,
          unresolved: r.gcode
            .split("\n")
            .filter((l) =>
              /[{}\[\]]|NaN|undefined|Infinity/.test(l.split(";")[0]),
            ),
          hasAMS: r.gcode.includes("M620 S1A") && r.gcode.includes("M621 S1A"),
          hasU1:
            r.gcode.includes("PRINT_START") &&
            r.gcode.includes("PRINT_END") &&
            r.gcode.includes("SM_PRINT_PREEXTRUDE_FILAMENT INDEX=1"),
          hasOtherTemp: r.gcode.includes("M109 S225"),
          error: "",
        });
      } catch (error) {
        output.push({ id: preset.id, error: (error as Error).message });
      }
    }
    return output;
  });
  expect(results.map((r) => ({ id: r.id, error: r.error }))).toEqual(
    results.map((r) => ({ id: r.id, error: "" })),
  );
  expect(results).toHaveLength(6);
  for (const r of results) {
    expect(r.layers).toBeGreaterThanOrEqual(4);
    expect(r.tools).toContain(0);
    expect(r.tools).toContain(1);
    expect(r.changes).toBeGreaterThan(1);
    expect(r.unresolved).toEqual([]);
    expect(r.hasOtherTemp).toBe(true);
    if (r.id.startsWith("bambu")) expect(r.hasAMS).toBe(true);
    else expect(r.hasU1).toBe(true);
  }
});

test("Bambu download is a native print archive with thumbnails and can be reopened", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.evaluate(async () => {
    const { loadVendorPrinter, VENDOR_PRINTERS } =
      await import("/src/lib/vendor-printers.ts");
    const { primitive } = await import("/src/lib/geometry.ts");
    const { saveLocal } = await import("/src/lib/project.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const a = primitive("cube", 1);
    a.scale = [0.25, 0.25, 0.05];
    await saveLocal({
      version: 1,
      name: "Bambu package",
      models: [a],
      printer: await loadVendorPrinter(VENDOR_PRINTERS[1]),
      settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
      plates: [1],
      activePlate: 1,
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export print 3MF", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export print 3MF", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.gcode\.3mf$/);
  const { readFile } = await import("node:fs/promises");
  const { unzipSync, strFromU8 } = await import("fflate");
  const { createHash } = await import("node:crypto");
  const bytes = await readFile((await download.path())!);
  const files = unzipSync(bytes);
  expect(strFromU8(files["Metadata/plate_1.gcode.md5"])).toBe(
    createHash("md5").update(files["Metadata/plate_1.gcode"]).digest("hex"),
  );
  expect(Array.from(files["Metadata/plate_1.png"].slice(0, 8))).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/octet-stream",
      buffer: bytes,
    });
  await expect(page.locator(".preview-card-heading")).toContainText("layers");
  await expect(page.locator(".workspace-alert")).toHaveCount(0);
});
