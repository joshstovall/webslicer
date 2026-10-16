import { strToU8, zipSync } from "fflate";
import { md5 } from "../../src/lib/md5";
const job = (tool: number, z: number) =>
  `G90\nM83\nT${tool}\n;LAYER:0\nG1 X20 Y20 Z${z} F1200\nG1 X40 E2\nG1 Y40 E2\nG1 X20 E2\nG1 Y20 E2\n`;
export function multiPlateFiles() {
  const two = job(0, 0.2),
    ten = job(2, 0.4);
  return {
    // ZIP order deliberately differs from plate order.
    "Metadata/plate_10.gcode": strToU8(ten),
    "Metadata/plate_3.gcode": new Uint8Array(),
    "Metadata/plate_2.gcode": strToU8(two),
    "Metadata/plate_2.gcode.md5": strToU8(md5(strToU8(two))),
    "Metadata/plate_10.gcode.md5": strToU8(md5(strToU8(ten))),
    "Metadata/project_settings.config": strToU8(
      JSON.stringify({
        printer_model: "Bambu Lab P1S",
        filament_colour: ["#ffffff"],
        filament_settings_id: ["Original PLA"],
        filament_type: ["PLA"],
        filament_density: ["1.24"],
        filament_cost: ["25"],
        filament_diameter: ["1.75"],
        nozzle_diameter: ["0.4"],
      }),
    ),
    "Metadata/model_settings.config": strToU8(
      '<config><plate><metadata key="plater_id" value="10"/><metadata key="plater_name" value="Cap &amp; clip"/><metadata key="gcode_file" value="/Metadata/plate_10.gcode"/></plate><plate><metadata key="plater_id" value="2"/><metadata key="plater_name" value="Base"/><metadata key="gcode_file" value="Metadata/plate_2.gcode"/></plate></config>',
    ),
    "Metadata/slice_info.config": strToU8(
      '<config><plate><metadata key="index" value="10"/><metadata key="printer_model_id" value="N1"/><metadata key="nozzle_diameters" value="0.6"/><filament id="3" type="PETG" color="#2233AAFF" used_m="0.008"/></plate><plate><metadata key="index" value="2"/><metadata key="printer_model_id" value="C12"/><filament id="1" type="PLA" color="#CC3322"/></plate></config>',
    ),
  };
}
export const multiPlatePackage = () => zipSync(multiPlateFiles());
