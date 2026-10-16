import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, gunzipSync, strFromU8 } from "fflate";
import { primitive } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";

test("all 24 pinned nozzle profiles slice actual two-color paths and retain export metadata", async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const { nozzleSettings, VENDOR_NOZZLES } = await import(
      "/src/lib/nozzle-profiles.ts"
    );
    const { primitive } = await import("/src/lib/geometry.ts");
    const { slicePlate } = await import("/src/lib/slicer.ts");
    const { DEFAULT_SETTINGS } = await import("/src/lib/profiles.ts");
    const { defaultFilament, DEFAULT_MULTI_MATERIAL } = await import(
      "/src/lib/multimaterial.ts"
    );
    const { createPrintPackage } = await import("/src/lib/print-package.ts");
    const { readPrintPackage } = await import(
      "/src/lib/print-package-reader.ts"
    );
    const { createU1Job } = await import("/src/lib/u1-job.ts");
    const { readGcodeMetadata } = await import("/src/lib/gcode-metadata.ts");
    const models = [0, 1].map((tool) => ({
      ...primitive("cube", 1),
      tool,
      scale: [0.4, 0.4, 0.12],
      position: [tool ? 10 : -10, 0, 0],
    }));
    const output = [];
    for (const preset of VENDOR_PRINTERS)
      for (const nozzle of VENDOR_NOZZLES) {
        try {
          const printer = await loadVendorPrinter({ ...preset, nozzle });
          const settings = {
            ...DEFAULT_SETTINGS,
            ...nozzleSettings(printer),
            adhesion: "none",
            minLayerTime: 0,
          };
          const filaments = [0, 1].map((i) => defaultFilament(settings, i));
          const result = await slicePlate(
            models,
            printer,
            settings,
            () => {},
            new AbortController().signal,
            filaments,
            { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 1 },
          );
          const reopened =
            printer.firmware === "bambu"
              ? await readPrintPackage(
                  createPrintPackage(
                    {
                      version: 1,
                      name: "Nozzle test",
                      printer,
                      settings,
                      filaments,
                      models,
                      plates: [1],
                      activePlate: 1,
                    },
                    result,
                  ),
                )
              : readGcodeMetadata(
                  createU1Job(result, printer, settings, filaments),
                );
          output.push({
            id: preset.id,
            nozzle,
            profileNozzle: printer.profileNozzle,
            source: decodeURIComponent(printer.profileSource!),
            reopened: reopened.printer?.nozzle,
            tools: result.tools.map((t) => t.tool),
            z: result.layers.map((l) => l.z),
            gcode: result.gcode,
            width: settings.lineWidth,
            error: "",
          });
        } catch (e) {
          output.push({ id: preset.id, nozzle, error: (e as Error).message });
        }
      }
    return output;
  });
  expect(
    results.map(({ id, nozzle, error }) => ({ id, nozzle, error })),
  ).toEqual(results.map(({ id, nozzle }) => ({ id, nozzle, error: "" })));
  expect(results).toHaveLength(24);
  for (const r of results) {
    expect(r.profileNozzle).toBe(r.nozzle);
    expect(r.source).toContain(`${r.nozzle} nozzle`);
    expect(r.reopened).toBe(r.nozzle);
    expect(r.tools).toEqual([0, 1]);
    expect(r.z![0]).toBeCloseTo(r.nozzle * 0.6, 3);
    expect(
      r
        .gcode!.split("\n")
        .filter((l) => /[{}\[\]]|NaN|undefined|Infinity/.test(l.split(";")[0])),
    ).toEqual([]);
    // Independent E/XY audit on first-layer model walls: extrusion must change
    // with nozzle-specific line width and height, rather than just metadata.
    let x = 0,
      y = 0,
      printing = false,
      changing = false,
      feature = "",
      first = false,
      length = 0,
      e = 0;
    for (const line of r.gcode!.split("\n")) {
      if (line === ";STRATUM_PRINT_BEGIN") printing = true;
      if (line === ";STRATUM_PRINT_END") printing = false;
      if (line.startsWith(";STRATUM_TOOL_CHANGE:")) changing = true;
      if (line === ";STRATUM_TOOL_READY") changing = false;
      if (line.startsWith(";TYPE:")) feature = line.slice(6).trim();
      if (line.startsWith(";Z:"))
        first = Math.abs(Number(line.slice(3)) - r.nozzle * 0.6) < 0.0001;
      if (!/^G[01]\s/.test(line)) continue;
      const args = Object.fromEntries(
        [...line.split(";")[0].matchAll(/([XYE])(-?[\d.]+)/g)].map((m) => [
          m[1],
          Number(m[2]),
        ]),
      );
      const nx = args.X ?? x,
        ny = args.Y ?? y,
        distance = Math.hypot(nx - x, ny - y);
      if (
        printing &&
        !changing &&
        first &&
        feature === "shells" &&
        args.E > 0 &&
        distance > 0.5
      ) {
        length += distance;
        e += args.E;
      }
      x = nx;
      y = ny;
    }
    expect(length).toBeGreaterThan(10);
    expect(e / length / (r.nozzle * 0.6)).toBeCloseTo(r.width! / 1.75 ** 2, 3);
  }
});

