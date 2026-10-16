import { supportInterfaceSettings } from "./support-interface-settings";
import type { Printer, Settings } from "../types";

export interface ProcessImportEntry {
  id: string;
  label: string;
  source: string;
  current: string;
  value: string;
  patch: Partial<Settings>;
  note?: string;
}
export interface ProcessImportReport {
  entries: ProcessImportEntry[];
  skipped: { key: string; value: string; reason: string }[];
  notes: string[];
}
const display = (value: unknown): string => {
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  } catch {
    return "[Complex value omitted from report]";
  }
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
};
/** A uniform tool array can transfer to a plate-wide setting; differing values cannot. */
function scalar(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (!value.length || value.length > 64)
    throw new Error("Expected a scalar or a uniform filament array.");
  const first = value[0];
  if (value.some((v) => String(v) !== String(first)))
    throw new Error(
      "Different per-tool values cannot transfer to one plate-wide setting.",
    );
  return first;
}
function numeric(value: unknown, percent = false): number {
  value = scalar(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value !== "string" ||
    !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(value.trim())
  )
    throw new Error("Expected a finite numeric value.");
  if (value.trim().endsWith("%") && !percent)
    throw new Error(
      "This percentage requires a setting-specific reference and was not converted.",
    );
  const n = Number(value.trim().replace(/%$/, ""));
  if (!Number.isFinite(n)) throw new Error("Expected a finite numeric value.");
  return n;
}
function boolean(value: unknown) {
  value = scalar(value);
  if ([true, 1, "1", "true"].includes(value as never)) return true;
  if ([false, 0, "0", "false"].includes(value as never)) return false;
  throw new Error("Expected true/false or 1/0.");
}

/** Original format adapter, based on Orca's serialized option names and units.
 * No G-code, printer macros, preset inheritance or executable source is applied. */
