// Stratum bridge classification: compare solid-fill paths with the previous
// physical layer across every material. No vendor firmware code is included.
const EPS = 1e-7;
function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    const cross = (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
    if (
      Math.abs(cross) < EPS &&
      x >= Math.min(a.x, b.x) - EPS &&
      x <= Math.max(a.x, b.x) + EPS &&
      y >= Math.min(a.y, b.y) - EPS &&
      y <= Math.max(a.y, b.y) + EPS
    )
      return true;
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function contains(poly, x, y) {
  return (
    ringContains(poly.points, x, y) &&
    !(poly.inner ?? []).some((h) => contains(h, x, y))
  );
}
function rings(poly, out = []) {
  out.push(poly.points);
  for (const inner of poly.inner ?? []) rings(inner, out);
  return out;
}
function polygon(poly, offset) {
  const points = poly.points.map((p) => ({
    x: p.x + offset.x,
    y: p.y + offset.y,
  }));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    points,
    inner: (poly.inner ?? []).map((p) => polygon(p, offset)),
    minX,
    minY,
    maxX,
    maxY,
  };
}
/** Length of a line's unsupported portions, with holes and overlapping material footprints. */
export function unsupportedLength(a, b, polys) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  if (length < EPS) return 0;
  const candidates = polys.filter(
    (p) =>
      p.maxX >= Math.min(a.x, b.x) - EPS &&
      p.minX <= Math.max(a.x, b.x) + EPS &&
      p.maxY >= Math.min(a.y, b.y) - EPS &&
      p.minY <= Math.max(a.y, b.y) + EPS,
  );
  const cuts = [0, 1];
  for (const poly of candidates)
    for (const ring of rings(poly))
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const p = ring[j],
          q = ring[i],
          ex = q.x - p.x,
          ey = q.y - p.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < EPS) {
          if (Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) < EPS) {
            for (const v of [p, q]) {
              const t =
                ((v.x - a.x) * dx + (v.y - a.y) * dy) / (length * length);
              if (t > 0 && t < 1) cuts.push(t);
            }
          }
          continue;
        }
        const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den,
          u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
        if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) cuts.push(t);
      }
  cuts.sort((x, y) => x - y);
  let unsupported = 0;
  for (let i = 1; i < cuts.length; i++) {
    const low = cuts[i - 1],
      high = cuts[i];
    if (high - low < EPS) continue;
    const mid = (low + high) / 2,
      x = a.x + dx * mid,
      y = a.y + dy * mid;
    if (!candidates.some((p) => contains(p, x, y)))
      unsupported += (high - low) * length;
  }
  return unsupported;
}
export function annotateBridges(layers, widgets, lineWidth) {
  // Sorted per-widget slices allow binary lookup without a quadratic scan of
  // every slice for every output layer. Build polygon data only when needed.
  const sources = widgets.map((w) => ({
    offset: w.offset ?? { x: 0, y: 0, z: 0 },
    slices: (w.slices ?? [])
      .map((s) => ({ slice: s, top: s.z + (w.offset?.z ?? 0) + s.height / 2 }))
      .sort((a, b) => a.top - b.top),
  }));
  let feature, last;
  for (const layer of layers) {
    const bottom = layer.z - (layer.slice?.height ?? layer.height);
    let footprints;
    const support = () => {
      if (footprints) return footprints;
      footprints = [];
      for (const source of sources) {
        let lo = 0,
          hi = source.slices.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (source.slices[mid].top < bottom - 0.015) lo = mid + 1;
          else hi = mid;
        }
        const rec = source.slices[lo];
        // A previously printed slice can overlap the new layer base when
        // material parts have different slice elevations. Actual gaps and
        // material at/above this layer cannot provide support.
        if (
          !rec ||
          rec.top >= layer.z - EPS ||
          rec.top - rec.slice.height > bottom + 0.015
        )
          continue;
        for (const top of rec.slice.tops ?? [])
          footprints.push(polygon(top.poly, source.offset));
        for (const poly of rec.slice.supports ?? [])
          footprints.push(polygon(poly, source.offset));
      }
      return footprints;
    };
    for (const out of layer) {
      feature = out.type ?? feature;
      out.stratumBridge = false;
      if (
        out.emit > 0 &&
        out.point &&
        last &&
        bottom > 0.015 &&
        feature === "solid fill"
      )
        out.stratumBridge =
          unsupportedLength(last, out.point, support()) >
          Math.max(0.05, lineWidth / 2);
      if (out.point) last = out.point;
    }
  }
}
