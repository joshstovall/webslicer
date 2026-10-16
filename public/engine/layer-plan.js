// Original Stratum plate-wide adaptive schedule. Kiri consumes slice midplanes,
// not layer tops. Integer microns avoid cumulative drift. Midplanes use the
// engine's 1 µm sampling grid; physical layer tops retain their exact heights.
const UNIT = 0.001;
const LIMIT = 100000;
export function planAdaptiveLayers(parts, process) {
  if (!process.sliceAdaptive) return undefined;
  const maximum = Math.floor(process.sliceHeight / UNIT + 1e-7);
  const minimum = Math.ceil(
    Math.min(process.sliceMinHeight, process.sliceHeight) / UNIT - 1e-7,
  );
  const first = Math.round(process.firstSliceHeight / UNIT);
  if (
    ![maximum, minimum, first].every((v) => Number.isFinite(v) && v > 0) ||
    minimum > maximum
  )
    throw new Error(
      "Adaptive layer heights cannot be represented at the engine's precision.",
    );
  const levels = new Set();
  let highest = 0;
  for (const part of parts) {
    for (let i = 2; i < part.vertices.length; i += 3) {
      const z = part.vertices[i];
      if (!Number.isFinite(z))
        throw new Error("Model contains a non-finite height.");
      const level = Math.round(z / UNIT);
      levels.add(level);
      highest = Math.max(highest, level);
    }
  }
  const tops = [first];
  const append = (start, end) => {
    const span = end - start;
    const count = Math.ceil(span / maximum);
    if (count < 1 || count * minimum > span) return false;
    if (tops.length + count > LIMIT)
      throw new Error(
        "Adaptive slicing exceeds 100,000 layers. Increase the minimum layer height.",
      );
    // Distribute integer units without accumulating floating-point drift.
    for (let i = 1; i <= count; i++)
      tops.push(start + Math.round((span * i) / count));
    return true;
  };
  for (const level of [...levels].sort((a, b) => a - b)) {
    if (level <= tops.at(-1) || level >= highest) continue;
    // Nearby features may be incompatible with the requested minimum. Keep
    // the boundary only when its entire interval has a feasible subdivision.
    append(tops.at(-1), level);
  }
  if (highest > first) {
    let fitted = false;
    // Rebalance the final interval if a thin remainder cannot form a layer.
    // Preserve the fixed first layer and as many earlier feature planes as possible.
    for (let i = tops.length - 1; i >= 0; i--) {
      const span = highest - tops[i];
      const count = Math.ceil(span / maximum);
      if (count > 0 && count * minimum <= span) {
        tops.length = i + 1;
        append(tops[i], highest);
        fitted = true;
        break;
      }
    }
    if (!fitted) {
      const start = tops.at(-1),
        span = highest - start;
      const below = Math.floor(span / minimum) * maximum;
      const above = Math.ceil(span / maximum) * minimum;
      // No exact partition exists (e.g. equal min/max). Use the closest legal
      // top, as fixed-height slicing does, rather than creating a thin layer.
      const adjusted = span - below <= above - span ? below : above;
      if (adjusted > 0) append(start, start + adjusted);
    }
  }
  let previous = 0;
  return tops.map((top) => {
    const layer = {
      z: Math.round((top + previous) / 2) / 1000,
      top: top / 1000,
      height: (top - previous) * UNIT,
    };
    previous = top;
    return layer;
  });
}
