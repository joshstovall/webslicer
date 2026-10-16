import { auxiliaryFanIndex } from "./fan-control";
import type {
  Filament,
  Model,
  MultiMaterialSettings,
  Printer,
  Settings,
} from "../types";

export function physicalToolCount(p: Printer) {
  return p.multiMaterialMode === "toolchanger" ? (p.toolCount ?? 1) : 1;
}
export function printerHardware(p: Printer) {
  const vendor = p.firmware === "bambu" || p.firmware === "snapmaker-u1";
  const enclosed = vendor
    ? ["bambu-x1c", "bambu-p1s"].includes(p.id)
    : undefined;
  return {
    enclosed: p.hardware?.enclosed ?? enclosed,
    abrasiveTools:
      p.hardware?.abrasiveTools ??
      (p.firmware === "bambu" && p.id === "bambu-x1c" ? [0] : []),
  };
}
export function filamentFeed(p: Printer) {
  return p.firmware === "bambu"
    ? p.id === "bambu-a1" || p.id === "bambu-a1-mini"
      ? "AMS lite"
      : "AMS"
    : undefined;
}
export function validMaterialCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 80 &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
export function materialFamily(material: string): string | undefined {
  const value = material.trim().toUpperCase();
  if (/^(?:PA\d*|PAHT|PPA)(?:\b|[-_ ])/.test(value)) return "PA";
  if (/^TP[UE]\d+(?:[AD])?(?:$|[^A-Z])/.test(value)) return value.slice(0, 3);
  return value.match(
    /^(PLA|PETG|PCTG|ABS|ASA|TPU|TPE|PVA|BVOH|HIPS|PC|PET|PP|POM)(?:\b|[-_ ])/i,
  )?.[1];
}
export function materialRequirements(f: Filament, feed?: "AMS" | "AMS lite") {
  const family = materialFamily(f.material);
  const abrasive =
    f.requirements?.abrasive ??
    /(?:(?:^|[^a-z])(?:CF|GF)(?:$|[^a-z])|carbon|glass.?fiber|glow)/i.test(
      f.material,
    );
  return {
    abrasive,
    enclosure:
      f.requirements?.enclosure ??
      ["ABS", "ASA", "PA", "PC", "PET", "POM"].includes(family ?? ""),
    minNozzle: f.requirements?.minNozzle ?? (abrasive ? 0.4 : 0.2),
    bedRange: f.requirements?.bedRange,
    feedCompatibility:
      (f.requirements?.feedSystem === feed
        ? f.requirements?.feedCompatibility
        : undefined) ??
      (["TPU", "TPE"].includes(family ?? "") ? "incompatible" : "unspecified"),
  };
}
export function validMaterialRequirements(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as NonNullable<Filament["requirements"]>;
  return (
    ["abrasive", "enclosure"].every(
      (key) => !(key in r) || typeof r[key as "abrasive"] === "boolean",
    ) &&
    (r.minNozzle === undefined ||
      (typeof r.minNozzle === "number" &&
        Number.isFinite(r.minNozzle) &&
        r.minNozzle >= 0.1 &&
        r.minNozzle <= 2)) &&
    (r.feedSystem === undefined ||
      ["AMS", "AMS lite"].includes(r.feedSystem)) &&
    (r.feedCompatibility === undefined ||
      r.feedCompatibility === "unspecified" ||
      r.feedSystem !== undefined) &&
    (r.feedCompatibility === undefined ||
      ["unspecified", "compatible", "incompatible"].includes(
        r.feedCompatibility,
      )) &&
    (r.bedRange === undefined ||
      (Array.isArray(r.bedRange) &&
        r.bedRange.length === 2 &&
        r.bedRange.every(
          (v) =>
            typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 130,
        ) &&
        r.bedRange[0] <= r.bedRange[1]))
  );
}
export function validPrinterHardware(p: Printer): boolean {
  const h = p.hardware;
  if (h === undefined) return true;
  return (
    !!h &&
    typeof h === "object" &&
    !Array.isArray(h) &&
    (h.enclosed === undefined || typeof h.enclosed === "boolean") &&
    (h.auxiliaryFan === undefined || typeof h.auxiliaryFan === "boolean") &&
    (h.auxiliaryFanIndex === undefined ||
      (Number.isInteger(h.auxiliaryFanIndex) &&
        h.auxiliaryFanIndex >= 1 &&
        h.auxiliaryFanIndex <= 255)) &&
    (p.firmware !== undefined ||
      h.auxiliaryFan !== true ||
      h.auxiliaryFanIndex !== undefined) &&
    (h.abrasiveTools === undefined ||
      (Array.isArray(h.abrasiveTools) &&
        new Set(h.abrasiveTools).size === h.abrasiveTools.length &&
        h.abrasiveTools.every(
          (t) => Number.isInteger(t) && t >= 0 && t < physicalToolCount(p),
        )))
  );
}
export function modelTools(m: Model): number[] {
  const used = new Set([m.tool ?? 0]);
  for (const tool of m.faceTools ?? []) used.add(tool);
  return [...used];
}
export function activeMaterialTools(
  models: Model[],
  s: Settings,
  multi: MultiMaterialSettings,
): Set<number> {
  const used = new Set(models.filter((m) => m.visible).flatMap(modelTools));
  if (s.supports !== "disabled" && used.size) used.add(multi.supportTool);
  return used;
}
export function materialCompatibility(
  models: Model[],
  p: Printer,
  filaments: Filament[],
  s: Settings,
  multi: MultiMaterialSettings,
) {
  const errors: string[] = [],
    warnings: string[] = [];
  if (!validPrinterHardware(p))
    return { errors: ["Invalid printer hardware configuration."], warnings };
  const hardware = printerHardware(p),
    feed = filamentFeed(p);
  const used = activeMaterialTools(models, s, multi);
  const ranges: [number, number][] = [];
  for (const tool of used) {
    const f = filaments[tool];
    if (!f) continue;
    if (!validMaterialCode(f.material)) {
      errors.push(`Filament ${tool + 1} has an invalid material code.`);
      continue;
    }
    const label = `Filament ${tool + 1} (${f.material})`;
    if ((f.auxiliaryFan ?? 0) > 0 && auxiliaryFanIndex(p) === undefined)
      errors.push(
        `${label} requests auxiliary cooling, but this printer has no configured auxiliary fan. Disable that spool override or configure installed fan hardware.`,
      );
    if (!validMaterialRequirements(f.requirements)) {
      errors.push(`${label} has invalid material requirements.`);
      continue;
    }
    const r = materialRequirements(f, feed),
      family = materialFamily(f.material);
    const head = p.multiMaterialMode === "toolchanger" ? tool : 0;
    if (r.enclosure && hardware.enclosed !== true)
      errors.push(
        `${label} requires an enclosure or top cover. Configure the installed hardware in Printer configuration, or adjust this spool's requirements for its manufacturer specification.`,
      );
    if (r.abrasive && !hardware.abrasiveTools.includes(head))
      errors.push(
        `${label} requires an abrasion-resistant nozzle and feed gears on physical head ${head + 1}. Configure that head's installed hardware.`,
      );
    if (p.nozzle < r.minNozzle - 1e-6)
      errors.push(
        `${label} requires a nozzle of at least ${r.minNozzle} mm; this profile uses ${p.nozzle} mm.`,
      );
    if (
      feed &&
      (r.feedCompatibility === "incompatible" ||
        (["TPU", "TPE"].includes(family ?? "") &&
          r.feedCompatibility !== "compatible"))
    )
      errors.push(
        `${label} is not configured as compatible with ${feed}. Use a filament approved for this feed system or a suitable direct-feed printer profile.`,
      );
    else if (feed && r.abrasive && r.feedCompatibility === "unspecified")
      warnings.push(
        `${label}: verify the exact product's ${feed} compatibility. Abrasion-resistant printer hardware does not establish feeder compatibility.`,
      );
    if (feed && ["PVA", "BVOH"].includes(family ?? ""))
      warnings.push(
        `${label}: ${feed} requires this soluble support filament to be dry; wet filament can soften in the feed path.`,
      );
    if (r.bedRange) {
      ranges.push(r.bedRange);
      for (const [name, value] of [
        ["Bed temperature", s.bedTemp],
        ["First-layer bed temperature", s.firstBedTemp],
      ] as const)
        if (value < r.bedRange[0] || value > r.bedRange[1])
          errors.push(
            `${name} ${value}°C is outside ${label}'s configured ${r.bedRange[0]}–${r.bedRange[1]}°C range. All filaments share the bed.`,
          );
    }
    if (!family)
      warnings.push(
        `${label}: material family is unknown. Verify all configured requirements against its manufacturer data.`,
      );
    if (
      p.firmware === "snapmaker-u1" &&
      ["TPU", "TPE"].includes(family ?? "") &&
      multi.purgeTower &&
      used.size > 1
    )
      warnings.push(
        `${label}: flexible-material towers can lack rigidity. Inspect tower geometry and use material-specific priming and cooling settings.`,
      );
  }
  if (
    ranges.length > 1 &&
    Math.max(...ranges.map((r) => r[0])) > Math.min(...ranges.map((r) => r[1]))
  )
    errors.push(
      "The active filaments' configured bed-temperature ranges do not overlap. Use compatible materials or separate build plates.",
    );
  const assemblies = new Map<string, Set<string>>();
  for (const m of models.filter((m) => m.visible)) {
    const key = m.assemblyId || m.id;
    const families = assemblies.get(key) ?? new Set<string>();
    for (const t of modelTools(m)) {
      const family =
        filaments[t] && validMaterialCode(filaments[t].material)
          ? materialFamily(filaments[t].material)
          : undefined;
      if (family) families.add(family);
    }
    assemblies.set(key, families);
  }
  for (const families of assemblies.values())
    if (families.size > 1)
      warnings.push(
        `Linked or painted parts combine ${[...families].sort().join(" + ")}. Bonding and shrinkage depend on the exact materials; validate the joint or use mechanical interlocking.`,
      );
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
