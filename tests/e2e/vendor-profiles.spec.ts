import { test, expect } from "@playwright/test";

test("official Bambu and U1 templates compile around actual two-color toolpaths", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
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
    const { loadVendorPrinter, VENDOR_PRINTERS } = await import(
      "/src/lib/vendor-printers.ts"
    );
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
  // Reopen against a different active printer; preview metadata must come from the package.
  await page.evaluate(async () => {
    const { loadLocal, saveLocal } = await import("/src/lib/project.ts");
    const { PRINTERS } = await import("/src/lib/profiles.ts");
    const p = (await loadLocal())!;
    await saveLocal({ ...p, printer: PRINTERS[0] });
  });
  await page.reload();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  await expect(page.locator(".preview-card-heading")).toContainText("layers");
  await expect(page.locator(".preview-card-heading")).toContainText(
    "Bambu Lab P1S",
  );
  await expect(page.locator(".workspace-alert")).toHaveCount(0);
  const original = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download original", exact: true })
    .click();
  const again = await original;
  expect(await readFile((await again.path())!)).toEqual(bytes);
});

test("large AMS slot IDs and all four U1 heads compile with only assigned tools", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { loadVendorPrinter, VENDOR_PRINTERS } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const output = [];
    for (const id of ["bambu-x1c", "snapmaker-u1"]) {
      const printer = await loadVendorPrinter(
        VENDOR_PRINTERS.find((p) => p.id === id)!,
      );
      const tools = id === "bambu-x1c" ? [7, 15] : [0, 1, 2, 3];
      const models = tools.map((tool, i) => ({
        ...primitive("cube", 1),
        tool,
        scale: [0.2, 0.2, 0.05],
        position: [-15 + i * 10, 0, 0],
      }));
      const filaments = Array.from({ length: printer.toolCount! }, (_, i) =>
        defaultFilament(DEFAULT_SETTINGS, i),
      );
      const result = await slicePlate(
        models,
        printer,
        { ...DEFAULT_SETTINGS, adhesion: "none" },
        () => {},
        new AbortController().signal,
        filaments,
        {
          ...DEFAULT_MULTI_MATERIAL,
          purgeVolume: 20,
          purgeVolumes:
            id === "bambu-x1c"
              ? { "7:15": 30, "15:7": 25, "0:1": 2000 }
              : { "0:1": 30, "1:0": 25 },
        },
      );
      // U1 has four independent extruders. Check the emitted E moves over
      // repeated switches, including revisiting parked heads, against the
      // native writer's retract contract (firmware priming itself is opaque).
      const lostExtrusions: string[] = [];
      let active = tools[0],
        printing = false,
        changing = false;
      const debt = new Map<number, number>();
      if (id === "snapmaker-u1")
        for (const line of result.gcode.split("\n")) {
          if (line === ";STRATUM_PRINT_BEGIN") printing = true;
          if (line === ";STRATUM_PRINT_END") break;
          if (!printing) continue;
          if (line === ";STRATUM_MACHINE_CHANGE_BEGIN") changing = true;
          if (line === ";STRATUM_MACHINE_CHANGE_END") changing = false;
          const select = line.match(/^T(\d+)$/);
          if (select) active = Number(select[1]);
          const e = line.match(/^G[01]\s.*?\bE(-?[\d.]+)/);
          if (!e) continue;
          const amount = Number(e[1]);
          const owed = debt.get(active) ?? 0;
          if (
            !changing &&
            amount > 0 &&
            /\b[XY]-?[\d.]+/.test(line) &&
            owed > 0.001
          )
            lostExtrusions.push(line);
          debt.set(active, Math.max(0, owed - amount));
        }
      output.push({
        id,
        used: result.tools.map((t) => t.tool),
        paths: [...new Set(result.layers.flatMap((l) => [...l.tools]))],
        invalid: result.gcode
          .split("\n")
          .filter((line) =>
            /NaN|Infinity|undefined|[{}]/.test(line.split(";")[0]),
          ),
        highSlot: result.gcode.includes("M620 S15A"),
        changes: result.toolChanges,
        parks: (result.gcode.match(/; park head/g) ?? []).length,
        lostExtrusions,
      });
    }
    return output;
  });
  expect(results[0].used).toEqual([7, 15]);
  expect(results[0].highSlot).toBe(true);
  expect(results[1].used).toEqual([0, 1, 2, 3]);
  expect(results[1].parks).toBe(results[1].changes);
  expect(results[1].lostExtrusions).toEqual([]);
  for (const r of results) {
    expect(r.invalid).toEqual([]);
    expect(r.paths.every((t) => r.used.includes(t))).toBe(true);
    expect(r.changes).toBeGreaterThan(2);
  }
});

