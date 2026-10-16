import { zipSync, strToU8 } from "fflate";
import { primitive } from "../../src/lib/geometry";
export function process3mf(config: unknown, overrides = false) {
  const p = primitive("cube", 1).positions.map((v) => v * 0.3);
  const vertices = Array.from(
    { length: p.length / 3 },
    (_, i) =>
      `<vertex x="${p[i * 3]}" y="${p[i * 3 + 1]}" z="${p[i * 3 + 2]}"/>`,
  ).join("");
  const triangles = Array.from(
    { length: p.length / 9 },
    (_, i) =>
      `<triangle v1="${i * 3}" v2="${i * 3 + 1}" v3="${i * 3 + 2}" ${overrides && i === 0 ? 'paint_supports="1" paint_seam="1"' : ""}/>`,
  ).join("");
  return zipSync({
    "3D/3dmodel.model": strToU8(
      `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model" name="Process cube"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
    ),
    "Metadata/project_settings.config": strToU8(
      typeof config === "string" ? config : JSON.stringify(config),
    ),
    ...(overrides
      ? {
          "Metadata/model_settings.config": strToU8(
            '<config><object id="1"><metadata key="name" value="Process cube"/><metadata key="wall_loops" value="8"/></object></config>',
          ),
          "Metadata/layer_heights_profile.txt": strToU8(
            "object_id=1|0;0.2;6;0.1",
          ),
          "Metadata/layer_config_ranges.xml": strToU8("<objects/>"),
        }
      : {}),
  });
}
export const processConfig = {
  layer_height: "0.25",
  initial_layer_print_height: "0.25",
  line_width: "105%",
  nozzle_diameter: ["0.4"],
  wall_loops: "4",
  top_shell_layers: "3",
  bottom_shell_layers: "3",
  sparse_infill_density: "25%",
  sparse_infill_pattern: "grid",
  infill_direction: "45",
  wall_sequence: "inner wall/outer wall",
  seam_position: "nearest",
  enable_support: "0",
  brim_type: "no_brim",
  skirt_loops: "0",
  raft_layers: "0",
  outer_wall_speed: "40",
  travel_speed: "150",
  initial_layer_speed: "25",
  initial_layer_infill_speed: "25",
  inner_wall_speed: "60",
  sparse_infill_speed: "60",
  internal_solid_infill_speed: "60",
  top_surface_speed: "60",
  wall_generator: "arachne",
  machine_start_gcode: "G1 X999 Y999",
  inherits: "Source process preset",
};
