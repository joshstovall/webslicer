import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import type { Project, SliceResult, Printer, Filament } from "../types";
import { DEFAULT_SETTINGS } from "./profiles";
import { defaultFilament } from "./multimaterial";

// RFC 1321 MD5: the Bambu print container requires this checksum, not a security hash.
export function md5(bytes: Uint8Array): string {
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(length);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const data = new DataView(buffer.buffer);
  data.setUint32(length - 8, (bytes.length * 8) >>> 0, true);
  data.setUint32(length - 4, Math.floor(bytes.length / 0x20000000), true);
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  for (let offset = 0; offset < length; offset += 64) {
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let i = 0; i < 64; i++) {
      const group = i >> 4;
      const f =
        group === 0
          ? (b & c) | (~b & d)
          : group === 1
            ? (d & b) | (~d & c)
            : group === 2
              ? b ^ c ^ d
              : c ^ (b | ~d);
      const word =
        group === 0
          ? i
          : group === 1
            ? (5 * i + 1) % 16
            : group === 2
              ? (3 * i + 5) % 16
              : (7 * i) % 16;
      const n =
        (a +
          f +
          Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) +
          data.getUint32(offset + word * 4, true)) |
        0;
      const shift = shifts[group * 4 + (i % 4)];
      a = d;
      d = c;
      c = b;
      b = (b + ((n << shift) | (n >>> (32 - shift)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0]
    .flatMap((n) =>
      [0, 8, 16, 24].map((s) =>
        ((n >>> s) & 255).toString(16).padStart(2, "0"),
      ),
    )
    .join("");
}
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
      printer_model: printer.name.replace(" + AMS", ""),
      printer_settings_id: printer.name,
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
export function printThumbnail(
  result: SliceResult,
  printer: Printer,
  size = 512,
): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot create print thumbnail.");
  ctx.fillStyle = "#f5f5f0";
  ctx.fillRect(0, 0, size, size);
  const scale =
    (size / Math.max(printer.bed[0] + printer.bed[1], printer.bed[2] * 2)) *
    0.85;
  const point = (x: number, y: number, z: number) => [
    size / 2 + (x - y) * scale,
    size * 0.8 - (x + y) * scale * 0.38 - z * scale,
  ];
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
      ctx.strokeStyle =
        result.tools.find((t) => t.tool === layer.tools[i])?.color ?? "#91ad87";
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
  return Uint8Array.from(
    atob(canvas.toDataURL("image/png").split(",")[1]),
    (c) => c.charCodeAt(0),
  );
}
export function readPrintPackage(
  bytes: Uint8Array,
): { gcode: string; filaments?: Filament[] } | null {
  let acceptedGcode = false;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name === "Metadata/project_settings.config")
        return entry.originalSize < 256 * 1024;
      if (
        !acceptedGcode &&
        /^Metadata\/plate_\d+\.gcode$/.test(entry.name) &&
        entry.originalSize < 100 * 1024 * 1024
      ) {
        acceptedGcode = true;
        return true;
      }
      return false;
    },
  });
  const path = Object.keys(files)
    .filter((p) => p.endsWith(".gcode"))
    .sort()[0];
  if (!path) return null;
  let filaments: Filament[] | undefined;
  if (files["Metadata/project_settings.config"]) {
    try {
      const data = JSON.parse(
        strFromU8(files["Metadata/project_settings.config"]),
      );
      if (
        Array.isArray(data.filament_colour) &&
        data.filament_colour.length <= 64
      ) {
        filaments = data.filament_colour.map((color: unknown, i: number) => {
          const base = defaultFilament(DEFAULT_SETTINGS, i),
            density = Number(data.filament_density?.[i]),
            cost = Number(data.filament_cost?.[i]);
          return {
            ...base,
            color:
              typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
                ? color
                : base.color,
            name:
              typeof data.filament_settings_id?.[i] === "string"
                ? data.filament_settings_id[i]
                : base.name,
            material:
              typeof data.filament_type?.[i] === "string"
                ? data.filament_type[i]
                : base.material,
            density:
              Number.isFinite(density) && density > 0 && density <= 3
                ? density
                : base.density,
            cost:
              Number.isFinite(cost) && cost >= 0 && cost <= 1000
                ? cost
                : base.cost,
          };
        });
      }
    } catch {
      /* Metadata is optional; the G-code remains viewable. */
    }
  }
  return { gcode: strFromU8(files[path]), filaments };
}
