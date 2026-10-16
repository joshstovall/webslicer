import { test, expect } from "@playwright/test";

for (const width of [1440, 390])
  test(`height color bands stay aligned and slice with assigned tools at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.evaluate(async () => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { saveLocal } = await import("/src/lib/project.ts");
      const { PRINTERS, DEFAULT_SETTINGS } =
        await import("/src/lib/profiles.ts");
      const { defaultFilament, DEFAULT_MULTI_MATERIAL } =
        await import("/src/lib/multimaterial.ts");
      const m = primitive("cube", 1);
      m.name = "Color tower";
      m.scale = [0.3, 0.3, 0.4];
      await saveLocal({
        version: 1,
        name: "Color tower",
        models: [m],
        printer: PRINTERS.find((p) => p.id === "generic-multi")!,
        settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
        plates: [1],
        activePlate: 1,
        filaments: [0, 1, 2].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
        multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
      });
    });
    await page.reload();
    if (width < 761)
      await page
        .getByRole("button", { name: "Objects 1", exact: true })
        .click();
    await page.locator(".object-row:visible").first().click();
    for (const [height, slot] of [
      [3, 1],
      [6, 2],
    ]) {
      await page
        .getByRole("button", { name: "More model tools", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Color by height", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Color boundary above bed", exact: true })
        .fill(String(height));
      await page
        .getByRole("combobox", { name: "Filament above boundary", exact: true })
        .click();
      await page
        .getByRole("option", {
          name: `${slot + 1}. PLA ${slot + 1}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Apply height color", exact: true })
        .click();
      await expect(page.locator(".object-row:visible")).toHaveCount(slot + 1);
    }
    if (width < 761) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    const result = await page.evaluate(async () => {
      const { loadLocal, validateProject } =
        await import("/src/lib/project.ts");
      const { slicePlate } = await import("/src/lib/slicer.ts");
      const { boundsOf, validatePlate } = await import("/src/lib/geometry.ts");
      const project = (await loadLocal())!;
      const p = validateProject(
        JSON.parse(
          JSON.stringify({
            ...project,
            models: project.models.map((m) => ({
              ...m,
              positions: Array.from(m.positions),
            })),
          }),
        ),
      );
      const result = await slicePlate(
        p.models,
        p.printer,
        p.settings,
        () => {},
        new AbortController().signal,
        p.filaments,
        p.multiMaterial,
      );
      const bands = [new Set<number>(), new Set<number>(), new Set<number>()];
      for (const layer of result.layers)
        for (let i = 0; i < layer.features.length; i++) {
          const x = layer.segments[i * 6 + 3] - p.printer.bed[0] / 2,
            y = layer.segments[i * 6 + 4] - p.printer.bed[1] / 2;
          if (
            layer.features[i] === 4 ||
            layer.features[i] === 5 ||
            Math.abs(x) > 3.1 ||
            Math.abs(y) > 3.1
          )
            continue;
          if (layer.z < 2.8) bands[0].add(layer.tools[i]);
          else if (layer.z > 3.3 && layer.z < 5.8) bands[1].add(layer.tools[i]);
          else if (layer.z > 6.3) bands[2].add(layer.tools[i]);
        }
      return {
        bounds: p.models.map((m) => [boundsOf(m).min.z, boundsOf(m).max.z]),
        assemblies: p.models.map((m) => m.assemblyId),
        tools: p.models.map((m) => m.tool),
        bands: bands.map((b) => [...b]),
        errors: validatePlate(p.models, p.printer),
        changes: result.toolChanges,
      };
    });
    expect(result.bounds).toEqual([
      [0, 3],
      [3, 6],
      [6, 8],
    ]);
    expect(new Set(result.assemblies).size).toBe(1);
    expect(result.tools).toEqual([0, 1, 2]);
    expect(result.bands).toEqual([[0], [1], [2]]);
    expect(result.errors).toEqual([]);
    expect(result.changes).toBeGreaterThanOrEqual(2);
  });
