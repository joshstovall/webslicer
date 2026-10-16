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

/** Bounded, ordered control points in model-space millimeters. */
export function validLayerCurve(points) {
  return (
    Array.isArray(points) &&
    points.length >= 2 &&
    points.length <= 128 &&
    points.every(
      (p, i) =>
        p &&
        typeof p === "object" &&
        Number.isFinite(p.z) &&
        p.z >= 0 &&
        p.z <= 2000 &&
        Number.isFinite(p.height) &&
        p.height >= UNIT &&
        p.height <= 2 &&
        (i === 0 ? p.z === 0 : p.z - points[i - 1].z >= UNIT - 1e-9),
    )
  );
}
export function sampleLayerCurve(points, z) {
  if (z <= points[0].z) return points[0].height;
  let low = 1,
    high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].z < z) low = mid + 1;
    else high = mid;
  }
  if (z <= points[low].z) {
    const a = points[low - 1],
      b = points[low];
    return a.height + ((b.height - a.height) * (z - a.z)) / (b.z - a.z);
  }
  return points.at(-1).height;
}
/** One manual schedule shared by all objects/materials; targets are sampled at midplanes. */
export function planManualLayers(parts, process) {
  const points = process.stratumLayerCurve;
  if (!points) return undefined;
  if (!validLayerCurve(points))
    throw new Error("Invalid manual layer-height curve.");
  const minimum = Math.ceil(process.sliceMinHeight / UNIT - 1e-7);
  const maximum = Math.floor(process.sliceHeight / UNIT + 1e-7);
  const first = Math.round(process.firstSliceHeight / UNIT);
  if (
    ![minimum, maximum, first].every((v) => Number.isFinite(v) && v > 0) ||
    minimum > maximum
  )
    throw new Error(
      "Manual layer heights cannot be represented at the engine's precision.",
    );
  if (
    points.some(
      (p) =>
        p.height < minimum * UNIT - 1e-9 || p.height > maximum * UNIT + 1e-9,
    )
  )
    throw new Error(
      "Manual curve heights must stay within the minimum and normal layer heights.",
    );
  let highest = 0;
  for (const part of parts)
    for (let i = 2; i < part.vertices.length; i += 3) {
      const z = part.vertices[i];
      if (!Number.isFinite(z))
        throw new Error("Model contains a non-finite height.");
      highest = Math.max(highest, Math.round(z / UNIT));
    }
  const tops = [first];
  const push = (top) => {
    if (tops.length >= LIMIT)
      throw new Error(
        "Manual slicing exceeds 100,000 layers. Increase the minimum layer height.",
      );
    tops.push(top);
  };
  while (tops.at(-1) < highest) {
    const start = tops.at(-1),
      remaining = highest - start;
    // Solve h = target(start + h/2), bracketed by the legal height limits.
    // Bisection remains bounded for steep curves where fixed-point iteration oscillates.
    let low = minimum,
      high = maximum;
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (mid < sampleLayerCurve(points, (start + mid / 2) * UNIT) / UNIT)
        low = mid;
      else high = mid;
    }
    const height = Math.max(
      minimum,
      Math.min(maximum, Math.round((low + high) / 2)),
    );
    if (remaining >= height) {
      push(start + height);
      continue;
    }
    if (remaining >= minimum) {
      push(highest);
      break;
    }
    // A sub-minimum final layer cannot be printed. Rebalance the shortest feasible
    // tail, preserving the fixed first layer and all earlier curve-following layers.
    let fitted = false;
    for (let i = tops.length - 2; i >= 0; i--) {
      const span = highest - tops[i],
        count = Math.ceil(span / maximum);
      if (count * minimum > span) continue;
      const begin = tops[i];
      tops.length = i + 1;
      for (let j = 1; j <= count; j++)
        push(begin + Math.round((span * j) / count));
      fitted = true;
      break;
    }
    if (!fitted && remaining > minimum / 2) push(start + minimum);
    break;
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
