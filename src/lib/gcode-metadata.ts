import type { Filament, Printer, PrintEstimates } from "../types";
import { defaultFilament } from "./multimaterial";
import { DEFAULT_SETTINGS } from "./profiles";
import { VENDOR_PRINTERS } from "./vendor-printers";

export interface GcodeMetadata {
  printer?: Printer;
  filaments?: Filament[];
  filamentDiameter?: number;
  estimates?: PrintEstimates;
  warnings: string[];
}
const finite = (v: unknown, min: number, max: number) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
// Orca string vectors use semicolons, with quoted/escaped values; numeric vectors use commas.
function splitValues(value: string, separators: string): string[] {
  const values: string[] = [];
  let current = "",
    quoted = false,
    escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && separators.includes(char)) {
      values.push(current.trim());
      current = "";
      if (values.length >= 64) return values;
    } else current += char;
  }
  if (quoted || escaped) return [];
  values.push(current.trim());
  return values.slice(0, 64);
}
/** Read comment metadata from bounded header/footer text windows. */
export function readGcodeMetadata(gcode: string): GcodeMetadata {
  const limit = 1024 * 1024;
  const sample =
    gcode.length <= limit * 2
      ? gcode
      : gcode.slice(0, limit) + "\n" + gcode.slice(-limit);
  const fields = new Map<string, string>();
  for (const line of sample.split(/\r?\n/)) {
    if (line.length > 16384) continue;
    const match = line.match(/^;\s*([a-z_][a-z_ \[\]()]*)\s*=\s*(.*)$/i);
    if (match) fields.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  const list = (key: string) =>
    splitValues(
      fields.get(key) ?? "",
      ["filament_colour", "filament_type", "filament_settings_id"].includes(key)
        ? ";"
        : ",;",
    );
  const colors = list("filament_colour"),
    types = list("filament_type"),
    names = list("filament_settings_id");
  const count = Math.max(
    ...["filament_colour", "filament_type", "filament_settings_id"].map(
      (key) => (fields.has(key) ? list(key).length : 0),
    ),
  );
  const filaments: Filament[] | undefined = count
    ? Array.from({ length: count }, (_, i) => {
        const f = defaultFilament(DEFAULT_SETTINGS, i),
          color = colors[i]?.match(/^#?([\da-f]{6})(?:[\da-f]{2})?$/i)?.[1];
        return {
          ...f,
          color: color ? `#${color}` : f.color,
          material: types[i]?.slice(0, 50) || f.material,
          name: names[i]?.slice(0, 250) || `${types[i] || f.material} ${i + 1}`,
          density: finite(list("filament_density")[i], 0.1, 3) ?? f.density,
          cost: finite(list("filament_cost")[i], 0, 1000) ?? f.cost,
          nozzleTemp:
            finite(list("nozzle_temperature")[i], 150, 350) ?? f.nozzleTemp,
          firstNozzleTemp:
            finite(list("first_layer_temperature")[i], 150, 350) ??
            f.firstNozzleTemp,
          flow: finite(list("filament_flow_ratio")[i], 0.5, 1.5) ?? f.flow,
          maxFlow:
            finite(list("filament_max_volumetric_speed")[i], 1, 100) ??
            f.maxFlow,
        };
      })
    : undefined;
  const machine = (
    fields.get("printer_model") ?? fields.get("printer_settings_id")
  )
    ?.replace(/\s+\(?\d+(?:\.\d+)?(?:\s*mm)?\s+nozzle\)?$/i, "")
    .trim();
  const preset = VENDOR_PRINTERS.find(
    (p) => machine === p.name.replace(" + AMS", ""),
  );
  const filamentDiameter = finite(list("filament_diameter")[0], 1, 4);
  const printer = preset
    ? {
        ...structuredClone(preset),
        nozzle: finite(list("nozzle_diameter")[0], 0.1, 2) ?? preset.nozzle,
        filament: filamentDiameter ?? preset.filament,
      }
    : undefined;
  const warnings =
    machine && !printer
      ? [
          `Unrecognized G-code printer: ${machine.slice(0, 100)}. Preview uses the current build volume.`,
        ]
      : [];
  const time =
    fields.get("estimated printing time (normal mode)") ??
    fields.get("estimated printing time");
  let seconds: number | undefined;
  if (time && /^(?:\s*\d+(?:\.\d+)?[dhms])+\s*$/.test(time)) {
    const total = [...time.matchAll(/(\d+(?:\.\d+)?)([dhms])/g)].reduce(
      (sum, m) =>
        sum + Number(m[1]) * ({ d: 86400, h: 3600, m: 60, s: 1 }[m[2]] ?? 0),
      0,
    );
    seconds = finite(total, 0, 365 * 86400);
  }
  const lengths = fields.has("filament used [mm]")
    ? list("filament used [mm]")
    : [];
  const weights = fields.has("filament used [g]")
    ? list("filament used [g]")
    : [];
  const tools = Array.from(
    { length: Math.max(lengths.length, weights.length) },
    (_, tool) => ({
      tool,
      filament: finite(lengths[tool], 0, 1e9),
      weight: finite(weights[tool], 0, 1e6),
    }),
  ).filter((t) => t.filament !== undefined || t.weight !== undefined);
  const sum = (key: "filament" | "weight", values: string[]) =>
    values.length &&
    tools.length === values.length &&
    tools.every((t) => t[key] !== undefined)
      ? tools.reduce((a, t) => a + t[key]!, 0)
      : undefined;
  const weight =
    finite(fields.get("total filament used [g]"), 0, 1e6) ??
    sum("weight", weights);
  const filament = sum("filament", lengths);
  const estimates =
    seconds !== undefined || weight !== undefined || tools.length
      ? {
          seconds,
          weight,
          filament,
          tools,
          basis: fields.has("stratum_estimate_basis")
            ? "Stratum motion estimate"
            : "File metadata",
        }
      : undefined;
  return { printer, filaments, filamentDiameter, estimates, warnings };
}
