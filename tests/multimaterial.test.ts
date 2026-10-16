import { describe, it, expect } from "vitest";
import { parseGcode } from "../src/lib/gcode";
import { applyFilamentSettings } from "../src/lib/filament-gcode";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
  materialErrors,
} from "../src/lib/multimaterial";
import { DEFAULT_SETTINGS, PRINTERS } from "../src/lib/profiles";
import { validateProject } from "../src/lib/project";
import { primitive } from "../src/lib/geometry";
const printer = {
  ...PRINTERS[0],
  toolCount: 4,
  multiMaterialMode: "toolchanger" as const,
};
const filaments = [
  defaultFilament(DEFAULT_SETTINGS),
  {
    ...defaultFilament(DEFAULT_SETTINGS, 1),
    nozzleTemp: 240,
    firstNozzleTemp: 245,
    flow: 0.9,
    maxFlow: 5,
    cost: 50,
  },
];
describe("multi-material G-code", () => {
  it("tracks separate absolute E registers, retractions and special Bambu tool commands", () => {
    const result = parseGcode(
      "M82\nG1 Z0.2\nT0\nG1 X10 E10\nG1 E9\nT1\nG1 Y10 E5\nT0\nG1 E10\nG1 X20 E12\nT255\nT1000",
      { diameter: 1.75, density: 1.24, cost: 25, filaments },
    );
    expect(result.tools.map((t) => [t.tool, t.filament])).toEqual([
      [0, 12],
      [1, 5],
    ]);
    expect(result.toolChanges).toBe(2);
    expect(result.layers[0].tools).toContain(1);
    expect(result.cost).toBeCloseTo(
      result.tools.reduce((a, t) => a + t.cost, 0),
    );
  });
  it("excludes startup purge lines from layer preview but includes consumed material", () => {
    const result = parseGcode(
      "M83\nG1 Z0.2\nG1 X100 E10\n;LAYER:0\nG1 Z0.24\nG1 X20 E2\n;STRATUM_PRINT_END\nG1 X10 E1",
    );
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].z).toBe(0.24);
    expect(result.filament).toBe(13);
  });
  it("sets each tool temperature and limits its extrusion flow without rewriting startup", () => {
    const code = applyFilamentSettings(
      "M109 S140\n;STRATUM_INITIAL_TOOL:0\nM83\n;STRATUM_PRINT_BEGIN\n;LAYER:0\nG1 X10 Y0 E1 F6000\n;STRATUM_TOOL_CHANGE:0:1\nT1\n;STRATUM_TOOL_READY\nG1 X20 E1\n;LAYER:1\nG1 X30 E1\n;STRATUM_PRINT_END\nM104 S0",
      printer,
      DEFAULT_SETTINGS,
      filaments,
    );
    expect(code).toContain("M109 S140");
    expect(code).toContain("M109 S245 T1");
    expect(code).toContain("M109 S240 T1");
    expect(code).toContain("E0.90000");
    const moves = code.split("\n").filter((l) => /^G1 X20/.test(l));
    const feed = Number(moves[0].match(/F([\d.]+)/)?.[1]);
    expect(feed).toBeGreaterThan(0);
    expect(feed).toBeLessThan(1500);
    expect(code).toContain("M104 S0");
  });
  it("requires assigned slots and rejects incompatible vase/shared-nozzle settings", () => {
    const model = { ...primitive("cube"), tool: 2 };
    expect(
      materialErrors(
        [model],
        printer,
        filaments,
        DEFAULT_SETTINGS,
        DEFAULT_MULTI_MATERIAL,
      ),
    ).toContain("Filament 3 is not configured for this printer.");
    const pair = [
      { ...model, tool: 0 },
      { ...model, tool: 1 },
    ];
    expect(
      materialErrors(
        pair,
        printer,
        filaments,
        { ...DEFAULT_SETTINGS, vase: true },
        DEFAULT_MULTI_MATERIAL,
      ).join(),
    ).toContain("Spiral vase");
    expect(
      materialErrors(
        pair,
        { ...printer, multiMaterialMode: "shared-nozzle" },
        filaments,
        DEFAULT_SETTINGS,
        { ...DEFAULT_MULTI_MATERIAL, purgeTower: false },
      ).join(),
    ).toContain("purge tower");
  });
  it("migrates old projects and round-trips material assignments while rejecting malformed tools", () => {
    const old = {
      version: 1,
      name: "legacy",
      models: [primitive("cube")],
      printer,
      settings: DEFAULT_SETTINGS,
      plates: [1],
      activePlate: 1,
    };
    const migrated = validateProject(old);
    expect(migrated.models[0].tool).toBe(0);
    expect(migrated.filaments).toHaveLength(1);
    const project = {
      ...old,
      filaments,
      models: [{ ...old.models[0], tool: 1 }],
      multiMaterial: DEFAULT_MULTI_MATERIAL,
    };
    expect(validateProject(project).models[0].tool).toBe(1);
    expect(() =>
      validateProject({ ...project, models: [{ ...old.models[0], tool: -1 }] }),
    ).toThrow("filament assignment");
    expect(() =>
      validateProject({
        ...project,
        filaments: [{ ...filaments[0], flow: NaN }],
      }),
    ).toThrow("filament flow");
  });
});
