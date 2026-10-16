import type { Printer, Settings } from "../types";
import { validLayerCurve } from "../../public/engine/layer-plan.js";
import { vendorNozzleLimits } from "./nozzle-profiles";
export { validLayerCurve };
export function validManualLayerSettings(s: Partial<Settings>) {
  return (
    (s.manualLayers === undefined || typeof s.manualLayers === "boolean") &&
    (s.layerHeightCurve === undefined || validLayerCurve(s.layerHeightCurve)) &&
    (!s.manualLayers || (validLayerCurve(s.layerHeightCurve) && !s.adaptive))
  );
}
export function manualLayerErrors(p: Printer, s: Settings): string[] {
  if (!validManualLayerSettings(s))
    return [
      "Invalid manual layer-height settings. Use an ordered curve and select either manual or adaptive layers.",
    ];
  if (!s.manualLayers) return [];
  const bounds = vendorNozzleLimits(p) ?? {
    min: 0.04,
    max: Number((p.nozzle * 0.8).toFixed(3)),
  };
  if (
    !Number.isFinite(s.layerHeight) ||
    !Number.isFinite(s.minLayerHeight) ||
    s.minLayerHeight < bounds.min ||
    s.minLayerHeight > s.layerHeight ||
    s.layerHeight > bounds.max
  )
    return [
      `Manual layers require minimum and normal heights between ${bounds.min} and ${bounds.max} mm.`,
    ];
  if (
    s.layerHeightCurve!.some(
      (point) =>
        point.height < s.minLayerHeight - 1e-9 ||
        point.height > s.layerHeight + 1e-9,
    )
  )
    return [
      "Manual curve heights must stay within the minimum and normal layer heights. Edit the curve or change those limits.",
    ];
  return [];
}
export function flatLayerCurve(height: number, modelHeight: number) {
  return [
    { z: 0, height },
    { z: Math.min(2000, Math.max(1, Number(modelHeight.toFixed(3)))), height },
  ];
}
