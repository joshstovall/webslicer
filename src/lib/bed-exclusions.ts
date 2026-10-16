import type { Printer } from "../types";
export interface BedRectangle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
/** Pinned Bambu 0.4 mm X1C/P1 profiles reserve x=0..18, y=0..28 mm.
 * A1/A1 mini explicitly override the inherited exclusion with an empty list.
 * Derive from the profile identity so older saved projects also retain this limit.
 */
export function bedExclusions(
  printer: Printer,
  centered = true,
): BedRectangle[] {
  if (
    printer.firmware !== "bambu" ||
    !["bambu-x1c", "bambu-p1s", "bambu-p1p"].includes(printer.id)
  )
    return [];
  const x = centered ? -printer.bed[0] / 2 : (printer.bedOrigin?.[0] ?? 0);
  const y = centered ? -printer.bed[1] / 2 : (printer.bedOrigin?.[1] ?? 0);
  return [{ minX: x, minY: y, maxX: x + 18, maxY: y + 28 }];
}
export function rectanglesOverlap(
  a: BedRectangle,
  b: BedRectangle,
  margin = 0,
) {
  return (
    a.minX < b.maxX + margin &&
    a.maxX > b.minX - margin &&
    a.minY < b.maxY + margin &&
    a.maxY > b.minY - margin
  );
}
export function segmentHitsRectangle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: BedRectangle,
  margin = 0,
) {
  let enter = 0,
    leave = 1;
  for (const [start, end, min, max] of [
    [x1, x2, r.minX - margin, r.maxX + margin],
    [y1, y2, r.minY - margin, r.maxY + margin],
  ]) {
    const delta = end - start;
    if (Math.abs(delta) < 1e-9) {
      if (start <= min || start >= max) return false;
    } else {
      const a = (min - start) / delta,
        b = (max - start) / delta;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
      if (enter >= leave) return false;
    }
  }
  return true;
}
