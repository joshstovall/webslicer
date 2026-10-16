import { describe, expect, it } from "vitest";
import { applySettingsPatch } from "../src/lib/material-settings";
import { validateProject } from "../src/lib/project";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
  materialErrors,
} from "../src/lib/multimaterial";
import { DEFAULT_SETTINGS, PRINTERS, deviceProfile } from "../src/lib/profiles";
import { applyFilamentSettings } from "../src/lib/filament-gcode";
import {
  auditThermalCommands,
  thermalErrors,
  thermalLimits,
} from "../src/lib/thermal-limits";
import { primitive } from "../src/lib/geometry";
import type { Project } from "../src/types";
const spool = {
  ...defaultFilament(DEFAULT_SETTINGS),
  name: "My spool",
  fan: 35,
  fanLayer: 4,
  flow: 0.91,
  nozzleTemp: 225,
};
const project: Project = {
  version: 1,
  name: "Materials",
  models: [primitive("cube")],
  printer: PRINTERS[0],
  settings: DEFAULT_SETTINGS,
  filaments: [spool],
  plates: [1],
  activePlate: 1,
};
const printer = (id: string) => PRINTERS.find((p) => p.id === id)!;
const wrap = (lines: string) =>
  `G90\nM83\n;STRATUM_INITIAL_TOOL:0\n;STRATUM_PRINT_BEGIN\n${lines}\n;STRATUM_PRINT_END`;
