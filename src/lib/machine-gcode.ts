import type {
  Filament,
  MultiMaterialSettings,
  Printer,
  Settings,
} from "../types";
import { parseGcode } from "./gcode";
import { renderGcodeTemplate, type TemplateContext } from "./gcode-template";

/** Expand vendor templates after path planning, when positions and tool order are known. */
export function compileMachineGcode(
  gcode: string,
  printer: Printer,
  settings: Settings,
  filaments: Filament[],
  multi: MultiMaterialSettings,
): string {
  if (!printer.firmware) return gcode;
  if (!printer.startGcode || !printer.endGcode || !printer.toolChangeGcode)
    throw new Error("Load the official machine profile before slicing.");
  const initial = Number(gcode.match(/;STRATUM_INITIAL_TOOL:(\d+)/)?.[1] ?? 0);
  const planned = parseGcode(gcode);
  const totalLayers = planned.layers.length;
  const firstLayer = planned.layers[0];
  const mins = [Infinity, Infinity],
    maxs = [-Infinity, -Infinity];
  if (firstLayer)
    for (let i = 0; i < firstLayer.features.length; i++) {
      if (firstLayer.features[i] === 4) continue;
      for (const endpoint of [0, 3])
        for (let axis = 0; axis < 2; axis++) {
          const value = firstLayer.segments[i * 6 + endpoint + axis];
          mins[axis] = Math.min(mins[axis], value);
          maxs[axis] = Math.max(maxs[axis], value);
        }
    }
  if (!mins.every(Number.isFinite))
    throw new Error("The machine profile requires printable paths.");
  const temperatures = filaments.map((f) => f.nozzleTemp),
    firstTemps = filaments.map((f) => f.firstNozzleTemp);
  const area = Math.PI * (printer.filament / 2) ** 2;
  const context: TemplateContext = {
    initial_extruder: initial,
    initial_no_support_extruder: initial,
    initial_tool: initial,
    total_layer_count: totalLayers,
    layer_num: 0,
    layer_z: settings.firstLayerHeight,
    max_layer_z: Math.max(...planned.layers.map((l) => l.z)),
    max_print_height: printer.bed[2],
    z_offset: 0,
    nozzle_diameter: printer.nozzle,
    nozzle_temperature: temperatures,
    nozzle_temperature_initial_layer: firstTemps,
    nozzle_temperature_range_high: temperatures.map((t) =>
      Math.min(t + 10, 300),
    ),
    temperature: temperatures,
    first_layer_temperature: firstTemps,
    bed_temperature: filaments.map(() => settings.bedTemp),
    bed_temperature_initial_layer: filaments.map(() => settings.firstBedTemp),
    bed_temperature_initial_layer_single: settings.firstBedTemp,
    filament_type: filaments.map((f) => f.material),
    retraction_length: filaments.map(() => settings.retraction),
    flush_temperatures: temperatures.map((t) => Math.min(t + 10, 300)),
    flush_volumetric_speeds: filaments.map((f) => Math.min(f.maxFlow, 10)),
    long_retractions_when_cut: filaments.map(() => false),
    retraction_distances_when_cut: filaments.map(() => 0),
    curr_bed_type: printer.bedType ?? "Textured PEI Plate",
    scan_first_layer: false,
    chamber_cooling_mode: 1,
    print_sequence: "by layer",
    spiral_mode: settings.vase,
    timelapse_type: 0,
    default_acceleration: 3000,
    initial_layer_acceleration: 500,
    outer_wall_acceleration: 1000,
    initial_layer_print_height: settings.firstLayerHeight,
    outer_wall_volumetric_speed: Math.min(
      settings.outerSpeed * settings.lineWidth * settings.layerHeight,
      filaments[initial].maxFlow,
    ),
    travel_speed: settings.travelSpeed,
    first_layer_print_min: mins,
    first_layer_print_size: maxs.map((v, i) => v - mins[i]),
    first_layer_center_no_wipe_tower: maxs.map((v, i) => (v + mins[i]) / 2),
    next_extruder: initial,
    previous_extruder: initial,
    toolchange_count: 0,
    old_retract_length_toolchange: settings.retraction,
    new_retract_length_toolchange: settings.retraction,
    position: [0, 0, 0],
  };
  let x = 0,
    y = 0,
    z = 0,
    feed = settings.travelSpeed * 60,
    layer = -1,
    changes = 0;
  let skippingStart = false,
    skippingChange = false;
  const output = [
    `; Stratum machine profile: ${printer.name}`,
    `; Profile source: ${printer.profileSource}`,
    `; Profile revision: ${printer.profileRevision}`,
  ];
  const number = (v: number) => Number(v.toFixed(4));
  for (const line of gcode.split(/\r?\n/)) {
    if (line.startsWith(";STRATUM_INITIAL_TOOL:")) {
      output.push(
        renderGcodeTemplate(printer.startGcode, context),
        "G90",
        "M83",
        "G92 E0",
      );
      skippingStart = true;
      continue;
    }
    if (line === ";STRATUM_PRINT_BEGIN") {
      skippingStart = false;
      output.push(line);
      continue;
    }
    if (skippingStart) continue;
    if (/^;LAYER:/.test(line)) {
      layer++;
      context.layer_num = layer;
    }
    const change = line.match(/^;STRATUM_TOOL_CHANGE:(\d+):(\d+)/);
    if (change) {
      const previous = Number(change[1]),
        next = Number(change[2]);
      const length = multi.purgeVolume / area;
      Object.assign(context, {
        previous_extruder: previous,
        next_extruder: next,
        toolchange_count: ++changes,
        layer_num: Math.max(0, layer),
        layer_z: z,
        position: [x, y, z],
        x_after_toolchange: x,
        y_after_toolchange: y,
        z_after_toolchange: z,
        old_filament_temp:
          layer <= 0
            ? filaments[previous].firstNozzleTemp
            : filaments[previous].nozzleTemp,
        new_filament_temp:
          layer <= 0
            ? filaments[next].firstNozzleTemp
            : filaments[next].nozzleTemp,
        old_filament_e_feedrate:
          (Math.min(filaments[previous].maxFlow, 10) / area) * 60,
        new_filament_e_feedrate:
          (Math.min(filaments[next].maxFlow, 10) / area) * 60,
        flush_length: length,
        flush_length_1: Math.min(length, 100),
        flush_length_2: Math.min(Math.max(length - 100, 0), 100),
        flush_length_3: Math.min(Math.max(length - 200, 0), 100),
        flush_length_4: Math.max(length - 300, 0),
        travel_point_1_x: x,
        travel_point_1_y: y,
        travel_point_2_x: x,
        travel_point_2_y: y,
        travel_point_3_x: x,
        travel_point_3_y: y,
      });
      output.push(line, ";STRATUM_MACHINE_CHANGE_BEGIN");
      if (printer.firmware === "bambu")
        output.push(renderGcodeTemplate(printer.toolChangeGcode, context));
      else {
        // U1's firmware owns tool docking. This is the by-layer branch of the
        // official profile, with an explicit return to the planner's position.
        output.push(
          "G90",
          `G1 Z${number(Math.min(z + 1.5, printer.bed[2]))} F600`,
          `G1 F${Math.min(settings.travelSpeed, 350) * 60}`,
          `M104 S${context.new_filament_temp} T${next}`,
          "M400",
          `T${next}`,
        );
        if (filaments[next].material === "PVA")
          output.push("SET_VELOCITY_LIMIT ACCEL=3000");
        if (next !== initial)
          output.push(`SM_PRINT_PREEXTRUDE_FILAMENT INDEX=${next}`);
      }
      output.push(
        "G90",
        "M83",
        `G1 X${number(x)} Y${number(y)} F${settings.travelSpeed * 60}`,
        `G1 Z${number(z)} F600`,
        `G1 F${number(feed)}`,
        ";STRATUM_MACHINE_CHANGE_END",
      );
      skippingChange = true;
      continue;
    }
    if (line === ";STRATUM_TOOL_READY") {
      skippingChange = false;
      output.push(line);
      continue;
    }
    if (skippingChange) continue;
    if (line === ";STRATUM_PRINT_END") {
      output.push(line, renderGcodeTemplate(printer.endGcode, context));
      continue;
    }
    const code = line.split(";")[0];
    if (/^G[01]\s/.test(code)) {
      const args: Record<string, number> = {};
      for (const m of code.matchAll(/([XYZF])\s*(-?(?:\d*\.)?\d+)/g))
        args[m[1]] = Number(m[2]);
      x = args.X ?? x;
      y = args.Y ?? y;
      z = args.Z ?? z;
      feed = args.F ?? feed;
    }
    output.push(line);
  }
  const result = output.join("\n");
  for (const line of result.split("\n")) {
    const code = line.split(";")[0];
    if (/[{}\[\]]|NaN|Infinity|undefined/.test(code))
      throw new Error(
        `The machine profile produced an unresolved or invalid command: ${code.trim().slice(0, 160)}`,
      );
  }
  return result;
}
