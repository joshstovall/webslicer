import { zipSync, strToU8 } from "fflate";
import type { Project, SliceResult, Printer } from "../types";
import { defaultFilament } from "./multimaterial";
import { VENDOR_PRINTERS } from "./vendor-printers";

import { md5 } from "./md5";
export { md5 } from "./md5";

const xml = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const modelIds: Record<string, string> = {
  "bambu-x1c": "BL-P001",
  "bambu-p1s": "C12",
  "bambu-p1p": "C11",
  "bambu-a1": "N2S",
  "bambu-a1-mini": "N1",
};
export function createPrintPackage(
  project: Project,
  result: SliceResult,
  images?: { large: Uint8Array; small: Uint8Array },
): Uint8Array {
  const printer = project.printer,
    filaments = project.filaments ?? [defaultFilament(project.settings)];
  const modelId = modelIds[printer.id];
  if (!modelId)
    throw new Error(
      "Select a supported Bambu printer for a Bambu print package.",
    );
  const modelName = VENDOR_PRINTERS.find(
    (p) => p.id === printer.id,
  )!.name.replace(" + AMS", "");
  const meta = (key: string, value: unknown) =>
    `<metadata key="${key}" value="${xml(value)}"/>`;
  const gcode = strToU8(result.gcode);
  const files: Record<string, Uint8Array> = {};
  const text = (name: string, value: string) => {
    files[name] = strToU8(value);
  };
  text(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="gcode" ContentType="text/x.gcode"/></Types>',
  );
  text(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  );
  text(
    "3D/3dmodel.model",
    '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Stratum</metadata><resources/><build/></model>',
  );
  text(
    "Metadata/_rels/model_settings.config.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/Metadata/plate_1.gcode" Id="rel-gcode" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/gcode"/></Relationships>',
  );
  text(
    "Metadata/model_settings.config",
    `<config><plate>${meta("plater_id", 1)}${meta("plater_name", project.name)}${meta("locked", false)}${meta("gcode_file", "Metadata/plate_1.gcode")}${images ? meta("thumbnail_file", "Metadata/plate_1.png") + meta("thumbnail_no_light_file", "Metadata/plate_no_light_1.png") + meta("top_file", "Metadata/top_1.png") + meta("pick_file", "Metadata/pick_1.png") : ""}</plate></config>`,
  );
  text(
    "Metadata/slice_info.config",
    `<config><header><header_item key="X-BBL-Client-Type" value="slicer"/><header_item key="X-BBL-Client-Version" value="01.10.01.50"/></header><plate>${meta("index", 1)}${meta("printer_model_id", modelId)}${meta("nozzle_diameters", printer.nozzle)}${meta("timelapse_type", 0)}${meta("prediction", Math.ceil(result.seconds))}${meta("weight", result.weight.toFixed(3))}${meta("outside", false)}${meta("support_used", project.settings.supports !== "disabled")}${meta("label_object_enabled", false)}${result.tools.map((t) => `<filament id="${t.tool + 1}" type="${xml(filaments[t.tool].material)}" color="${xml(filaments[t.tool].color)}" used_m="${(t.filament / 1000).toFixed(5)}" used_g="${t.weight.toFixed(3)}"/>`).join("")}</plate></config>`,
  );
  text(
    "Metadata/project_settings.config",
    JSON.stringify({
      printer_model: modelName,
      printer_settings_id: `${modelName} ${printer.nozzle} nozzle`,
      nozzle_diameter: [String(printer.nozzle)],
      filament_colour: filaments.map((f) => f.color),
      filament_type: filaments.map((f) => f.material),
      filament_settings_id: filaments.map((f) => f.name),
      filament_diameter: filaments.map(() => String(printer.filament)),
      filament_density: filaments.map((f) => String(f.density)),
      filament_cost: filaments.map((f) => String(f.cost)),
      filament_map: filaments.map((_, i) => String(i)),
      curr_bed_type: printer.bedType,
    }),
  );
  files["Metadata/plate_1.gcode"] = gcode;
  text("Metadata/plate_1.gcode.md5", md5(gcode));
  if (images) {
    for (const path of ["plate_1", "plate_no_light_1", "top_1", "pick_1"])
      files[`Metadata/${path}.png`] = images.large;
    files["Metadata/plate_1_small.png"] = images.small;
  }
  return zipSync(files, { level: 6 });
}
function renderThumbnail(
  result: SliceResult,
  _printer: Printer,
  size = 512,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot create print thumbnail.");
  ctx.fillStyle = "#f5f5f0";
  ctx.fillRect(0, 0, size, size);
  // Fit actual deposited paths, including the tower, so small models remain
  // readable on a printer screen regardless of bed size or machine origin.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const project = (x: number, y: number, z: number) => [
    x - y,
    -(x + y) * 0.38 - z,
  ];
  for (const layer of result.layers)
    for (let i = 0; i < layer.features.length; i++) {
      if (layer.features[i] === 4) continue;
      for (const endpoint of [0, 3]) {
        const a = i * 6 + endpoint;
        const [x, y] = project(
          layer.segments[a],
          layer.segments[a + 1],
          layer.segments[a + 2],
        );
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  const scale = (size * 0.88) / Math.max(maxX - minX, maxY - minY, 1);
  const centerX = (minX + maxX) / 2,
    centerY = (minY + maxY) / 2;
  const point = (x: number, y: number, z: number) => {
    const [px, py] = project(x, y, z);
    return [
      size / 2 + (px - centerX) * scale,
      size / 2 + (py - centerY) * scale,
    ];
  };
  const colors = new Map(result.tools.map((t) => [t.tool, t.color]));
  ctx.lineWidth = Math.max(0.6, size / 512);
  for (const layer of result.layers)
    for (let i = 0; i < layer.features.length; i++) {
      if (layer.features[i] === 4) continue;
      const a = i * 6,
        p = point(
          ...(Array.from(layer.segments.slice(a, a + 3)) as [
            number,
            number,
            number,
          ]),
        ),
        q = point(
          ...(Array.from(layer.segments.slice(a + 3, a + 6)) as [
            number,
            number,
            number,
          ]),
        );
      ctx.strokeStyle = colors.get(layer.tools[i]) ?? "#91ad87";
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
  return canvas;
}
function pngBytes(canvas: HTMLCanvasElement): Uint8Array {
  return Uint8Array.from(
    atob(canvas.toDataURL("image/png").split(",")[1]),
    (c) => c.charCodeAt(0),
  );
}
export function printThumbnail(
  result: SliceResult,
  printer: Printer,
  size = 512,
): Uint8Array {
  return pngBytes(renderThumbnail(result, printer, size));
}
/** Render geometry once; derive the smaller printer preview by resampling. */
export function printThumbnails(
  result: SliceResult,
  printer: Printer,
  largeSize = 512,
  smallSize = 128,
) {
  const large = renderThumbnail(result, printer, largeSize);
  const small = document.createElement("canvas");
  small.width = small.height = smallSize;
  const context = small.getContext("2d");
  if (!context) throw new Error("Cannot create print thumbnail.");
  context.drawImage(large, 0, 0, smallSize, smallSize);
  return { large: pngBytes(large), small: pngBytes(small) };
}
export { readPrintPackage } from "./print-package-reader";
