import { expect, it, vi, afterEach } from "vitest";
import { VENDOR_PRINTERS } from "../src/lib/vendor-printers";
import { DEFAULT_SETTINGS as s } from "../src/lib/profiles";
import {
  VENDOR_NOZZLES,
  vendorNozzleLimits,
  nozzleProfileErrors,
  nozzleSettings,
  applyPrinter,
} from "../src/lib/nozzle-profiles";
import { validateProject } from "../src/lib/project";
import { compileMachineGcode } from "../src/lib/machine-gcode";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../src/lib/multimaterial";
import type { Project } from "../src/types";

afterEach(() => vi.unstubAllGlobals());
it("all 24 official variants have bounded geometry defaults and vendor retraction", () => {
  for (const preset of VENDOR_PRINTERS)
    for (const [i, nozzle] of VENDOR_NOZZLES.entries()) {
      const p = { ...preset, nozzle, profileNozzle: nozzle };
      const settings = { ...s, ...nozzleSettings(p), adaptive: true };
      expect(nozzleProfileErrors(p, settings)).toEqual([]);
      expect(vendorNozzleLimits(p)).toEqual({
        min: [0.04, 0.08, 0.12, 0.16][i],
        max:
          p.firmware === "snapmaker-u1" && nozzle === 0.4
            ? 0.32
            : [0.14, 0.28, 0.42, 0.56][i],
      });
      expect(settings.retraction).toBe(
        p.firmware === "snapmaker-u1"
          ? [0.4, 1.5, 1.4, 1.5][i]
          : p.id === "bambu-a1"
            ? 0.8
            : [0.4, 0.8, 1.4, 3][i],
      );
      expect(
        nozzleProfileErrors(p, { ...settings, layerHeight: nozzle }),
      ).toEqual([expect.stringContaining("Layer height must")]);
      expect(
        nozzleProfileErrors(p, { ...settings, firstLayerHeight: 0.01 }),
      ).toEqual([expect.stringContaining("First-layer height must")]);
      expect(
        nozzleProfileErrors(p, { ...settings, minLayerHeight: 0.01 }),
      ).toEqual([expect.stringContaining("Adaptive minimum")]);
      expect(
        nozzleProfileErrors(p, { ...settings, lineWidth: nozzle * 3 }),
      ).toEqual([expect.stringContaining("Line width")]);
    }
});
it("legacy 0.4 mm code remains valid but a mismatched nozzle cannot compile", () => {
  const p = VENDOR_PRINTERS[1];
  expect(nozzleProfileErrors(p, s)).toEqual([]);
  const changed = { ...p, nozzle: 0.2 };
  expect(nozzleProfileErrors(changed)).toEqual([
    expect.stringContaining("different nozzle"),
  ]);
  expect(() =>
    compileMachineGcode(
      "",
      changed,
      s,
      [defaultFilament(s)],
      DEFAULT_MULTI_MATERIAL,
    ),
  ).toThrow("different nozzle");
  expect(nozzleProfileErrors({ ...p, nozzle: 0.25 })).toEqual([
    expect.stringContaining("supported official"),
  ]);
  expect(nozzleProfileErrors({ ...p, filament: 2.85 })).toEqual([
    expect.stringContaining("1.75 mm"),
  ]);
});
it("changing a nozzle preserves spools, hardware, budgets and unrelated settings", () => {
  const project: Project = {
    version: 1,
    name: "Nozzles",
    plates: [1],
    activePlate: 1,
    models: [],
    printer: { ...VENDOR_PRINTERS[5], hardware: { abrasiveTools: [0, 3] } },
    settings: { ...s, infill: 37 },
    filaments: [defaultFilament(s)],
    multiMaterial: { ...DEFAULT_MULTI_MATERIAL, purgeVolumes: { "0:1": 25 } },
  };
  const p = { ...project.printer, nozzle: 0.6, profileNozzle: 0.6 };
  const updated = applyPrinter(project, p);
  expect(updated.settings).toMatchObject({
    layerHeight: 0.3,
    firstLayerHeight: 0.36,
    lineWidth: 0.63,
    minLayerHeight: 0.12,
    supportOffset: 0.6,
    retraction: 1.4,
    infill: 37,
  });
  expect(updated.filaments).toBe(project.filaments);
  expect(updated.multiMaterial).toBe(project.multiMaterial);
  expect(updated.printer.hardware).toBe(project.printer.hardware);
  expect(applyPrinter(updated, { ...p, name: "Renamed" }).settings).toBe(
    updated.settings,
  );
  expect(validateProject(structuredClone(updated)).printer.profileNozzle).toBe(
    0.6,
  );
  for (const value of [null, "0.6", 0.3, NaN])
    expect(() =>
      validateProject({ ...updated, printer: { ...p, profileNozzle: value } }),
    ).toThrow("nozzle profile metadata");
});
it("loads inherited Bambu sequences by nozzle and does not mutate stale inputs on failure", async () => {
  vi.resetModules();
  const { loadVendorPrinter } = await import("../src/lib/vendor-printers");
  const fetcher = vi.fn(async (url: string) => {
    const name = decodeURIComponent(url.split("/").at(-1)!);
    const nozzle = name.includes("0.2") ? 0.2 : 0.4;
    let data: object;
    if (name.includes("template")) {
      const key = name.slice(name.indexOf("template ") + 9, -5);
      data = { [key]: `; ${nozzle} ${key}\nG90` };
    } else
      data = {
        nozzle_diameter: [String(nozzle)],
        include: (nozzle === 0.2
          ? ["machine_start_gcode"]
          : [
              "machine_start_gcode",
              "machine_end_gcode",
              "change_filament_gcode",
            ]
        ).map((k) => `Bambu Lab P1S ${nozzle} nozzle template ${k}`),
      };
    return new Response(JSON.stringify(data));
  });
  vi.stubGlobal("fetch", fetcher);
  const original = {
    ...VENDOR_PRINTERS[1],
    startGcode: "old start",
    endGcode: "old end",
    toolChangeGcode: "old change",
  };
  const changed = await loadVendorPrinter({ ...original, nozzle: 0.2 });
  expect(changed.startGcode).toContain("0.2 machine_start_gcode");
  expect(changed.endGcode).toContain("0.4 machine_end_gcode");
  expect(changed.profileNozzle).toBe(0.2);
  expect(decodeURIComponent(changed.profileSource!)).toContain(
    "P1S 0.2 nozzle.json",
  );
  fetcher.mockClear();
  expect(
    (await loadVendorPrinter({ ...VENDOR_PRINTERS[1], nozzle: 0.2 }))
      .startGcode,
  ).toBe(changed.startGcode);
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Unavailable", { status: 503 })),
  );
  await expect(loadVendorPrinter({ ...original, nozzle: 0.6 })).rejects.toThrow(
    "503",
  );
  expect(original.startGcode).toBe("old start");
  expect(original.nozzle).toBe(0.4);
});
