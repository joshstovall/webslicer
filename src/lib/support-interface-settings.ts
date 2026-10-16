import type { Settings } from "../types";
export const SUPPORT_INTERFACE_LIMITS = {
  supportTopInterfaceLayers: [0, 10],
  supportBottomInterfaceLayers: [0, 10],
  supportInterfaceDensity: [5, 100],
  supportInterfaceAngle: [0, 180],
} as const;
export function supportInterfaceSettings(s: Settings) {
  return {
    supportTopInterfaceLayers: s.supportTopInterfaceLayers ?? 0,
    supportBottomInterfaceLayers: s.supportBottomInterfaceLayers ?? 0,
    supportInterfaceDensity: s.supportInterfaceDensity ?? 80,
    supportInterfaceAngle: s.supportInterfaceAngle ?? 0,
  };
}
export function supportInterfaceErrors(s: Settings) {
  const values = supportInterfaceSettings(s),
    errors: string[] = [];
  for (const [key, [min, max]] of Object.entries(SUPPORT_INTERFACE_LIMITS)) {
    const k = key as keyof typeof values,
      value = values[k],
      raw = s[k];
    if (
      (raw !== undefined && typeof raw !== "number") ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (key.endsWith("Layers") && !Number.isInteger(value))
    )
      errors.push(
        `Invalid support interface setting: ${key} (${min}–${max}${key.endsWith("Layers") ? " whole layers" : ""}).`,
      );
  }
  return errors;
}
