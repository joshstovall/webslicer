import { expect, it } from "vitest";
import {
  readProcessSettings,
  processImportPatch,
} from "../src/lib/import-process";
import { DEFAULT_SETTINGS, PRINTERS } from "../src/lib/profiles";
const read = (data: Record<string, unknown>) =>
  readProcessSettings(data, DEFAULT_SETTINGS, PRINTERS[0]);
const patch = (data: Record<string, unknown>) => {
  const report = read(data);
  return processImportPatch(
    report,
    report.entries.map((e) => e.id),
  );
};
it("transfers explicit settings with percent units, compatible enums and uniform per-tool arrays", () => {
  expect(
    patch({
      layer_height: "0.25",
      initial_layer_print_height: ".3",
      wall_loops: "4",
      top_shell_layers: 5,
      bottom_shell_layers: 3,
      sparse_infill_density: "22%",
      sparse_infill_pattern: "triangles",
      infill_direction: "45",
      infill_wall_overlap: "12%",
      wall_sequence: "outer wall/inner wall",
      seam_position: "random",
      detect_thin_wall: "1",
      spiral_mode: "0",
      travel_speed: ["180", 180],
      outer_wall_speed: ["45"],
      initial_layer_speed: "25",
      initial_layer_infill_speed: "25",
    }),
  ).toMatchObject({
    layerHeight: 0.25,
    firstLayerHeight: 0.3,
    walls: 4,
    topLayers: 5,
    bottomLayers: 3,
    infill: 22,
    infillPattern: "triangle",
    infillAngle: 45,
    infillOverlap: 12,
    wallOrder: "out-in",
    seam: "random",
    thinWalls: true,
    vase: false,
    travelSpeed: 180,
    outerSpeed: 45,
    firstLayerSpeed: 25,
    adaptive: false,
    manualLayers: false,
  });
});
it("resolves percentage widths using the source nozzle and reports mismatches", () => {
  const report = read({ line_width: "115%", nozzle_diameter: ["0.6"] });
  expect(processImportPatch(report, ["line_width"]).lineWidth).toBeCloseTo(
    0.69,
  );
  expect(report.notes.join()).toMatch(/Source nozzle: 0.6/);
  expect(patch({ line_width: "115%" }).lineWidth).toBeUndefined();
  expect(
    patch({ line_width: "115%", nozzle_diameter: [".4", ".6"] }).lineWidth,
  ).toBeUndefined();
  expect(
    patch({ line_width: ".45", nozzle_diameter: [".4", ".6"] }).lineWidth,
  ).toBe(0.45);
});
it("converts the support angle convention and resolves bottom interface inheritance", () => {
  expect(
    patch({
      enable_support: "1",
      support_type: "tree(manual)",
      support_threshold_angle: "30",
      support_interface_top_layers: "3",
      support_interface_bottom_layers: "-1",
      support_object_xy_distance: ".4",
    }),
  ).toMatchObject({
    supports: "tree-manual",
    supportAngle: 60,
    supportTopInterfaceLayers: 3,
    supportBottomInterfaceLayers: 3,
    supportOffset: 0.4,
  });
  expect(patch({ enable_support: "0", support_type: "unknown" }).supports).toBe(
    "disabled",
  );
  expect(patch({ enable_support: "1" }).supports).toBeUndefined();
  expect(patch({ support_type: "tree(auto)" }).supports).toBeUndefined();
  expect(
    patch({
      support_threshold_angle: "0",
      support_interface_bottom_layers: "-1",
    }),
  ).toEqual({});
});
it("does not clamp invalid values, silently choose unsupported options, or copy unknown fields", () => {
  const report = read(
    JSON.parse(
      '{"wall_loops":1.5,"sparse_infill_density":"120%","layer_height":null,"initial_layer_speed":"auto","seam_position":"back","sparse_infill_pattern":"lightning","machine_start_gcode":"G1 X999","__proto__":{"polluted":true}}',
    ),
  );
  expect(report.entries).toHaveLength(0);
  expect(report.skipped).toHaveLength(8);
  expect(
    processImportPatch(report, ["__proto__", "machine_start_gcode"]),
  ).toEqual({});
  expect(({} as any).polluted).toBeUndefined();
  for (const value of [
    NaN,
    Infinity,
    "NaN",
    "Infinity",
    true,
    {},
    [],
    [".2", ".3"],
    "1; alert(1)",
  ])
    expect(patch({ layer_height: value }).layerHeight).toBeUndefined();
});
it("maps general speed only when all source model regions agree", () => {
  const speeds = {
    inner_wall_speed: "60",
    sparse_infill_speed: ["60"],
    internal_solid_infill_speed: 60,
    top_surface_speed: "60",
  };
  expect(patch(speeds).speed).toBe(60);
  expect(patch({ ...speeds, top_surface_speed: 30 }).speed).toBeUndefined();
  expect(read({ ...speeds, top_surface_speed: 30 }).skipped).toHaveLength(4);
  expect(patch({ inner_wall_speed: 60 }).speed).toBeUndefined();
  expect(patch({ outer_wall_speed: ["40", "60"] }).outerSpeed).toBeUndefined();
});
it("transfers supported exclusive adhesion without collapsing combined or automatic modes", () => {
  expect(
    patch({
      brim_type: "outer_only",
      skirt_loops: "0",
      raft_layers: "0",
      brim_width: "5",
      brim_object_gap: ".2",
    }),
  ).toMatchObject({ adhesion: "brim", brimWidth: 5, brimGap: 0.2 });
  expect(
    patch({ brim_type: "no_brim", skirt_loops: "3", raft_layers: "0" }),
  ).toMatchObject({
    adhesion: "skirt",
    skirtLoops: 3,
  });
  expect(
    patch({ brim_type: "no_brim", skirt_loops: "0", raft_layers: "0" })
      .adhesion,
  ).toBe("none");
  for (const config of [
    { brim_type: "auto_brim" },
    { brim_type: "outer_only", skirt_loops: 2 },
    { brim_type: "no_brim", raft_layers: 3 },
  ])
    expect(patch(config).adhesion).toBeUndefined();
});
it("applies only selected known entries without mutating the current settings", () => {
  const before = structuredClone(DEFAULT_SETTINGS);
  const report = read({
    layer_height: 0.3,
    wall_loops: 4,
    travel_speed: 200,
    wall_generator: "arachne",
    inherits: "Some preset",
  });
  expect(processImportPatch(report, ["wall_loops", "not-a-setting"])).toEqual({
    walls: 4,
  });
  expect(DEFAULT_SETTINGS).toEqual(before);
  expect(report.skipped.map((v) => v.key)).toEqual([
    "wall_generator",
    "inherits",
  ]);
});

it("keeps different or incomplete first-layer speeds explicit in the report", () => {
  expect(patch({ initial_layer_speed: 25 }).firstLayerSpeed).toBeUndefined();
  expect(
    patch({ initial_layer_speed: 25, initial_layer_infill_speed: 50 })
      .firstLayerSpeed,
  ).toBeUndefined();
  expect(
    patch({ initial_layer_speed: [25], initial_layer_infill_speed: "25" })
      .firstLayerSpeed,
  ).toBe(25);
});

it("does not infer missing adhesion fields or crash while reporting deeply nested unknown values", () => {
  expect(
    patch({ brim_type: "outer_only", skirt_loops: 0 }).adhesion,
  ).toBeUndefined();
  let nested: unknown = "leaf";
  for (let i = 0; i < 20000; i++) nested = { nested };
  const report = read({ unknown_setting: nested });
  expect(report.skipped).toHaveLength(1);
  expect(report.skipped[0].value).toMatch(/Complex value omitted/);
});
