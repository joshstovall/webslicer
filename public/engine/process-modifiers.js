/* Original Stratum regional speed/flow adapter. MIT; see NOTICE.md. */
const EPS = 1e-7;
const MODEL_FEATURES = new Set([
  "shells",
  "thin fill",
  "solid fill",
  "sparse infill",
]);
// Cross-sections stay immutable while a layer is processed. Weak keys release
// polygon/ring metadata with that layer instead of retaining a whole job.
const boundsCache = new WeakMap(),
  ringsCache = new WeakMap();
function bounds(points) {
  let cached = boundsCache.get(points);
  if (!cached) {
    cached = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    for (const p of points) {
      cached.minX = Math.min(cached.minX, p.x);
      cached.maxX = Math.max(cached.maxX, p.x);
      cached.minY = Math.min(cached.minY, p.y);
      cached.maxY = Math.max(cached.maxY, p.y);
    }
    boundsCache.set(points, cached);
  }
  return cached;
}
function overlaps(box, minX, minY, maxX, maxY) {
  return (
    box.maxX >= minX - EPS &&
    box.minX <= maxX + EPS &&
    box.maxY >= minY - EPS &&
    box.minY <= maxY + EPS
  );
}

function inRing(points, x, y) {
  if (!overlaps(bounds(points), x, y, x, y)) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j],
      b = points[i];
    if (
      Math.abs((x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)) < EPS &&
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
    inRing(poly.points, x, y) &&
    !(poly.inner ?? []).some((hole) => contains(hole, x, y))
  );
}
function rings(poly) {
  let result = ringsCache.get(poly);
  if (result) return result;
  result = [poly.points];
  for (const hole of poly.inner ?? [])
    for (const ring of rings(hole)) result.push(ring);
  ringsCache.set(poly, result);
  return result;
}

/** Exact XY boundary intersections, including holes, tangencies and collinear edges.
 * Intervals with equal settings are merged; defaults do not introduce extra moves.
 */
export function splitRegionMove(a, b, masks) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length2 = dx * dx + dy * dy;
  const minX = Math.min(a.x, b.x),
    minY = Math.min(a.y, b.y),
    maxX = Math.max(a.x, b.x),
    maxY = Math.max(a.y, b.y);
  const cuts = [0, 1];
  for (const mask of masks)
    for (const poly of mask.polys) {
      if (!overlaps(bounds(poly.points), minX, minY, maxX, maxY)) continue;
      for (const ring of rings(poly)) {
        if (!overlaps(bounds(ring), minX, minY, maxX, maxY)) continue;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const p = ring[j],
            q = ring[i],
            ex = q.x - p.x,
            ey = q.y - p.y;
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < EPS) {
            if (Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) < EPS)
              for (const v of [p, q]) {
                const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / length2;
                if (t > 0 && t < 1) cuts.push(t);
              }
          } else {
            const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
            const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
            if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) cuts.push(t);
          }
        }
      }
    }
  cuts.sort((x, y) => x - y);
  const result = [];
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1],
      hi = cuts[i];
    if (hi - lo < EPS) continue;
    const mid = (lo + hi) / 2,
      x = a.x + dx * mid,
      y = a.y + dy * mid;
    let speed = 1,
      flow = 1,
      walls;
    for (const mask of masks)
      if (mask.polys.some((p) => contains(p, x, y))) {
        if (mask.speedPercent !== undefined) speed = mask.speedPercent / 100;
        if (mask.flowPercent !== undefined) flow = mask.flowPercent / 100;
        if (mask.walls !== undefined) walls = mask.walls;
      }
    const previous = result.at(-1);
    if (
      previous &&
      previous.speed === speed &&
      previous.flow === flow &&
      previous.walls === walls
    )
      previous.end = hi;
    else
      result.push({
        end: hi,
        speed,
        flow,
        ...(walls === undefined ? {} : { walls }),
      });
  }
  return result;
}

/** Apply after path planning and before bridge classification/export. The output
 * widget owns each move; coincident unrelated objects cannot inherit modifiers.
 * Cross-sections are cached only for the current physical layer to bound memory.
 */
