import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function start(page: any) {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Slice plate", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
}
async function cube(page: any) {
  await page.locator(".project-menu").click();
  await page
    .getByRole("menuitem", { name: "New project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add primitive", exact: true })
    .click();
  await page.getByRole("button", { name: /Calibration cube 20/ }).click();
}
test("desktop workspace, transformations, duplicate, arrange, undo and redo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await cube(page);
  await expect(page.locator(".dimension-readout")).toContainText(
    "20.0 × 20.0 × 20.0",
  );
  await page.getByRole("button", { name: "Scale (S)", exact: true }).click();
  await page.getByRole("textbox", { name: "Scale X", exact: true }).fill("150");
  await page
    .getByRole("textbox", { name: "Scale X", exact: true })
    .press("Tab");
  await expect(page.locator(".dimension-readout")).toContainText(
    "30.0 × 30.0 × 30.0",
  );
  await page.getByRole("button", { name: "Duplicate object (⌘D)" }).click();
  await expect(page.locator(".object-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Arrange plate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Arrange objects", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Arrange plate", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (⌘Z)" }).click();
  await page.getByRole("button", { name: "Undo (⌘Z)" }).click();
  await expect(page.locator(".object-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Redo (⇧⌘Z)" }).click();
  await expect(page.locator(".object-row")).toHaveCount(2);
  await page.screenshot({ path: "/tmp/stratum-desktop-verified.png" });
  expect(errors).toEqual([]);
});
test("cut caps geometry, save/reopen project, and recover from local storage", async ({
  page,
}) => {
  await start(page);
  await cube(page);
  await page.getByRole("button", { name: "Cut model", exact: true }).click();
  await page.getByRole("textbox", { name: "Height above bed" }).fill("10");
  await page.getByRole("button", { name: "Cut and arrange" }).click();
  await expect(page.locator(".object-row")).toHaveCount(2);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const file = await saved;
  const path = await file.path();
  expect(await readFile(path!)).toBeTruthy();
  await page.locator(".project-menu").click();
  await page
    .getByRole("menuitem", { name: "New project", exact: true })
    .click();
  await expect(page.locator(".object-row")).toHaveCount(0);
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "cut-project.webslicer",
      mimeType: "application/octet-stream",
      buffer: await readFile(path!),
    });
  await expect(page.locator(".object-row")).toHaveCount(2);
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".object-row")).toHaveCount(2);
});
test("real slicing exports bounded G-code and supports layer inspection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await cube(page);
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export G-code", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".preview-card-heading")).toContainText(
    "100 layers",
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export G-code", exact: true })
    .click();
  const content = await readFile((await (await download).path())!, "utf8");
  expect(content).toContain("M104 S");
  expect(content).toContain("G28");
  expect(content).toContain("M104 S0");
  expect(
    content
      .split("\n")
      .filter(
        (line) =>
          !line.trim().startsWith(";") && /NaN|undefined|Infinity/.test(line),
      ),
  ).toEqual([]);
  const xs = [...content.matchAll(/\bX(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ys = [...content.matchAll(/\bY(-?[\d.]+)/g)].map((m) => Number(m[1]));
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...xs)).toBeLessThanOrEqual(220);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...ys)).toBeLessThanOrEqual(220);
  await page.getByRole("switch", { name: "Current layer only" }).check();
  await page.getByRole("slider", { name: "Preview layer" }).focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".layer-slider")).toContainText("Layer 1 / 100");
  await page.screenshot({ path: "/tmp/stratum-preview-verified.png" });
  await page
    .getByRole("button", { name: "Back to prepare", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Layer height", exact: true })
    .fill("0.28");
  await expect(
    page.getByRole("button", { name: "Slice plate", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
test("cancelling a job removes the engine and a subsequent slice succeeds", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.locator('iframe[title="Local slicing engine"]'),
  ).toHaveCount(0);
  await cube(page);
  await page.getByRole("button", { name: "Slice plate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export G-code", exact: true }),
  ).toBeVisible({ timeout: 60000 });
});
test("plates, settings search, presets, and custom printer configuration", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "Add build plate", exact: true })
    .click();
  await expect(page.locator(".plate-label")).toContainText("Build plate 2");
  await expect(
    page.getByRole("button", { name: "Slice plate", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Plate 1", exact: true }).click();
  await page.getByRole("textbox", { name: "Find a setting" }).fill("support");
  await expect(
    page.getByRole("combobox", { name: "Support generation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("button", { name: "Edit printer", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Printer name", exact: true })
    .fill("My workshop printer");
  await page.getByRole("button", { name: "Save printer", exact: true }).click();
  await page.getByRole("button", { name: "Manage print presets" }).click();
  await page.getByRole("textbox", { name: "Preset name" }).fill("Workshop PLA");
  await page.getByRole("button", { name: "Save current", exact: true }).click();
  await expect(page.getByText("Workshop PLA", { exact: true })).toBeVisible();
});
for (const [name, width, height] of [
  ["phone", 390, 844],
  ["tablet", 820, 1180],
] as const) {
  test(`${name}: responsive controls and model transforms`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    await expect(page.getByTestId("viewport").locator("canvas")).toBeVisible();
    if (width < 761) {
      await page
        .getByRole("button", { name: "Print setup", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Layer height", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("textbox", { name: "Layer height", exact: true })
        .fill("0.24");
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("textbox", { name: "Layer height", exact: true }),
      ).toHaveValue("0.24 mm");
      await page.keyboard.press("Escape");
      await expect(page.locator(".footer-status")).toContainText("0.24 mm");
    }
    await page.getByRole("button", { name: /^Objects 1$/ }).click();
    await expect(
      page.getByRole("textbox", { name: "Object name" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Object name" })
      .fill("Touch planter");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Slice plate", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/stratum-${name}.png` });
  });
}
test("works without secure-context randomUUID on LAN devices", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    }),
  );
  await start(page);
  await cube(page);
  await expect(page.locator(".object-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Duplicate object (⌘D)" }).click();
  await expect(page.locator(".object-row")).toHaveCount(2);
});

for (const printerName of [
  "Custom multi-extruder FDM",
  "Snapmaker U1",
  "Bambu Lab P1S + AMS",
])
  test(`production-compatible multi-filament UI exports both tools for ${printerName}`, async ({
    page,
  }) => {
    await start(page);
    await cube(page);
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page.getByRole("option", { name: printerName, exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Printer", exact: true }),
    ).toHaveValue(printerName);
    await page.getByRole("button", { name: "Scale (S)", exact: true }).click();
    await page
      .getByRole("button", { name: "Toggle uniform scale", exact: true })
      .click();
    for (const [axis, value] of [
      ["X", "20"],
      ["Y", "20"],
      ["Z", "5"],
    ]) {
      await page
        .getByRole("textbox", { name: `Scale ${axis}`, exact: true })
        .fill(value);
      await page.keyboard.press("Tab");
    }
    await page
      .getByRole("button", { name: "Duplicate object (⌘D)", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage filaments", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add filament", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page
      .getByRole("combobox", { name: "Object filament", exact: true })
      .click();
    await page.getByRole("option", { name: "2. PLA 2", exact: true }).click();
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    const exportButton = page.getByRole("button", {
      name: printerName.startsWith("Bambu")
        ? "Export print 3MF"
        : "Export G-code",
      exact: true,
    });
    await expect(exportButton).toBeVisible({ timeout: 60000 });
    const downloading = page.waitForEvent("download");
    await exportButton.click();
    const file = await downloading;
    const bytes = await readFile((await file.path())!);
    const { unzipSync, strFromU8 } = await import("fflate");
    const gcode = printerName.startsWith("Bambu")
      ? strFromU8(unzipSync(bytes)["Metadata/plate_1.gcode"])
      : bytes.toString("utf8");
    if (printerName === "Snapmaker U1") {
      expect(gcode).toContain("; park head");
      expect(gcode).toContain("; match planned retraction");
      expect(gcode).toContain("M109 S215 T1");
    }
    if (printerName.startsWith("Bambu")) {
      expect(gcode).toContain("M620 S1A");
      const { parseGcode } = await import("../../src/lib/gcode");
      const tower: number[][] = [];
      for (const layer of parseGcode(gcode).layers)
        for (let i = 0; i < layer.features.length; i++) {
          if (layer.features[i] !== 5) continue;
          for (const endpoint of [0, 3])
            tower.push([
              layer.segments[i * 6 + endpoint],
              layer.segments[i * 6 + endpoint + 1],
            ]);
        }
      expect(tower.length).toBeGreaterThan(20);
      expect(tower.every(([x, y]) => x > 18.2 || y > 28.2)).toBe(true);
      await page.screenshot({ path: "/tmp/stratum-bambu-exclusion.png" });
    }
    expect(gcode).toMatch(/^T0$/m);
    expect(gcode).toMatch(/^T1$/m);
    expect(
      gcode
        .split("\n")
        .filter((l) => /NaN|Infinity|undefined/.test(l.split(";")[0])),
    ).toEqual([]);
    expect(gcode).toContain(";TYPE:purge tower");
  });

for (const cutPainted of [false, true])
  test(`production-compatible surface painting ${cutPainted ? "survives a cut" : "loads its local worker"} and exports colored layers`, async ({
    page,
  }) => {
    await start(page);
    await cube(page);
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page
      .getByRole("option", { name: "Custom multi-extruder FDM", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage filaments", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add filament", exact: true })
      .click();
    await page.keyboard.press("Escape");
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
    const canvas = page.getByTestId("viewport").locator("canvas"),
      box = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page
      .getByRole("button", { name: "Done painting", exact: true })
      .click();
    if (cutPainted) {
      await page
        .getByRole("button", { name: "Cut model", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Height above bed", exact: true })
        .fill("10");
      await page.getByRole("combobox", { name: "Keep", exact: true }).click();
      await page
        .getByRole("option", { name: "Upper part", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Cut and arrange", exact: true })
        .click();
      await expect(page.locator(".object-row")).toHaveCount(2);
    }
    await page
      .getByRole("button", { name: "Slice plate", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Export G-code", exact: true }),
    ).toBeVisible({ timeout: 60000 });
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export G-code", exact: true })
      .click();
    const file = await pending;
    const { parseGcode } = await import("../../src/lib/gcode");
    const result = parseGcode(await readFile((await file.path())!, "utf8"));
    const tools = (layers: typeof result.layers) => [
      ...new Set(
        layers.flatMap((l) =>
          Array.from(l.tools).filter(
            (_, i) => l.features[i] !== 4 && l.features[i] !== 5,
          ),
        ),
      ),
    ];
    expect(
      tools(result.layers.filter((l) => l.z < (cutPainted ? 9 : 19))),
    ).toEqual([0]);
    expect(
      tools(result.layers.filter((l) => l.z > (cutPainted ? 9.5 : 19.5))),
    ).toEqual([1]);
  });
