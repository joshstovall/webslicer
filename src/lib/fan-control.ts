import type { Filament, Printer, Settings } from "../types";
/** P indices are firmware fan identifiers, never filament/head numbers. */
export function auxiliaryFanIndex(p: Printer): number | undefined {
  if (p.firmware === "snapmaker-u1")
    return p.hardware?.auxiliaryFan === false ? undefined : 2;
  if (p.firmware === "bambu") {
    if (!["bambu-x1c", "bambu-p1s", "bambu-p1p"].includes(p.id))
      return undefined;
    return (p.hardware?.auxiliaryFan ?? p.id !== "bambu-p1p") ? 2 : undefined;
  }
  return p.hardware?.auxiliaryFan ? p.hardware.auxiliaryFanIndex : undefined;
}
export function auxiliarySpeedAtLayer(f: Filament, s: Settings, layer: number) {
  const start = f.auxiliaryFanLayer ?? f.fanLayer ?? s.fanLayer;
  const ramp =
    f.auxiliaryFanRampLayers ?? f.fanRampLayers ?? s.fanRampLayers ?? 1;
  return Math.round(
    (((f.auxiliaryFan ?? 0) * 255) / 100) *
      Math.max(0, Math.min(1, (layer - start + 1) / ramp)),
  );
}
export function validExtraCooling(f: Filament) {
  return (
    [f.bridgeFan, f.auxiliaryFan].every(
      (v) =>
        v === undefined ||
        (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100),
    ) &&
    [f.auxiliaryFanLayer, f.auxiliaryFanRampLayers].every(
      (v) =>
        v === undefined ||
        (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 20),
    )
  );
}

/** Run after layer cooling, so the auxiliary fan stays on through its final wait. */
export function finalizeFanShutdown(gcode: string) {
  return gcode.replace(
    /;STRATUM_PRINT_END\n;STRATUM_AUX_SHUTDOWN:(\d+)/g,
    "M106 P$1 S0\n;STRATUM_PRINT_END",
  );
}