test("different nozzle caches survive reload without GitHub access", async ({
  page,
}) => {
  await page.goto("/");
  const load = async () =>
    page.evaluate(async () => {
      const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
        "/src/lib/vendor-printers.ts"
      );
      return Promise.all(
        [0.2, 0.6].map((nozzle) =>
          loadVendorPrinter({ ...VENDOR_PRINTERS[1], nozzle }),
        ),
      );
    });
  const before = await load();
  expect(before[0].startGcode).not.toBe(before[1].startGcode);
  await page.reload();
  let requests = 0;
  await page.route("https://raw.githubusercontent.com/**", (route) => {
    requests++;
    return route.abort();
  });
  expect(await load()).toEqual(before);
  expect(requests).toBe(0);
});

for (const width of [1440, 390])
  test(`nozzle selection, recovery and native export at ${width}px`, async ({
    page,
  }) => {
    const phone = width === 390,
      nozzle = phone ? 0.6 : 0.2;
    await page.setViewportSize({ width, height: phone ? 844 : 1000 });
    await page.goto("./");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    const settings = { ...DEFAULT_SETTINGS, adhesion: "none", minLayerTime: 0 };
    const models = [0, 1].map((tool) => ({
      ...primitive("cube", 1),
      tool,
      scale: [0.4, 0.4, 0.12],
      position: [tool ? 10 : -10, 0, 0],
    }));
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Nozzle project.webslicer",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            name: "Nozzle project",
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
    if (phone) await button("Print setup").click();
    await page.getByRole("combobox", { name: "Printer", exact: true }).click();
    await page
      .getByRole("option", {
        name: phone ? "Snapmaker U1" : "Bambu Lab P1S + AMS",
        exact: true,
      })
      .click();
    await button("Edit printer").click();
    await page
      .getByRole("combobox", { name: "Nozzle diameter", exact: true })
      .click();
    await page
      .getByRole("option", { name: String(nozzle), exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Start G-code", exact: true }),
    ).toBeDisabled();
    await button("Save printer").click();
    await expect(
      page.getByRole("dialog", { name: "Printer configuration" }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Layer height", exact: true }),
    ).toHaveValue(`${nozzle / 2} mm`);
    await expect(
      page.getByRole("textbox", { name: "Line width", exact: true }),
    ).toHaveValue(`${phone ? "0.63" : "0.21"} mm`);
    await page.screenshot({
      animations: "disabled",
      path: `/tmp/stratum-nozzle-settings-${width}.png`,
    });
    if (phone) await page.keyboard.press("Escape");
    await expect(page.locator(".saved-indicator")).toContainText("Saved");
    await page.reload();
    if (phone) await button("Print setup").click();
    await button("Edit printer").click();
    await expect(
      page.getByRole("combobox", { name: "Nozzle diameter", exact: true }),
    ).toHaveValue(String(nozzle));
    await expect(
      page.getByRole("textbox", { name: "Start G-code", exact: true }),
    ).not.toBeDisabled();
    await page.screenshot({
      animations: "disabled",
      path: `/tmp/stratum-nozzle-dialog-${width}.png`,
    });
    await button("Cancel").click();
    if (phone) await page.keyboard.press("Escape");
    const saved = page.waitForEvent("download");
    await page.keyboard.press("ControlOrMeta+s");
    const payload = JSON.parse(
      strFromU8(gunzipSync(await readFile((await (await saved).path())!))),
    );
    expect(payload.printer.profileNozzle).toBe(nozzle);
    expect(payload.printer.nozzle).toBe(nozzle);
    expect(payload.filaments).toHaveLength(2);
    expect(payload.multiMaterial.purgeVolume).toBe(1);
    await button("Slice plate").click();
    const exporter = button(phone ? "Export G-code" : "Export print 3MF");
    await expect(exporter).toBeVisible({ timeout: 90000 });
    const pending = page.waitForEvent("download");
    await exporter.click();
    const download = await pending;
    const bytes = await readFile((await download.path())!);
    const files = phone ? undefined : unzipSync(bytes);
    const code = phone
      ? bytes.toString()
      : strFromU8(files!["Metadata/plate_1.gcode"]);
    expect(code).toContain(";STRATUM_TOOL_CHANGE:0:1");
    expect(code).toContain(`;Z:${phone ? "0.36" : "0.12"}`);
    if (phone) expect(code).toContain("; nozzle_diameter = 0.6,0.6,0.6,0.6");
    else
      expect(
        JSON.parse(strFromU8(files!["Metadata/project_settings.config"]))
          .nozzle_diameter,
      ).toEqual(["0.2"]);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/octet-stream",
      buffer: bytes,
    });
    await expect(page.locator(".preview-card-heading")).toContainText(
      phone ? "Snapmaker U1" : "Bambu Lab P1S",
    );
    await expect(page.locator(".workspace-alert")).toHaveCount(0);
  });