export function readProcessSettings(
  data: Record<string, unknown>,
  current: Settings,
  printer: Printer,
): ProcessImportReport {
  current = { ...current, ...supportInterfaceSettings(current) };
  const report: ProcessImportReport = { entries: [], skipped: [], notes: [] };
  const used = new Set<string>();
  const has = (key: string) => Object.hasOwn(data, key);
  const skip = (key: string, reason: string) => {
    used.add(key);
    report.skipped.push({
      key: key.slice(0, 160),
      value: display(data[key]),
      reason,
    });
  };
  const add = (
    keys: string[],
    label: string,
    patch: Partial<Settings>,
    value: string,
    note?: string,
  ) => {
    keys.forEach((k) => used.add(k));
    report.entries.push({
      id: keys[0],
      label,
      source: keys.map((k) => `${k}: ${display(data[k])}`).join("; "),
      current: Object.entries(patch)
        .filter(
          ([k]) =>
            !["adaptive", "manualLayers", "layerHeightCurve"].includes(k),
        )
        .map(([k]) => display(current[k as keyof Settings]))
        .join(" / "),
      value,
      patch,
      note,
    });
  };
  const transfer = (key: string, fn: () => void) => {
    if (!has(key)) return;
    try {
      fn();
    } catch (e) {
      skip(key, (e as Error).message);
    }
  };
  const number = (
    key: string,
    target: keyof Settings,
    label: string,
    min: number,
    max: number,
    unit = "",
    integer = false,
    percent = false,
  ) =>
    transfer(key, () => {
      const n = numeric(data[key], percent);
      if (n < min || n > max || (integer && !Number.isInteger(n)))
        throw new Error(
          `Supported range is ${min}–${max}${unit}${integer ? " in whole numbers" : ""}; value was not clamped.`,
        );
      const patch: Partial<Settings> = { [target]: n };
      if (target === "layerHeight")
        Object.assign(patch, {
          adaptive: false,
          manualLayers: false,
          layerHeightCurve: undefined,
        });
      add(
        [key],
        label,
        patch,
        `${n}${unit}`,
        target === "layerHeight"
          ? "Uses fixed layers; any existing adaptive or manual layer schedule is disabled."
          : undefined,
      );
    });
  const choice = (
    key: string,
    target: keyof Settings,
    label: string,
    values: Record<string, string>,
  ) =>
    transfer(key, () => {
      const raw = scalar(data[key]);
      if (typeof raw !== "string" || !Object.hasOwn(values, raw))
        throw new Error(
          "This option has no supported equivalent; the current setting is retained.",
        );
      add([key], label, { [target]: values[raw] }, raw);
    });
  number("layer_height", "layerHeight", "Layer height", 0.05, 2, " mm");
  number(
    "initial_layer_print_height",
    "firstLayerHeight",
    "First layer height",
    0.05,
    2,
    " mm",
  );
  transfer("line_width", () => {
    const raw = scalar(data.line_width),
      percent = typeof raw === "string" && raw.trim().endsWith("%");
    const sourceNozzle =
      percent && has("nozzle_diameter")
        ? numeric(data.nozzle_diameter)
        : undefined;
    if (percent && !(sourceNozzle && sourceNozzle > 0 && sourceNozzle <= 2))
      throw new Error(
        "Percentage width needs a single valid source nozzle diameter.",
      );
    const n = numeric(raw, true) * (percent ? sourceNozzle! / 100 : 1);
    if (n < 0.1 || n > 2)
      throw new Error(
        "Automatic (0) or out-of-range line width cannot be reproduced; supported width is 0.1–2 mm.",
      );
    add(
      ["line_width"],
      "Default line width",
      { lineWidth: n },
      `${Number(n.toFixed(4))} mm`,
      percent
        ? `Converted using the source ${sourceNozzle} mm nozzle, not the selected printer's nozzle.`
        : undefined,
    );
  });
  number("wall_loops", "walls", "Wall loops", 1, 20, "", true);
  number("top_shell_layers", "topLayers", "Top layers", 0, 30, "", true);
  number(
    "bottom_shell_layers",
    "bottomLayers",
    "Bottom layers",
    1,
    30,
    "",
    true,
  );
  number(
    "sparse_infill_density",
    "infill",
    "Infill density",
    0,
    100,
    "%",
    false,
    true,
  );
  number("infill_direction", "infillAngle", "Infill angle", 0, 180, "°");
  number(
    "infill_wall_overlap",
    "infillOverlap",
    "Infill / wall overlap",
    0,
    50,
    "%",
    false,
    true,
  );
  choice("sparse_infill_pattern", "infillPattern", "Infill pattern", {
    gyroid: "gyroid",
    grid: "grid",
    cubic: "cubic",
    honeycomb: "hex",
    triangles: "triangle",
    rectilinear: "linear",
    line: "linear",
  });
  choice("wall_sequence", "wallOrder", "Wall order", {
    "inner wall/outer wall": "in-out",
    "outer wall/inner wall": "out-in",
  });
  choice("seam_position", "seam", "Seam placement", {
    nearest: "last",
    random: "random",
  });
  for (const [key, target, label] of [
    ["detect_thin_wall", "thinWalls", "Thin walls"],
    ["spiral_mode", "vase", "Spiral vase"],
  ] as const)
    transfer(key, () => {
      const value = boolean(data[key]);
      add([key], label, { [target]: value }, value ? "On" : "Off");
    });
  number("outer_wall_speed", "outerSpeed", "Outer wall speed", 5, 300, " mm/s");
  number("travel_speed", "travelSpeed", "Travel speed", 10, 600, " mm/s");
  if (has("initial_layer_speed") || has("initial_layer_infill_speed")) {
    const keys = ["initial_layer_speed", "initial_layer_infill_speed"];
    try {
      if (!keys.every(has))
        throw new Error(
          "First-layer speed requires explicit wall and infill speeds.",
        );
      const speeds = keys.map((key) => numeric(data[key]));
      if (speeds[0] !== speeds[1])
        throw new Error(
          "Separate first-layer wall and infill speeds are not yet supported.",
        );
      if (speeds[0] < 5 || speeds[0] > 100)
        throw new Error("Supported first-layer speed is 5–100 mm/s.");
      add(
        keys,
        "First layer speed",
        { firstLayerSpeed: speeds[0] },
        `${speeds[0]} mm/s`,
      );
    } catch (e) {
      for (const key of keys.filter(has)) skip(key, (e as Error).message);
    }
  }
  // The web engine has one general model speed. Never replace all regions with
  // an isolated inner-wall value when the source has distinct infill/skin speeds.
  const speedKeys = [
    "inner_wall_speed",
    "sparse_infill_speed",
    "internal_solid_infill_speed",
    "top_surface_speed",
  ];
  if (speedKeys.some(has)) {
    try {
      if (!speedKeys.every(has))
        throw new Error(
          "General print speed needs explicit inner-wall, sparse-infill, solid-infill and top-surface speeds.",
        );
      const values = speedKeys.map((k) => numeric(data[k]));
      if (values.some((v) => v !== values[0]))
        throw new Error(
          "Separate inner-wall, infill and top-surface speeds are not yet supported; general print speed is retained.",
        );
      if (values[0] < 5 || values[0] > 500)
        throw new Error("Supported print speed is 5–500 mm/s.");
      add(speedKeys, "Print speed", { speed: values[0] }, `${values[0]} mm/s`);
    } catch (e) {
      for (const key of speedKeys.filter(has)) skip(key, (e as Error).message);
    }
  }
  transfer("enable_support", () => {
    const enabled = boolean(data.enable_support);
    const modes: Record<string, string> = {
      "normal(auto)": "auto",
      "normal(manual)": "manual",
      "tree(auto)": "tree",
      "tree(manual)": "tree-manual",
    };
    const type = scalar(data.support_type);
    if (enabled && (typeof type !== "string" || !Object.hasOwn(modes, type)))
      throw new Error(
        "Enabled supports require an explicit supported support type.",
      );
    add(
      ["enable_support", ...(has("support_type") ? ["support_type"] : [])],
      "Support generation",
      { supports: enabled ? modes[type as string] : "disabled" },
      enabled ? (type as string) : "Disabled",
      enabled
        ? "Stratum generates its own support geometry. Imported painted/volume enforcers are not transferred."
        : undefined,
    );
  });
  transfer("support_threshold_angle", () => {
    const angle = numeric(data.support_threshold_angle);
    if (angle < 5 || angle > 75)
      throw new Error(
        "Automatic (0) or angles outside 5–75° have no supported threshold equivalent.",
      );
    add(
      ["support_threshold_angle"],
      "Overhang threshold",
      { supportAngle: 90 - angle },
      `${90 - angle}°`,
      "Converted from Orca's angle above horizontal to Stratum's threshold measured from vertical.",
    );
  });
  number(
    "support_object_xy_distance",
    "supportOffset",
    "Support XY separation",
    0.1,
    3,
    " mm",
  );
  number(
    "support_interface_top_layers",
    "supportTopInterfaceLayers",
    "Top interface layers",
    0,
    10,
    "",
    true,
  );
  transfer("support_interface_bottom_layers", () => {
    let n = numeric(data.support_interface_bottom_layers);
    if (n === -1) n = numeric(data.support_interface_top_layers);
    if (!Number.isInteger(n) || n < 0 || n > 10)
      throw new Error(
        "Bottom interface requires 0–10 whole layers, or -1 with an explicit valid top count.",
      );
    add(
      ["support_interface_bottom_layers"],
      "Bottom interface layers",
      { supportBottomInterfaceLayers: n },
      String(n),
    );
  });
  number("brim_width", "brimWidth", "Brim width", 1, 20, " mm");
  number("brim_object_gap", "brimGap", "Brim gap", 0, 1, " mm");
  number("skirt_distance", "skirtDistance", "Skirt distance", 1, 20, " mm");
  if (has("brim_type") || has("skirt_loops") || has("raft_layers")) {
    const keys = ["brim_type", "skirt_loops", "raft_layers"].filter(has);
    try {
      if (!["brim_type", "skirt_loops", "raft_layers"].every(has))
        throw new Error(
          "Adhesion mode needs explicit brim type, skirt loops and raft layers; missing values are not inferred.",
        );
      if (numeric(data.raft_layers) !== 0)
        throw new Error(
          "The source raft layer count cannot be reproduced by the current raft generator.",
        );
      const brim = scalar(data.brim_type),
        skirt = numeric(data.skirt_loops ?? 0);
      if (!Number.isInteger(skirt) || skirt < 0 || skirt > 10)
        throw new Error("Supported skirt count is 0–10 whole loops.");
      if (brim !== "no_brim" && brim !== "outer_only")
        throw new Error(
          "Automatic, inner, painted and ear brims cannot be reproduced.",
        );
      if (brim === "outer_only" && skirt)
        throw new Error("Combined brim and skirt are not yet supported.");
      add(
        keys,
        "Bed adhesion",
        {
          adhesion: brim === "outer_only" ? "brim" : skirt ? "skirt" : "none",
          ...(skirt ? { skirtLoops: skirt } : {}),
        },
        brim === "outer_only"
          ? "Outer brim"
          : skirt
            ? `${skirt} skirt loops`
            : "None",
      );
    } catch (e) {
      for (const key of keys) skip(key, (e as Error).message);
    }
  }
  const metadata = new Set([
    "filament_colour",
    "filament_settings_id",
    "filament_type",
    "name",
    "version",
    "from",
    "type",
    "print_settings_id",
  ]);
  for (const [key, value] of Object.entries(data)) {
    if (used.has(key) || metadata.has(key)) continue;
    skip(
      key,
      /gcode/i.test(key)
        ? "Machine G-code is retained from the selected printer and is not imported."
        : key === "inherits"
          ? "Preset inheritance is not resolved; only explicit supported values transfer."
          : "No transfer is implemented for this field; the current configuration is retained.",
    );
    if (key === "nozzle_diameter") {
      try {
        const n = numeric(value);
        if (n !== printer.nozzle)
          report.notes.push(
            `Source nozzle: ${n} mm. Selected printer nozzle: ${printer.nozzle} mm. Review compatibility before slicing.`,
          );
      } catch {
        report.notes.push(
          "The source has mixed or invalid nozzle diameters. The selected printer is retained.",
        );
      }
    }
  }
  if (has("top_shell_thickness") || has("bottom_shell_thickness"))
    report.notes.push(
      "Shell thickness constraints are not imported; transferred top/bottom counts are layer counts only.",
    );
  report.notes.push(
    "The selected printer, existing spool settings and machine G-code are retained. New filament slots use material defaults. Imported patterns use Stratum's toolpath algorithms.",
  );
  return report;
}

export function processImportPatch(
  report: ProcessImportReport,
  selected: readonly string[],
) {
  const chosen = new Set(selected);
  return Object.assign(
    {},
    ...report.entries.filter((e) => chosen.has(e.id)).map((e) => e.patch),
  ) as Partial<Settings>;
}
