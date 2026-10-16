import type { Settings } from "../types";
export const TREE_LIMITS = {
  treeBranchAngle: [5, 60],
  treeBranchSpacing: [1, 10],
  treeTipDiameter: [0.4, 6],
  treeBranchDiameter: [1, 30],
} as const;
export function treeSettings(s: Settings) {
  return {
    treeBranchAngle: s.treeBranchAngle ?? 40,
    treeBranchSpacing: s.treeBranchSpacing ?? 3,
    treeTipDiameter: s.treeTipDiameter ?? Math.max(1.6, 2 * s.lineWidth),
    treeBranchDiameter: s.treeBranchDiameter ?? 8,
  };
}
export function treeSettingErrors(s: Settings) {
  const values = treeSettings(s),
    errors: string[] = [];
  for (const [key, [min, max]] of Object.entries(TREE_LIMITS)) {
    const value = values[key as keyof typeof values];
    const raw = s[key as keyof typeof values];
    if (
      (raw !== undefined && typeof raw !== "number") ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      errors.push(`Invalid tree support setting: ${key} (${min}–${max}).`);
  }
  if (values.treeTipDiameter < 2 * s.lineWidth)
    errors.push("Tree tip diameter must be at least two extrusion widths.");
  if (values.treeBranchDiameter < values.treeTipDiameter)
    errors.push("Tree branch diameter must be at least the tip diameter.");
  return errors;
}