test("legacy 0.4 mm caches never serve a different nozzle", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const set = async (key: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    const { VENDOR_PRINTERS } = await import("/src/lib/vendor-printers.ts");
    const p = VENDOR_PRINTERS[1];
    await set(
      `vendor-templates:v1:${p.firmware}:${p.id}:${p.profileRevision}`,
      {
        startGcode: "; legacy start",
        endGcode: "; legacy end",
        toolChangeGcode: "; legacy change",
      },
    );
  });
  await page.route("https://raw.githubusercontent.com/**", (r) =>
    r.fulfill({ status: 503, body: "Unavailable" }),
  );
  const result = await page.evaluate(async () => {
    const { VENDOR_PRINTERS, loadVendorPrinter } = await import(
      "/src/lib/vendor-printers.ts"
    );
    const old = await loadVendorPrinter(VENDOR_PRINTERS[1]);
    try {
      await loadVendorPrinter({ ...old, nozzle: 0.2 });
      return { old, error: "unexpected success" };
    } catch (e) {
      return { old, error: (e as Error).message };
    }
  });
  expect(result.old.profileNozzle).toBe(0.4);
  expect(result.old.startGcode).toBe("; legacy start");
  expect(result.error).toContain("503");
});

test("failed nozzle downloads keep the current project and permit retry", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".saved-indicator")).toContainText("Saved");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("combobox", { name: "Printer", exact: true }).click();
  await page
    .getByRole("option", { name: "Bambu Lab P1S + AMS", exact: true })
    .click();
  await button("Edit printer").click();
  await page
    .getByRole("combobox", { name: "Nozzle diameter", exact: true })
    .click();
  await page.getByRole("option", { name: "0.8", exact: true }).click();
  await page.route("https://raw.githubusercontent.com/**", (r) =>
    r.fulfill({ status: 503, body: "Unavailable" }),
  );
  await button("Save printer").click();
  await expect(
    page.getByText("Could not load official printer profile (503).", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Printer configuration" }),
  ).toBeVisible();
  await button("Cancel").click();
  await button("Edit printer").click();
  await expect(
    page.getByRole("combobox", { name: "Nozzle diameter", exact: true }),
  ).toHaveValue("0.4");
  await page.unroute("https://raw.githubusercontent.com/**");
  await page
    .getByRole("combobox", { name: "Nozzle diameter", exact: true })
    .click();
  await page.getByRole("option", { name: "0.8", exact: true }).click();
  await button("Save printer").click();
  await expect(
    page.getByRole("dialog", { name: "Printer configuration" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Layer height", exact: true }),
  ).toHaveValue("0.4 mm");
});