describe("material settings persistence", () => {
  it("keeps custom spool properties through process edits, but applies material presets", () => {
    const edited = applySettingsPatch(project, { speed: 45 });
    expect(edited.filaments![0]).toEqual(spool);
    expect(edited.settings).toMatchObject({
      speed: 45,
      fan: 35,
      fanLayer: 4,
      flow: 0.91,
      nozzleTemp: 225,
    });
    const preset = applySettingsPatch(edited, {
      ...DEFAULT_SETTINGS,
      fan: 80,
      fanLayer: 3,
    });
    expect(preset.filaments![0]).toMatchObject({
      name: "My spool",
      fan: 80,
      fanLayer: 3,
      flow: DEFAULT_SETTINGS.flow,
    });
  });
  it("does not overwrite multiple spools with a process preset", () => {
    const p = {
      ...project,
      filaments: [spool, { ...spool, fan: 80, fanLayer: 2 }],
    };
    const edited = applySettingsPatch(p, {
      ...DEFAULT_SETTINGS,
      speed: 75,
      bedTemp: 70,
      fan: 0,
      flow: 1.2,
    });
    expect(edited.filaments).toEqual(p.filaments);
    expect(edited.settings).toMatchObject({
      speed: 75,
      bedTemp: 70,
      fan: DEFAULT_SETTINGS.fan,
      flow: DEFAULT_SETTINGS.flow,
    });
  });
  it("migrates legacy cooling without changing spool settings and rejects invalid new values", () => {
    const migrated = validateProject({
      ...project,
      settings: { ...DEFAULT_SETTINGS, fanLayer: 5 },
      filaments: [{ ...spool, fanLayer: undefined }],
    });
    expect(migrated.filaments![0].fanLayer).toBe(5);
    expect(migrated.settings).toMatchObject({
      fanLayer: 5,
      fan: 35,
      nozzleTemp: 225,
    });
    expect(() =>
      validateProject({ ...project, filaments: [{ ...spool, fanLayer: 1.5 }] }),
    ).toThrow("fan start layer");
    expect(() =>
      validateProject({
        ...project,
        printer: { ...project.printer, mainsVoltage: 240 },
      }),
    ).toThrow("mains voltage");
    expect(
      validateProject({
        ...project,
        printer: { ...printer("bambu-x1c"), mainsVoltage: 110 },
      }).printer.mainsVoltage,
    ).toBe(110);
  });
});
describe("per-filament output", () => {
  it("uses relative extrusion for every explicit filament job", () => {
    expect(deviceProfile(PRINTERS[0], [spool]).extrudeAbs).toBe(false);
    expect(deviceProfile(PRINTERS[0], [spool]).gcodePre.join("\n")).toContain(
      "G90\nM83",
    );
  });
  it("sets Bambu part cooling per layer and preserves auxiliary/chamber fans", () => {
    const code = applyFilamentSettings(
      wrap(
        ";LAYER:0\nM106 S255\nM106 P2 S120\nM106 P3 S50\n;LAYER:1\n;LAYER:2\n;LAYER:3\n;LAYER:4",
      ),
      printer("bambu-p1s"),
      DEFAULT_SETTINGS,
      [spool],
    );
    expect(code.match(/^M106 P1 S0$/gm)).toHaveLength(1);
    expect(code.match(/^M106 P1 S89$/gm)).toHaveLength(1);
    expect(code).toContain("M106 P2 S120\nM106 P3 S50");
    expect(code).not.toContain("M106 S255");
    expect(code.match(/^M109/gm)).toHaveLength(2);
  });
  it("waits and restores active-head fan after U1 changes, with distinct start layers", () => {
    const f = [
      spool,
      { ...spool, fan: 80, fanLayer: 1, firstNozzleTemp: 245, nozzleTemp: 240 },
    ];
    const code = applyFilamentSettings(
      wrap(
        ";LAYER:0\n;STRATUM_TOOL_CHANGE:0:1\nT1\nM106 S30\n;STRATUM_TOOL_READY\n;LAYER:1\n;STRATUM_TOOL_CHANGE:1:0\nT0\n;STRATUM_TOOL_READY",
      ),
      printer("snapmaker-u1"),
      DEFAULT_SETTINGS,
      f,
    );
    expect(code).toContain(
      "M106 S30\n;STRATUM_TOOL_READY\nG90\nM83\nM109 S245 T1\nM106 S204",
    );
    expect(code).toContain("M109 S240 T1");
    expect(code).toContain("M109 S225 T0\nM106 S0");
    expect(code).not.toMatch(/M106 P/);
  });
  it("limits single-spool volume using actual emitted E and restores feed for travel/retraction", () => {
    const code = applyFilamentSettings(
      wrap(
        ";LAYER:0\nG1 X10 E1 F6000\nG1 Y10\nG1 X20 E1\nG1 E-1\nG92 X0\nG91\nG1 X10 E1\nG90\nG1 X20 E1",
      ),
      PRINTERS[0],
      DEFAULT_SETTINGS,
      [{ ...spool, maxFlow: 1 }],
    );
    const moves = code.split("\n").filter((l) => /^G1 [XY].*E/.test(l));
    expect(moves).toHaveLength(4);
    for (const move of moves) {
      const e = Number(move.match(/E([\d.]+)/)![1]);
      // First and post-travel extrusion have explicit feed; consecutive limited moves inherit it.
      const f = Number(
        move.match(/F([\d.]+)/)?.[1] ?? moves[0].match(/F([\d.]+)/)![1],
      );
      expect(e).toBeCloseTo(0.91, 5);
      expect((e * Math.PI * (1.75 / 2) ** 2 * f) / 60 / 10).toBeLessThanOrEqual(
        1,
      );
    }
    expect(code).toContain("G1 Y10 F6000");
    expect(code).toContain("G1 E-1 F6000");
    expect(() =>
      applyFilamentSettings(
        wrap("M82\nG1 X10 E1"),
        PRINTERS[0],
        DEFAULT_SETTINGS,
        [spool],
      ),
    ).toThrow("relative extrusion");
  });
});
describe("vendor thermal limits", () => {
  it("uses the documented limits, including X1C supply voltage", () => {
    for (const [id, bed] of [
      ["bambu-x1c", 110],
      ["bambu-p1s", 100],
      ["bambu-p1p", 100],
      ["bambu-a1", 100],
      ["bambu-a1-mini", 80],
      ["snapmaker-u1", 100],
    ] as const) {
      const p = printer(id),
        settings = { ...DEFAULT_SETTINGS, bedTemp: bed, firstBedTemp: bed };
      expect(thermalLimits(p)).toEqual({ nozzle: 300, bed });
      expect(
        thermalErrors(
          p,
          settings,
          [{ ...spool, nozzleTemp: 300, firstNozzleTemp: 300 }],
          [0],
        ),
      ).toEqual([]);
      expect(
        thermalErrors(
          p,
          { ...settings, firstBedTemp: bed + 1 },
          [{ ...spool, nozzleTemp: 301 }],
          [0],
        ),
      ).toHaveLength(2);
    }
    expect(
      thermalLimits({ ...printer("bambu-x1c"), mainsVoltage: 110 })!.bed,
    ).toBe(120);
    expect(
      thermalLimits({ ...printer("bambu-x1c"), mainsVoltage: 220 })!.bed,
    ).toBe(110);
  });
  it("validates active materials, shared bed, and flow/cooling before slicing", () => {
    const p = printer("snapmaker-u1"),
      bad = { ...spool, nozzleTemp: 350, fanLayer: 0, maxFlow: 0 };
    expect(
      materialErrors(
        project.models,
        p,
        [spool, bad],
        DEFAULT_SETTINGS,
        DEFAULT_MULTI_MATERIAL,
      ),
    ).toEqual([]);
    const errors = materialErrors(
      [{ ...project.models[0], tool: 1 }],
      p,
      [spool, bad],
      DEFAULT_SETTINGS,
      DEFAULT_MULTI_MATERIAL,
    ).join();
    expect(errors).toContain("temperature");
    expect(errors).toContain("flow");
    expect(errors).toContain("cooling");
  });
  it("audits compiled explicit heater commands, ignoring comments and allowing heater-off", () => {
    const p = printer("bambu-a1-mini");
    expect(() =>
      auditThermalCommands(
        "; M109 S999\nM104 S0\nM109 S300 H300\nM190 R80 ; S999\nM106 S255",
        p,
      ),
    ).not.toThrow();
    for (const code of [
      "M109 S301",
      "M104.1 S350",
      "M190 R81",
      "M140 S-1",
      "M109 S220 H310",
      "m104s+301",
      "N123 M140S81*0",
    ])
      expect(() => auditThermalCommands(code, p)).toThrow("outside");
  });
});