test("Bambu reserved bed areas reject model geometry and generated raft extrusion", async ({
  page,
}) => {
  await page.goto("/");
  const messages = await page.evaluate(async () => {
    const { loadVendorPrinter, VENDOR_PRINTERS } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const printer = await loadVendorPrinter(
      VENDOR_PRINTERS.find((p) => p.id === "bambu-p1s")!,
    );
    const messages = [];
    for (const raft of [false, true]) {
      // The second model clears the reserved rectangle, but its generated raft
      // extends back into it. This exercises the final extrusion audit too.
      const model = {
        ...primitive("cube", 1),
        position: [raft ? -106 : -120, -118, 0],
        scale: [0.2, 0.2, 0.05],
      };
      try {
        await slicePlate(
          [model],
          printer,
          { ...DEFAULT_SETTINGS, adhesion: raft ? "raft" : "none" },
          () => {},
          new AbortController().signal,
        );
        messages.push("");
      } catch (e) {
        messages.push((e as Error).message);
      }
    }
    return messages;
  });
  expect(messages[0]).toContain("overlaps a reserved bed area");
  expect(messages[1]).toContain(
    "Generated extrusion enters a reserved bed area",
  );
  await expect(
    page.locator('iframe[title="Local slicing engine"]'),
  ).toHaveCount(0);
});

test("all vendor profiles enforce thermal limits before and after machine-template compilation", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  const evidence = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const { thermalLimits } = await import("/src/lib/thermal-limits.ts");
    const result = [];
    for (const preset of VENDOR_PRINTERS) {
      const p = await loadVendorPrinter(preset),
        limits = thermalLimits(p)!;
      const settings = {
        ...DEFAULT_SETTINGS,
        bedTemp: limits.bed,
        firstBedTemp: limits.bed,
        adhesion: "none" as const,
      };
      const filaments = [0, 1].map((i) => ({
        ...defaultFilament(settings, i),
        nozzleTemp: 300,
        firstNozzleTemp: 300,
        fan: i ? 80 : 25,
        fanLayer: i ? 1 : 3,
      }));
      const models = [0, 1].map((tool) => ({
        ...primitive("cube", 1),
        tool,
        position: [tool ? 10 : -10, 0, 0] as [number, number, number],
        scale: [0.2, 0.2, 0.04] as [number, number, number],
      }));
      const run = (machine = p, material = filaments) =>
        slicePlate(
          models,
          machine,
          settings,
          () => {},
          new AbortController().signal,
          material,
          { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 },
        );
      let error = "",
        invalid = "",
        edited = "";
      try {
        const r = await run();
        if (!r.gcode.includes("M109 S300"))
          error = "Missing target temperature";
      } catch (e) {
        error = (e as Error).message;
      }
      try {
        await run(p, [{ ...filaments[0], firstNozzleTemp: 301 }, filaments[1]]);
      } catch (e) {
        invalid = (e as Error).message;
      }
      try {
        await run({ ...p, startGcode: p.startGcode + "\nM104 S301" });
      } catch (e) {
        edited = (e as Error).message;
      }
      result.push({ id: p.id, error, invalid, edited });
    }
    return result;
  });
  expect(evidence).toHaveLength(6);
  for (const e of evidence) {
    expect(e.error, e.id).toBe("");
    expect(e.invalid, e.id).toContain(
      "first-layer temperature must be between 150 and 300",
    );
    expect(e.edited, e.id).toContain("outside the 0–300°C limit");
  }
});
