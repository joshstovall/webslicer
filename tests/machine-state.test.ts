import { expect, it } from "vitest";
import { compileMachineGcode } from "../src/lib/machine-gcode";
import { DEFAULT_SETTINGS } from "../src/lib/profiles";
import { VENDOR_PRINTERS } from "../src/lib/vendor-printers";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../src/lib/multimaterial";
const filaments = [
  defaultFilament(DEFAULT_SETTINGS),
  {
    ...defaultFilament(DEFAULT_SETTINGS, 1),
    nozzleTemp: 220,
    firstNozzleTemp: 225,
  },
];
const plan = (height = 200) =>
  [
    ";STRATUM_INITIAL_TOOL:0",
    "G90",
    "M83",
    ";STRATUM_PRINT_BEGIN",
    ";LAYER:0",
    "G1 X20 Y30 Z0.2 F1200",
    "G1 X30 E1",
    "G1 E-0.8 F2400",
    ";STRATUM_TOOL_CHANGE:0:1",
    "T1",
    ";STRATUM_TOOL_READY",
    "G1 E0.8 F2400",
    "G1 Y40 E1 F1500",
    ";LAYER:1",
    `G1 Z${height} F600`,
    "G1 X40 E1 F1200",
    "G1 E-0.8 F2400",
    ";STRATUM_TOOL_CHANGE:1:0",
    "T0",
    ";STRATUM_TOOL_READY",
    "G1 E0.8 F2400",
    "G1 Y50 E1 F1500",
    ";STRATUM_PRINT_END",
  ].join("\n");
