import { expect, it } from "vitest";
import {
  applyLayerCooling,
  fanSpeedAtLayer,
  validCoolingSettings,
} from "../src/lib/cooling";
import { applyFilamentSettings } from "../src/lib/filament-gcode";
import { defaultFilament } from "../src/lib/multimaterial";
import { DEFAULT_SETTINGS as settings, PRINTERS } from "../src/lib/profiles";
import { parseGcode } from "../src/lib/gcode";
import { applySettingsPatch } from "../src/lib/material-settings";
import { validateProject } from "../src/lib/project";
const p = PRINTERS.find((p) => p.id === "generic-multi")!;
const f = { ...defaultFilament(settings), minLayerTime: 10, minPrintSpeed: 1 };
const wrap = (code: string) =>
  `G90\nM83\n;STRATUM_INITIAL_TOOL:0\n;STRATUM_PRINT_BEGIN\n;LAYER:0\n${code}\n;STRATUM_PRINT_END`;
const cool = (code: string, filaments = [f], s = settings, printer = p) =>
  applyLayerCooling(wrap(code), printer, s, filaments);
const seconds = (code: string) => parseGcode(code).seconds;

it("ramps each fan from its own one-based start layer and restores it after switches", () => {
  const a = { ...f, fan: 90, fanLayer: 3, fanRampLayers: 3 };
  expect(
    [1, 2, 3, 4, 5, 6].map((n) => fanSpeedAtLayer(a, settings, n)),
  ).toEqual([0, 0, 77, 153, 230, 230]);
  const b = { ...f, fan: 60, fanLayer: 1, fanRampLayers: 2 };
  const code = applyFilamentSettings(
    wrap(
      ";STRATUM_TOOL_CHANGE:0:1\nT1\n;STRATUM_TOOL_READY\n;LAYER:1\n;STRATUM_TOOL_CHANGE:1:0\nT0\n;STRATUM_TOOL_READY\n;LAYER:2",
    ),
    PRINTERS.find((p) => p.id === "bambu-p1s")!,
    settings,
    [a, b],
  );
  expect(code).toContain("M106 P1 S77");
  expect(code).toContain("M106 P1 S153");
  expect(code).toContain("M109 S210\nM106 P1 S0");
});
it("uses the longest participating spool target once for the entire layer, including travel", () => {
  const result = cool(
    "G1 X10 E1 F6000\nG1 Y100 F6000\n;STRATUM_TOOL_CHANGE:0:1\nT1\n;STRATUM_TOOL_READY\nG1 X20 E1 F6000",
    [f, { ...f, minLayerTime: 12 }],
  );
  expect(seconds(result.gcode)).toBeGreaterThanOrEqual(12);
  expect(seconds(result.gcode)).toBeLessThan(12.02);
  expect(result.gcode).not.toContain("STRATUM_COOLING_WAIT");
  expect(result.warnings).toEqual([]);
});
it("rewrites repeated explicit feeds even when the preceding cooled speed is identical", () => {
  const result = cool("G1 X10 E1 F6000\nG1 X20 E1 F6000\nG1 X30 E1 F6000");
  expect(seconds(result.gcode)).toBeGreaterThanOrEqual(10);
  expect(seconds(result.gcode)).toBeLessThan(10.01);
  const speeds = result.gcode.match(/G1 X\d+ E1 F([\d.]+)/g)!;
  expect(speeds).toHaveLength(3);
  expect(speeds.every((s) => s.endsWith("F180"))).toBe(true);
});
it("never raises an already flow-limited print speed and waits after a bounded lift", () => {
  const result = cool("G1 X1 Z0.2 E1 F60", [
    { ...f, minPrintSpeed: 10, minLayerTime: 4 },
  ]);
  expect(result.gcode).toContain("G1 X1 Z0.2 E1 F60");
  expect(result.gcode).toContain("G1 Z2.20000 F600");
  expect(result.gcode).toContain("G1 Z0.20000 F600");
  expect(result.gcode).toContain("G1 E-0.80000 F2100");
  expect(result.gcode).toContain("G1 E0.80000 F2100");
  expect(result.gcode).toContain("G1 F60\n;STRATUM_COOLING_RESUME");
  expect(seconds(result.gcode)).toBeGreaterThanOrEqual(4);
});
it("counts fixed travel, retraction and existing dwell without slowing them", () => {
  const original = "G1 X10 E1 F6000\nG1 Y100 F6000\nG1 E-1 F60\nG4 P1000";
  const result = cool(original, [{ ...f, minLayerTime: 3 }]);
  expect(result.gcode).toContain(original);
  expect(result.gcode).not.toContain("STRATUM_COOLING_WAIT");
});
it("preserves per-tool retraction debt, relative XYZ, coordinate resets and feed across cooling", () => {
  const original =
    "G1 X1 Z0.2 E0.1 F600\nG92 Z0\nG91\nG1 X1 E0.1\nG1 E-0.8 F2100";
  const result = cool(original, [{ ...f, minLayerTime: 6, minPrintSpeed: 10 }]);
  const waiting = result.gcode.split(";STRATUM_COOLING_WAIT")[1];
  expect(waiting).toBeTruthy();
  expect(waiting).not.toMatch(/G1 E/);
  expect(waiting).toContain("G1 Z2.00000 F600");
  expect(waiting).toContain("G1 Z0.00000 F600\nG91\nG1 F2100");
  expect(parseGcode(result.gcode).filament).toBeCloseTo(
    parseGcode(wrap(original)).filament,
    6,
  );
});
it("excludes opaque tool-change time and restores incoming motion feed before a custom change", () => {
  const original =
    "G1 X1 E0.1 F6000\n;STRATUM_TOOL_CHANGE:0:1\nG4 P500000\nT1\n;STRATUM_TOOL_READY\nG1 X2 E0.1 F6000";
  const result = cool(original, [f, { ...f, minPrintSpeed: 10 }]);
  expect(result.gcode).toContain(
    "G1 F6000\n;STRATUM_TOOL_CHANGE:0:1\nG4 P500000\nT1\n;STRATUM_TOOL_READY",
  );
  expect(result.gcode).toContain("STRATUM_COOLING_WAIT");
  expect(seconds(result.gcode)).toBeGreaterThan(510);
});
it("reports unattainable targets without exceeding the Z ceiling or breaking a continuous vase", () => {
  for (const s of [settings, { ...settings, vase: true }]) {
    const result = cool(
      "G1 X1 Z0.2 E0.1 F600",
      [{ ...f, minLayerTime: 20, minPrintSpeed: 10 }],
      s,
      { ...p, bed: [256, 256, s.vase ? 256 : 0.4] },
    );
    expect(result.gcode).not.toContain("STRATUM_COOLING_WAIT");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      s.vase ? "spiral vase" : "safe cooling lift",
    );
  }
});
it("keeps zero-target layers fast and rejects malformed cooling values and non-mm planned moves", () => {
  const result = cool("G1 X10 E1 F6000", [{ ...f, minLayerTime: 0 }]);
  expect(result.gcode).toContain("G1 X10 E1 F6000");
  expect(result.gcode).not.toContain("STRATUM_COOLING_WAIT");
  for (const patch of [
    { minLayerTime: NaN },
    { minLayerTime: -1 },
    { minLayerTime: 121 },
    { minPrintSpeed: 0 },
    { minPrintSpeed: 101 },
    { fanRampLayers: 0 },
    { fanRampLayers: 1.5 },
    { minLayerTime: null },
  ])
    expect(validCoolingSettings({ ...f, ...patch } as typeof f, settings)).toBe(
      false,
    );
  expect(() => cool("G20\nG1 X1 E1 F600")).toThrow("millimeters");
});
it("persists cooling in single-material presets and keeps multiple spools independent", () => {
  const project = {
    version: 1 as const,
    name: "Cooling",
    plates: [1],
    activePlate: 1,
    models: [],
    printer: p,
    settings,
    filaments: [f],
  };
  const updated = applySettingsPatch(project, {
    minLayerTime: 15,
    minPrintSpeed: 7,
    fanRampLayers: 4,
  });
  expect(updated.filaments![0]).toMatchObject({
    minLayerTime: 15,
    minPrintSpeed: 7,
    fanRampLayers: 4,
  });
  expect(validateProject(updated).settings).toMatchObject({
    minLayerTime: 15,
    minPrintSpeed: 7,
    fanRampLayers: 4,
  });
  const multiple = {
    ...project,
    filaments: [f, { ...f, minLayerTime: 6, fanRampLayers: 3 }],
  };
  expect(
    applySettingsPatch(multiple, {
      minLayerTime: 100,
      minPrintSpeed: 50,
      fanRampLayers: 10,
    }).filaments,
  ).toEqual(multiple.filaments);
  expect(() =>
    validateProject({ ...project, filaments: [{ ...f, minPrintSpeed: null }] }),
  ).toThrow("layer cooling");
});

it("does not borrow parked-head retraction debt when cooling a different tool", () => {
  const result = cool(
    "G1 X1 E0.1 F600\nG1 E-0.8 F2100\n;STRATUM_TOOL_CHANGE:0:1\nT1\n;STRATUM_TOOL_READY\nG1 X2 E0.1 F600",
    [
      { ...f, minPrintSpeed: 10 },
      { ...f, minPrintSpeed: 10 },
    ],
  );
  const wait = result.gcode.split(";STRATUM_COOLING_WAIT")[1];
  expect(wait).toContain("G1 E-0.80000 F2100");
  expect(wait).toContain("G1 E0.80000 F2100");
  const back = cool(
    "G1 X1 E0.1 F600\nG1 E-0.8 F2100\n;STRATUM_TOOL_CHANGE:0:1\nT1\n;STRATUM_TOOL_READY\nG1 X2 E0.1 F600\n;STRATUM_TOOL_CHANGE:1:0\nT0\n;STRATUM_TOOL_READY",
    [
      { ...f, minPrintSpeed: 10 },
      { ...f, minPrintSpeed: 10 },
    ],
  );
  expect(back.gcode.split(";STRATUM_COOLING_WAIT")[1]).not.toMatch(/G1 E/);
});
