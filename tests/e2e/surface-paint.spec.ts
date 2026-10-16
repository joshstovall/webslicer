import { test, expect } from "@playwright/test";
test.use({ hasTouch: true });
for (const width of [1440, 390])
  test(`surface paint is editable, recoverable, and produces real material toolpaths at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.evaluate(async () => {
      const { primitive } = await import("/src/lib/geometry.ts");
      const { saveLocal } = await import("/src/lib/project.ts");
      const { DEFAULT_SETTINGS, PRINTERS } = await import(
        "/src/lib/profiles.ts"
      );
      const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
        "/src/lib/multimaterial.ts"
      );
      const m = primitive("cube", 1);
      m.scale = [0.5, 0.5, 0.2];
      await saveLocal({
        version: 1,
        name: "Painted cube",
        models: [m],
        printer: PRINTERS.find((p) => p.id === "generic-multi")!,
        settings: { ...DEFAULT_SETTINGS, adhesion: "none" },
        plates: [1],
        activePlate: 1,
        filaments: [0, 1].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
        multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
      });
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Paint surfaces", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Paint view", exact: true })
      .click();
    await page.getByRole("option", { name: "Top", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Paint mode", exact: true })
      .click();
    await page.getByRole("option", { name: "Flat face", exact: true }).click();
    const canvas = page.getByTestId("viewport").locator("canvas");
    const box = (await canvas.boundingBox())!;
    if (width < 761)
      await page.touchscreen.tap(
        box.x + box.width / 2,
        box.y + box.height * 0.68,
      );
    else
      await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const painted = await page.evaluate(async () => {
      const { loadLocal } = await import("/src/lib/project.ts");
      const p = (await loadLocal())!;
      return {
        tools: [...new Set(p.models[0].faceTools)],
        triangles: p.models[0].paintTriangles?.length,
      };
    });
    expect(painted.tools.sort()).toEqual([0, 1]);
    expect(painted.triangles).toBeGreaterThan(0);
    await page.screenshot({ path: `/tmp/stratum-surface-paint-${width}.png` });
    await page
      .getByRole("button", { name: "Done painting", exact: true })
      .click();
    if (width === 1440) {
      await page
        .getByRole("button", { name: "Undo (⌘Z)", exact: true })
        .click();
      await expect(page.locator(".saved-indicator")).toContainText("Saved");
      expect(
        await page.evaluate(
          async () =>
            (await (await import("/src/lib/project.ts")).loadLocal())!.models[0]
              .faceTools,
        ),
      ).toBeUndefined();
      await page
        .getByRole("button", { name: "Redo (⇧⌘Z)", exact: true })
        .click();
    }
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const storedPaint = () =>
      page.evaluate(async () => {
        const p = (await (await import("/src/lib/project.ts")).loadLocal())!;
        const m = p.models[0];
        return {
          states: Array.from(m.faceTools ?? []),
          positions: Array.from(m.paintTriangles ?? []),
        };
      });
    const beforeReload = await storedPaint();
    expect([...new Set(beforeReload.states)].sort()).toEqual([0, 1]);
    await page.reload();
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    expect(await storedPaint()).toEqual(beforeReload);
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Export G-code", exact: true }),
    ).toBeVisible({ timeout: 60000 });
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export G-code", exact: true })
      .click();
    const file = await download,
      { readFile } = await import("node:fs/promises");
    const text = await readFile((await file.path())!, "utf8");
    const paths = await page.evaluate(async (gcode) => {
      const { parseGcode } = await import("/src/lib/gcode.ts");
      const r = parseGcode(gcode),
        low = new Set<number>(),
        high = new Set<number>();
      for (const l of r.layers)
        for (let i = 0; i < l.features.length; i++) {
          if (l.features[i] === 4 || l.features[i] === 5) continue;
          const x = l.segments[i * 6 + 3] - 128,
            y = l.segments[i * 6 + 4] - 128;
          if (Math.abs(x) > 5.1 || Math.abs(y) > 5.1) continue;
          if (l.z < 3) low.add(l.tools[i]);
          if (l.z > 3.5) high.add(l.tools[i]);
        }
      return { low: [...low], high: [...high] };
    }, text);
    expect(paths.low).toEqual([0]);
    expect(paths.high).toEqual([1]);
  });