const bambu = {
  ...VENDOR_PRINTERS[0],
  startGcode: "G90\nM83",
  toolChangeGcode: "G1 Z{max_layer_z + 3} F1200\nT{next_extruder}",
  endGcode: "; printed height {max_layer_z}",
};
it("Bambu change clearance follows already printed layers rather than future model height", () => {
  const output = compileMachineGcode(
    plan(),
    bambu,
    DEFAULT_SETTINGS,
    filaments,
    DEFAULT_MULTI_MATERIAL,
  );
  const changes = [
    ...output.matchAll(
      /;STRATUM_MACHINE_CHANGE_BEGIN\n([\s\S]*?);STRATUM_MACHINE_CHANGE_END/g,
    ),
  ].map((m) => m[1]);
  expect(changes[0]).toContain("G1 Z3.2 F1200");
  expect(changes[1]).toContain("G1 Z203 F1200");
  expect(output).toContain("; printed height 200");
  expect(changes[0]).toContain("G1 X30 Y30");
  expect(changes[0]).toContain("G1 Z0.2 F600");
  expect(changes[0]).toContain("G1 F2400");
});
it("Bambu tool-change clearance stays below the machine Z limit on tall prints", () => {
  const output = compileMachineGcode(
    plan(255),
    bambu,
    DEFAULT_SETTINGS,
    filaments,
    DEFAULT_MULTI_MATERIAL,
  );
  const changes = [
    ...output.matchAll(
      /;STRATUM_MACHINE_CHANGE_BEGIN\n([\s\S]*?);STRATUM_MACHINE_CHANGE_END/g,
    ),
  ].map((m) => m[1]);
  expect(changes[1]).toContain("G1 Z256 F1200");
  expect(output).toContain("; printed height 255");
});
it("U1 waits for the selected head's layer temperature before priming it", () => {
  const u1 = {
    ...VENDOR_PRINTERS[5],
    startGcode: "G90\nM83",
    toolChangeGcode: "official adapter",
    endGcode: "PRINT_END",
  };
  const output = compileMachineGcode(
    plan(2),
    u1,
    DEFAULT_SETTINGS,
    filaments,
    DEFAULT_MULTI_MATERIAL,
  );
  const changes = [
    ...output.matchAll(
      /;STRATUM_MACHINE_CHANGE_BEGIN\n([\s\S]*?);STRATUM_MACHINE_CHANGE_END/g,
    ),
  ].map((m) => m[1]);
  expect(changes[0].indexOf("M109 S225 T1")).toBeGreaterThanOrEqual(0);
  expect(changes[0].indexOf("M109 S225 T1")).toBeLessThan(
    changes[0].indexOf("SM_PRINT_PREEXTRUDE_FILAMENT"),
  );
  expect(changes[1]).toContain(`M109 S${filaments[0].nozzleTemp} T0`);
});
it("U1 keeps a separate parked retraction for every head and matches the planner when returning", () => {
  const u1 = {
    ...VENDOR_PRINTERS[5],
    startGcode: "G90\nM83",
    toolChangeGcode: "official adapter",
    endGcode: "PRINT_END",
  };
  const output = compileMachineGcode(
    plan(2),
    u1,
    DEFAULT_SETTINGS,
    filaments,
    DEFAULT_MULTI_MATERIAL,
  );
  const changes = [
    ...output.matchAll(
      /;STRATUM_MACHINE_CHANGE_BEGIN\n([\s\S]*?);STRATUM_MACHINE_CHANGE_END/g,
    ),
  ].map((m) => m[1]);
  expect(changes[0]).toContain("G1 E-9.2 F1800 ; park head");
  expect(changes[0]).toContain("G1 E-0.8 F1800 ; match planned retraction");
  expect(changes[1]).toContain("G1 E9.2 F1800 ; match planned retraction");
  const debt = new Map<number, number>();
  let tool = 0;
  const ready: number[] = [];
  for (const line of output.split("\n")) {
    const select = line.match(/^T(\d+)$/);
    if (select) tool = Number(select[1]);
    const e = line.match(/^G1\s.*?\bE(-?[\d.]+)/);
    if (e) debt.set(tool, Math.max(0, (debt.get(tool) ?? 0) - Number(e[1])));
    if (line === ";STRATUM_TOOL_READY") ready.push(debt.get(tool) ?? 0);
  }
  expect(ready).toEqual([expect.closeTo(0.8), expect.closeTo(0.8)]);
  expect(debt.get(0)).toBeCloseTo(0);
  expect(debt.get(1)).toBeCloseTo(10);
});
it("Bambu's final macro retraction matches zero or partial planner debt, and calibration uses the incoming material", () => {
  const p = {
    ...bambu,
    toolChangeGcode:
      "T{next_extruder}\n; requested retract {new_retract_length_toolchange}\n; calibration flow {outer_wall_volumetric_speed}",
  };
  const output = compileMachineGcode(
    plan().replaceAll("G1 E-0.8 F2400", "G1 E-0.3 F2400"),
    p,
    DEFAULT_SETTINGS,
    [filaments[0], { ...filaments[1], maxFlow: 0.5 }],
    DEFAULT_MULTI_MATERIAL,
  );
  expect(output).toContain("; requested retract 0.3");
  expect(output).toContain("; calibration flow 0.5");
  const noRetract = compileMachineGcode(
    plan().replaceAll("G1 E-0.8 F2400", ""),
    p,
    DEFAULT_SETTINGS,
    filaments,
    DEFAULT_MULTI_MATERIAL,
  );
  expect(noRetract).toContain("; requested retract 0\n");
});
it("returning from a station reestablishes Z clearance before crossing XY, restores feed, and respects relative planner moves", () => {
  const moved = plan(2).replace(
    ";STRATUM_TOOL_CHANGE:0:1",
    "G91\nG1 X2 Y3\n;STRATUM_TOOL_CHANGE:0:1",
  );
  const output = compileMachineGcode(
    moved,
    { ...bambu, toolChangeGcode: "T{next_extruder}\nG1 Z0.1 F600" },
    DEFAULT_SETTINGS,
    filaments,
    DEFAULT_MULTI_MATERIAL,
  );
  const change = output.match(
    /;STRATUM_MACHINE_CHANGE_BEGIN\n([\s\S]*?);STRATUM_MACHINE_CHANGE_END/,
  )![1];
  expect(change).toContain(
    "G1 Z3.2 F600\nG1 X32 Y33 F9000\nG1 Z0.2 F600\nG1 F2400\nG91",
  );
});

it("absolute extrusion and coordinate resets survive a machine change without losing the pending unretract", () => {
  const source = plan(2)
    .replace(";LAYER:0", ";LAYER:0\nM82\nG92 E100")
    .replace("G1 X30 E1", "G1 X30 E101")
    .replace("G1 E-0.8 F2400", "G1 E100.2 F2400\nG92 X12 Y13")
    .replace("G1 E0.8 F2400", "G1 E101 F2400");
  const output = compileMachineGcode(
    source,
    {
      ...bambu,
      toolChangeGcode:
        "M83\nG92 E0\nT{next_extruder}\n; debt {new_retract_length_toolchange}",
    },
    DEFAULT_SETTINGS,
    filaments,
    DEFAULT_MULTI_MATERIAL,
  );
  const change = output.match(
    /;STRATUM_MACHINE_CHANGE_BEGIN\n([\s\S]*?);STRATUM_MACHINE_CHANGE_END/,
  )![1];
  expect(change).toContain("; debt 0.8");
  expect(change).toContain("G1 X12 Y13 F9000");
  expect(change).toContain("G92 E100.2\nM82");
});
