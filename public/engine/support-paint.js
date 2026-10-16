/* Original Stratum surface support selection. MIT; see NOTICE.md. */
function clipZ(points, z, above) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const insideA = above ? a[2] >= z - 1e-6 : a[2] <= z + 1e-6;
    const insideB = above ? b[2] >= z - 1e-6 : b[2] <= z + 1e-6;
    if (insideA) out.push(a);
    if (insideA !== insideB) {
      const t = Math.max(0, Math.min(1, (z - a[2]) / (b[2] - a[2])));
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), z]);
    }
  }
  return out;
}

/** Sweep contact intervals in ascending Z without rescanning the entire painted mesh. */
export function supportPaintMasker(records, api) {
  const triangles = [];
  for (let i = 0; i < records.length; i += 10) {
    const state = records[i];
    const a = records.slice(i + 1, i + 4),
      b = records.slice(i + 4, i + 7),
      c = records.slice(i + 7, i + 10);
    // Native model vertices are rounded to microns before slice-plane classification.
    for (const p of [a, b, c]) p[2] = Math.round(p[2] * 1000) / 1000;
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (nz < -1e-10)
      triangles.push({
        state,
        points: [a, b, c],
        min: Math.min(a[2], b[2], c[2]),
        max: Math.max(a[2], b[2], c[2]),
      });
  }
  triangles.sort((a, b) => a.min - b.min);
  let cursor = 0,
    previous = -Infinity;
  const active = new Set();
  return (lower, upper) => {
    if (lower < previous) {
      cursor = 0;
      active.clear();
    }
    previous = lower;
    while (cursor < triangles.length && triangles[cursor].min <= upper + 1e-6)
      active.add(triangles[cursor++]);
    const enforce = [],
      block = [];
    for (const triangle of active) {
      if (triangle.max <= lower + 1e-6) {
        active.delete(triangle);
        continue;
      }
      const points = clipZ(clipZ(triangle.points, lower, true), upper, false);
      if (points.length < 3) continue;
      const polygon = api.polygon(
        points.map((p) => api.point(p[0], p[1], lower)),
      );
      if (polygon.area() > 1e-8)
        (triangle.state === 1 ? enforce : block).push(polygon);
    }
    return { enforce, block };
  };
}
