import type { ArrangeOptions } from "./placement";
export const ARRANGE_PREFERENCES_KEY = "stratum-arrange-options";
export const DEFAULT_ARRANGE_OPTIONS: ArrangeOptions = {
  gap: 8,
  edge: 8,
  rotate: true,
};
export function parseArrangeOptions(value: unknown): ArrangeOptions {
  const saved =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const length = (key: "gap" | "edge") =>
    typeof saved[key] === "number" &&
    Number.isFinite(saved[key]) &&
    saved[key] >= 0 &&
    saved[key] <= 100
      ? (saved[key] as number)
      : DEFAULT_ARRANGE_OPTIONS[key];
  return {
    gap: length("gap"),
    edge: length("edge"),
    rotate:
      typeof saved.rotate === "boolean"
        ? saved.rotate
        : DEFAULT_ARRANGE_OPTIONS.rotate,
  };
}
export function loadArrangePreferences(): ArrangeOptions {
  try {
    const text = localStorage.getItem(ARRANGE_PREFERENCES_KEY);
    return parseArrangeOptions(
      text && text.length < 1024 ? JSON.parse(text) : null,
    );
  } catch {
    return { ...DEFAULT_ARRANGE_OPTIONS };
  }
}
export function saveArrangePreferences(options: ArrangeOptions): void {
  try {
    localStorage.setItem(
      ARRANGE_PREFERENCES_KEY,
      JSON.stringify(parseArrangeOptions(options)),
    );
  } catch {
    /* Placement remains usable when browser storage is unavailable. */
  }
}