export async function applyProcessModifiers(layers, widgets, process, api) {
  const sources = new Map();
  for (const widget of widgets) {
    if (widget.support) continue;
    const modifiers = (widget.anno?.stratumProcessModifiers ?? []).filter(
      (m) => m.speedPercent !== undefined || m.flowPercent !== undefined,
    );
    if (!modifiers.length) continue;
    const prepared = modifiers.map((m) => {
      const points = [];
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < m.vertices.length; i += 3) {
        const p = api.point(
          m.vertices[i],
          m.vertices[i + 1],
          m.vertices[i + 2],
        );
        points.push(p);
        min = Math.min(min, p.z);
        max = Math.max(max, p.z);
      }
      return { ...m, points, min, max };
    });
    const slices = new Map();
    for (const slice of widget.slices ?? []) {
      if (!(slice.height > 0) || slice.index < 0) continue;
      const top =
        process.stratumLayerPlan?.[slice.index]?.top ??
        (process.stratumAlignedLayers
          ? (process.firstSliceHeight || process.sliceHeight) +
            slice.index * process.sliceHeight
          : slice.z + slice.height / 2);
      slices.set(Math.round((top + (widget.offset?.z ?? 0)) * 1e6), slice);
    }
    sources.set(widget, { modifiers: prepared, slices });
  }
  if (!sources.size) return;
  let last,
    feature,
    added = 0;
  for (const layer of layers) {
    const cache = new Map(),
      output = [];
    for (const out of layer) {
      feature = out.type ?? feature;
      const source = sources.get(out.widget);
      let segments;
      if (
        source &&
        last &&
        out.point &&
        out.emit > 0 &&
        MODEL_FEATURES.has(feature)
      ) {
        if (out.center)
          throw new Error("Regional settings require linear planned moves.");
        let masks = cache.get(out.widget);
        if (!masks) {
          masks = [];
          const slice = source.slices.get(Math.round(layer.z * 1e6));
          if (slice)
            for (const m of source.modifiers) {
              if (slice.z < m.min || slice.z > m.max) continue;
              const section = await api.slice(slice.z, m.points, {
                strict: true,
                union: true,
                zMin: m.min,
                zMax: m.max,
              });
              if (section.groups?.some((p) => p.open))
                throw new Error(
                  m.name + ": regional settings require closed cross-sections.",
                );
              const polys = api.polygons.nest(section.groups ?? []);
              if (polys.length)
                masks.push({
                  polys,
                  speedPercent: m.speedPercent,
                  flowPercent: m.flowPercent,
                });
            }
          cache.set(out.widget, masks);
        }
        if (masks.length) {
          const offset = out.widget.offset ?? { x: 0, y: 0 };
          segments = splitRegionMove(
            { x: last.x - offset.x, y: last.y - offset.y },
            { x: out.point.x - offset.x, y: out.point.y - offset.y },
            masks,
          );
        }
      }
      if (
        !segments ||
        (segments.length === 1 &&
          segments[0].speed === 1 &&
          segments[0].flow === 1)
      )
        output.push(out);
      else {
        if ((added += segments.length - 1) > 2_000_000)
          throw new Error(
            "Regional settings create too many path segments. Simplify the modifier geometry.",
          );
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          const point = out.point.clone();
          if (segment.end < 1)
            for (const axis of ["x", "y", "z"])
              point[axis] =
                last[axis] + (out.point[axis] - last[axis]) * segment.end;
          const next = Object.assign(
            Object.create(Object.getPrototypeOf(out)),
            out,
            {
              point,
              speed: (out.speed || process.outputFeedrate) * segment.speed,
              emit: out.emit * segment.flow,
            },
          );
          // Retraction follows the complete move; modal changes precede only its first piece.
          if (i < segments.length - 1) next.retract = false;
          if (i > 0) {
            next.fan = undefined;
            next.type = undefined;
          }
          output.push(next);
        }
      }
      if (out.point) last = out.point;
    }
    layer.length = 0;
    for (const out of output) layer.push(out);
  }
}
