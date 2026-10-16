import { unzipSync, strFromU8 } from "fflate";
import type { Filament, Printer, PrintPackagePlate } from "../types";
import { DEFAULT_SETTINGS } from "./profiles";
import { defaultFilament } from "./multimaterial";
import { VENDOR_PRINTERS } from "./vendor-printers";
import { md5 } from "./md5";

const MAX_GCODE = 100 * 1024 * 1024;
const CONFIGS = [
  "metadata/project_settings.config",
  "metadata/model_settings.config",
  "metadata/slice_info.config",
];
const modelIds: Record<string, string> = {
  "BL-P001": "bambu-x1c",
  C12: "bambu-p1s",
  C11: "bambu-p1p",
  N2S: "bambu-a1",
  N1: "bambu-a1-mini",
};
const pathKey = (path: string) =>
  path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/(^|\/)\.\//g, "$1")
    .toLowerCase();
const colorOf = (value: unknown) =>
  typeof value === "string"
    ? value.match(/^#?([\da-f]{6})(?:[\da-f]{2})?$/i)?.[1]
    : undefined;
const finite = (value: unknown, min: number, max: number) => {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : undefined;
};
interface PlateMetadata {
  values: Record<string, string>;
  filaments: Record<string, string>[];
}
export interface ReadPrintPackage {
  gcode: string;
  path: string;
  plates: PrintPackagePlate[];
  filaments?: Filament[];
  printer?: Printer;
  filamentDiameter?: number;
  warnings: string[];
}
function xmlPlates(
  bytes: Uint8Array | undefined,
  name: string,
  warnings: string[],
): PlateMetadata[] {
  if (!bytes) return [];
  try {
    const xml = strFromU8(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error("Unsupported document declaration");
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.getElementsByTagName("parsererror").length)
      throw new Error("Invalid XML");
    return Array.from(document.getElementsByTagName("plate")).map((plate) => {
      const values: Record<string, string> = {},
        filaments: Record<string, string>[] = [];
      for (const child of Array.from(plate.childNodes)) {
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        if (element.tagName === "metadata") {
          const key = element.getAttribute("key");
          if (key)
            values[key] =
              element.getAttribute("value") ?? element.textContent ?? "";
        }
        if (element.tagName === "filament")
          filaments.push(
            Object.fromEntries(
              Array.from(element.attributes).map((a) => [a.name, a.value]),
            ),
          );
      }
      return { values, filaments };
    });
  } catch {
    warnings.push(
      `${name} could not be read; available G-code remains viewable.`,
    );
    return [];
  }
}

/** Index all jobs, but inflate only metadata and one selected G-code stream. */
export function readPrintPackage(
  bytes: Uint8Array,
  selectedPath?: string,
): ReadPrintPackage | null {
  if (bytes.byteLength > MAX_GCODE)
    throw new Error("Print package exceeds 100 MB.");
  const warnings: string[] = [],
    plates: PrintPackagePlate[] = [];
  const seen = new Set<string>();
  const metadata = unzipSync(bytes, {
    filter: (entry) => {
      const key = pathKey(entry.name);
      if (/\.gcode$/i.test(key)) {
        if (seen.has(key))
          throw new Error("The print package contains duplicate G-code paths.");
        seen.add(key);
        if (plates.length >= 200)
          throw new Error("Print package exceeds 200 plates.");
        const index = Number(key.match(/(?:^|\/)plate_(\d+)\.gcode$/)?.[1]);
        plates.push({
          path: entry.name,
          name: Number.isFinite(index)
            ? `Plate ${index}`
            : entry.name.split("/").pop()!,
          index: Number.isFinite(index) ? index : undefined,
          size: entry.originalSize,
          unavailable:
            entry.originalSize > MAX_GCODE
              ? "G-code exceeds 100 MB"
              : entry.originalSize === 0
                ? "Empty G-code"
                : undefined,
        });
      }
      if (!CONFIGS.includes(key)) return false;
      if (seen.has(key))
        throw new Error("The print package contains duplicate metadata paths.");
      seen.add(key);
      if (entry.originalSize > 4 * 1024 * 1024) {
        warnings.push(
          `${entry.name} exceeds the metadata size limit and was skipped.`,
        );
        return false;
      }
      return true;
    },
  });
  if (!plates.length) return null;
  const configs = Object.fromEntries(
    Object.entries(metadata).map(([name, data]) => [pathKey(name), data]),
  );
  const settings = xmlPlates(configs[CONFIGS[1]], "Plate metadata", warnings);
  const slices = xmlPlates(configs[CONFIGS[2]], "Slice metadata", warnings);
  for (const setting of settings) {
    const target = setting.values.gcode_file;
    const index = finite(setting.values.plater_id, 0, 1000000);
    const plate = target
      ? plates.find((p) =>
          [pathKey(target), pathKey(`Metadata/${target}`)].includes(
            pathKey(p.path),
          ),
        )
      : plates.find((p) => p.index === index);
    if (!plate) continue;
    if (index !== undefined) plate.index = index;
    if (setting.values.plater_name?.trim())
      plate.name = setting.values.plater_name.trim().slice(0, 250);
  }
  plates.sort(
    (a, b) =>
      (a.index ?? Infinity) - (b.index ?? Infinity) ||
      a.path.localeCompare(b.path, undefined, { numeric: true }),
  );
  const plate =
    selectedPath === undefined
      ? plates.find((p) => !p.unavailable)
      : plates.find((p) => p.path === selectedPath);
  if (!plate)
    throw new Error(
      selectedPath
        ? "The selected plate is not in this print package."
        : "No viewable G-code plates were found in this print package.",
    );
  if (plate.unavailable)
    throw new Error(`${plate.name}: ${plate.unavailable}.`);
  const files = unzipSync(bytes, {
    filter: (entry) =>
      entry.name === plate.path ||
      (pathKey(entry.name) === pathKey(`${plate.path}.md5`) &&
        entry.originalSize <= 256),
  });
  const gcode = files[plate.path];
  const checksum = Object.entries(files).find(
    ([name]) => pathKey(name) === pathKey(`${plate.path}.md5`),
  )?.[1];
  if (checksum) {
    const expected = strFromU8(checksum)
      .trim()
      .match(/^([\da-f]{32})(?:\s|$)/i)?.[1];
    if (!expected || expected.toLowerCase() !== md5(gcode))
      warnings.push(
        `${plate.name}: G-code checksum does not match the archive. The original file is preserved.`,
      );
  }
  let data: Record<string, unknown> = {};
  if (configs[CONFIGS[0]])
    try {
      const value = JSON.parse(strFromU8(configs[CONFIGS[0]]));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid project metadata");
      data = value;
    } catch {
      warnings.push(
        "Project metadata could not be read; plate metadata and G-code remain available.",
      );
    }
  const array = (key: string): unknown[] =>
    Array.isArray(data[key]) ? (data[key] as unknown[]).slice(0, 64) : [];
  const count = Math.max(
    ...[
      "filament_colour",
      "filament_type",
      "filament_settings_id",
      "filament_density",
      "filament_cost",
    ].map((key) => array(key).length),
  );
  let filaments: Filament[] | undefined = count
    ? Array.from({ length: count }, (_, i) => {
        const base = defaultFilament(DEFAULT_SETTINGS, i),
          color = colorOf(array("filament_colour")[i]);
        return {
          ...base,
          color: color ? `#${color}` : base.color,
          name:
            typeof array("filament_settings_id")[i] === "string"
              ? String(array("filament_settings_id")[i]).slice(0, 250)
              : base.name,
          material:
            typeof array("filament_type")[i] === "string"
              ? String(array("filament_type")[i]).slice(0, 50)
              : base.material,
          density: finite(array("filament_density")[i], 0.1, 3) ?? base.density,
          cost: finite(array("filament_cost")[i], 0, 1000) ?? base.cost,
        };
      })
    : undefined;
  const matchingSlices = slices.filter(
    (s) =>
      finite(s.values.index, 0, 1000000) === plate.index &&
      plate.index !== undefined,
  );
  if (matchingSlices.length > 1)
    warnings.push(`${plate.name}: duplicate slice metadata was ignored.`);
  const slice = matchingSlices.length === 1 ? matchingSlices[0] : undefined;
  for (const entry of slice?.filaments ?? []) {
    const id = finite(entry.id, 1, 64);
    if (id === undefined || !Number.isInteger(id)) {
      warnings.push(
        "A filament entry has an unsupported tool ID and was skipped.",
      );
      continue;
    }
    const tool = id - 1;
    filaments ??= [];
    while (filaments.length <= tool)
      filaments.push(defaultFilament(DEFAULT_SETTINGS, filaments.length));
    const base = filaments[tool],
      color = colorOf(entry.color);
    filaments[tool] = {
      ...base,
      color: color ? `#${color}` : base.color,
      material: entry.type?.slice(0, 50) || base.material,
      name:
        entry.name?.slice(0, 250) ||
        (array("filament_settings_id")[tool]
          ? base.name
          : `${entry.type || base.material} ${id}`),
    };
  }
  const modelId = slice?.values.printer_model_id;
  const model =
    typeof data.printer_model === "string"
      ? data.printer_model
      : data.printer_settings_id;
  const machineName =
    typeof model === "string"
      ? model
          .replace(/\s+\+\s+AMS(?: lite)?$/i, "")
          .replace(/\s+\(?\d+(?:\.\d+)?(?:\s*mm)?\s+nozzle\)?$/i, "")
          .trim()
      : undefined;
  const preset = modelId
    ? VENDOR_PRINTERS.find((p) => p.id === modelIds[modelId])
    : VENDOR_PRINTERS.find((p) => machineName === p.name.replace(" + AMS", ""));
  const printer = preset ? structuredClone(preset) : undefined;
  const filamentDiameter = finite(array("filament_diameter")[0], 1, 4);
  if (printer) {
    printer.nozzle =
      finite(slice?.values.nozzle_diameters?.split(/[,;]/)[0], 0.1, 2) ??
      finite(array("nozzle_diameter")[0], 0.1, 2) ??
      printer.nozzle;
    printer.filament = filamentDiameter ?? printer.filament;
  } else if (modelId || model)
    warnings.push(
      `Unrecognized package printer: ${String(modelId || model).slice(0, 100)}. Preview uses the current build volume.`,
    );
  return {
    gcode: strFromU8(gcode),
    path: plate.path,
    plates,
    filaments,
    printer,
    filamentDiameter,
    warnings,
  };
}
