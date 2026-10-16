import type { Filament, Printer, Settings } from "../types";
/** Manufacturer limits. X1C depends on the configured mains supply. Sources: docs/material-settings.md. */
export function thermalLimits(
  printer: Printer,
): { nozzle: number; bed: number } | undefined {
  if (printer.firmware === "snapmaker-u1" && printer.id === "snapmaker-u1")
    return { nozzle: 300, bed: 100 };
  if (printer.firmware !== "bambu") return;
  const beds: Record<string, number> = {
    "bambu-x1c": printer.mainsVoltage === 110 ? 120 : 110,
    "bambu-p1s": 100,
    "bambu-p1p": 100,
    "bambu-a1": 100,
    "bambu-a1-mini": 80,
  };
  if (beds[printer.id]) return { nozzle: 300, bed: beds[printer.id] };
}
export function thermalErrors(
  printer: Printer,
  settings: Settings,
  filaments: Filament[],
  used: Iterable<number>,
): string[] {
  const limits = thermalLimits(printer),
    errors: string[] = [];
  for (const [label, value] of [
    ["Bed temperature", settings.bedTemp],
    ["First-layer bed temperature", settings.firstBedTemp],
  ] as const)
    if (!Number.isFinite(value) || value < 0 || value > (limits?.bed ?? 130))
      errors.push(
        `${label} must be between 0 and ${limits?.bed ?? 130}°C for ${printer.name}.`,
      );
  for (const tool of used) {
    const f = filaments[tool];
    if (!f) continue;
    for (const [label, value] of [
      ["temperature", f.nozzleTemp],
      ["first-layer temperature", f.firstNozzleTemp],
    ] as const)
      if (
        !Number.isFinite(value) ||
        value < 150 ||
        value > (limits?.nozzle ?? 350)
      )
        errors.push(
          `Filament ${tool + 1} ${label} must be between 150 and ${limits?.nozzle ?? 350}°C for ${printer.name}.`,
        );
  }
  return errors;
}
/** Explicit standard heater commands, including edited vendor macros. Opaque firmware macros remain firmware-owned. */
export function auditThermalCommands(gcode: string, printer: Printer) {
  const limits = thermalLimits(printer);
  if (!limits) return;
  for (const raw of gcode.split(/\r?\n/)) {
    const code = raw
      .split(";")[0]
      .trim()
      .replace(/^N\d+\s*/i, "");
    const match = code.match(/^M(104|109|140|190)(?:\.\d+)?(?=[A-Z\s]|$)/i);
    if (!match) continue;
    const max = ["140", "190"].includes(match[1]) ? limits.bed : limits.nozzle;
    for (const arg of code
      .slice(match[0].length)
      .matchAll(/([SRH])\s*([+-]?(?:\d*\.)?\d+)/gi)) {
      const value = Number(arg[2]);
      if (value < 0 || value > max)
        throw new Error(
          `Machine G-code requests ${value}°C in ${match[0].trim()}, outside the 0–${max}°C limit for ${printer.name}. Check filament settings and the machine sequence.`,
        );
    }
  }
}
