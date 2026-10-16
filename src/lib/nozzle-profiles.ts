import type { Printer, Project, Settings } from "../types";
export const VENDOR_NOZZLES = [0.2, 0.4, 0.6, 0.8] as const;
const bambuIds = [
  "bambu-x1c",
  "bambu-p1s",
  "bambu-p1p",
  "bambu-a1",
  "bambu-a1-mini",
];
export function knownVendorPrinter(p: Printer) {
  return p.firmware === "bambu"
    ? bambuIds.includes(p.id)
    : p.firmware === "snapmaker-u1" && p.id === "snapmaker-u1";
}
export function vendorNozzleLimits(p: Printer) {
  if (
    !knownVendorPrinter(p) ||
    !(VENDOR_NOZZLES as readonly number[]).includes(p.nozzle)
  )
    return;
  return {
    min: Number((p.nozzle * 0.2).toFixed(3)),
    max:
      p.firmware === "snapmaker-u1" && p.nozzle === 0.4
        ? 0.32
        : Number((p.nozzle * 0.7).toFixed(3)),
  };
}
export function nozzleProfileErrors(p: Printer, s?: Settings): string[] {
  if (!p.firmware) return [];
  const limits = vendorNozzleLimits(p);
  if (!limits)
    return [
      "Select a supported official printer and a 0.2, 0.4, 0.6 or 0.8 mm nozzle.",
    ];
  const errors: string[] = [];
  if ((p.profileNozzle ?? 0.4) !== p.nozzle)
    errors.push(
      "The machine sequences belong to a different nozzle diameter. Open Printer configuration and save to load the matching official profile.",
    );
  if (p.filament !== 1.75)
    errors.push("Official Bambu and U1 profiles require 1.75 mm filament.");
  if (!s) return errors;
  for (const [name, value] of [
    ["Layer height", s.layerHeight],
    ["First-layer height", s.firstLayerHeight],
  ] as const)
    if (
      !Number.isFinite(value) ||
      value < limits.min - 1e-8 ||
      value > limits.max + 1e-8
    )
      errors.push(
        `${name} must be ${limits.min}–${limits.max} mm for this ${p.nozzle} mm nozzle profile.`,
      );
  if (
    s.adaptive &&
    (!Number.isFinite(s.minLayerHeight) ||
      s.minLayerHeight < limits.min - 1e-8 ||
      s.minLayerHeight > s.layerHeight)
  )
    errors.push(
      `Adaptive minimum height must be between ${limits.min} mm and the normal layer height.`,
    );
  if (
    !Number.isFinite(s.lineWidth) ||
    s.lineWidth < p.nozzle * 0.6 - 1e-8 ||
    s.lineWidth > p.nozzle * 2 + 1e-8
  )
    errors.push(
      "Line width must be between 60% and 200% of the nozzle diameter.",
    );
  return errors;
}
/** Stratum geometric defaults; retraction comes from the pinned machine profiles. */
export function nozzleSettings(p: Printer): Partial<Settings> {
  const round = (v: number) => Number(v.toFixed(3));
  const n = p.nozzle;
  const index = (VENDOR_NOZZLES as readonly number[]).indexOf(n);
  const retraction =
    p.firmware === "snapmaker-u1"
      ? [0.4, 1.5, 1.4, 1.5][index]
      : p.id === "bambu-a1"
        ? 0.8
        : [0.4, 0.8, 1.4, 3][index];
  return {
    manualLayers: false,
    layerHeight: round(n * 0.5),
    firstLayerHeight: round(n * 0.6),
    lineWidth: round(n * 1.05),
    minLayerHeight: round(Math.max(0.04, n * 0.2)),
    supportOffset: n,
    ...(p.firmware && retraction !== undefined ? { retraction } : {}),
  };
}
export function applyPrinter(project: Project, printer: Printer): Project {
  return {
    ...project,
    printer,
    settings:
      project.printer.nozzle === printer.nozzle
        ? project.settings
        : { ...project.settings, ...nozzleSettings(printer) },
  };
}
