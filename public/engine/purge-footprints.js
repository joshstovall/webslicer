/* Original Stratum outline-aware purge placement. MIT; see NOTICE.md. */
const EPS = 1e-7;
const MAX_CHECKS = 200000;
const MAX_EDGES = 8000000;
const overlap = (a, b) =>
  a.minX < b.maxX - EPS &&
  a.maxX > b.minX + EPS &&
  a.minY < b.maxY - EPS &&
  a.maxY > b.minY + EPS;
function rectBounds(points) {
  const r = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
      throw new Error("Invalid purge footprint coordinates.");
    r.minX = Math.min(r.minX, p.x);
    r.maxX = Math.max(r.maxX, p.x);
    r.minY = Math.min(r.minY, p.y);
    r.maxY = Math.max(r.maxY, p.y);
  }
  return r;
}
function insideRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function inside(poly, x, y) {
  if (
    poly.bounds &&
    (x < poly.bounds.minX ||
      x > poly.bounds.maxX ||
      y < poly.bounds.minY ||
      y > poly.bounds.maxY)
  )
    return false;
  return (
    insideRing(poly.points, x, y) &&
    !(poly.inner || []).some((p) => inside(p, x, y))
  );
}
function segmentCrosses(a, b, r) {
  let low = 0,
    high = 1;
  for (const [start, end, min, max] of [
    [a.x, b.x, r.minX + EPS, r.maxX - EPS],
    [a.y, b.y, r.minY + EPS, r.maxY - EPS],
  ]) {
    const delta = end - start;
    if (Math.abs(delta) < 1e-12) {
      if (start <= min || start >= max) return false;
    } else {
      const u = (min - start) / delta,
        v = (max - start) / delta;
      low = Math.max(low, Math.min(u, v));
      high = Math.min(high, Math.max(u, v));
      if (low >= high) return false;
    }
  }
  return true;
}
/** Complete rectangle/polygon overlap, including holes, islands and crossing edges. */
export function outlineCollision(polygons) {
  let edges = 0,
    checks = 0,
    vertices = 0;
  const contours = [];
  function prepare(p, depth = 0) {
    if (depth > 64 || !Array.isArray(p.points) || p.points.length < 3)
      throw new Error("Invalid purge footprint contour.");
    vertices += p.points.length;
    if (vertices > 250000)
      throw new Error(
        "Purge footprint complexity limit reached. Simplify the plate.",
      );
    const bounds = rectBounds(p.points);
    contours.push({ points: p.points, bounds });
    return {
      points: p.points,
      bounds,
      inner: (p.inner || []).map((c) => prepare(c, depth + 1)),
    };
  }
  const shapes = polygons.map((p) => prepare(p));
  function boundary(p, r) {
    if (!overlap(p.bounds, r)) return false;
    for (let i = 0, j = p.points.length - 1; i < p.points.length; j = i++) {
      if (++edges > MAX_EDGES)
        throw new Error(
          "Purge placement search limit reached. Set a manual tower position or simplify the plate.",
        );
      if (segmentCrosses(p.points[i], p.points[j], r)) return true;
    }
    return p.inner.some((p) => boundary(p, r));
  }
  return {
    contours,
    hits(r) {
      if (++checks > MAX_CHECKS)
        throw new Error(
          "Purge placement search limit reached. Set a manual tower position or simplify the plate.",
        );
      for (const p of shapes) {
        if (!overlap(p.bounds, r)) continue;
        if (boundary(p, r)) return true;
        // If no boundary crosses the rectangle's interior, its center has the
        // same occupancy as all its interior. This also handles exact touching.
        if (inside(p, (r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2))
          return true;
      }
      return false;
    },
  };
}
/** Finite contour-aligned search; every accepted square gets a full outline check. */
export function placeOutlineBlocks({
  limits,
  span,
  count,
  obstacles,
  outline,
}) {
  const vertices = outline.contours.flatMap((c) => c.points);
  const sampled = vertices.filter(
    (_, i) => i % Math.max(1, Math.ceil(vertices.length / 96)) === 0,
  );
  const anchors = outline.contours.flatMap((c) => [
    { x: c.bounds.minX, y: c.bounds.minY },
    { x: c.bounds.maxX, y: c.bounds.maxY },
    {
      x: (c.bounds.minX + c.bounds.maxX) / 2 - span / 2,
      y: (c.bounds.minY + c.bounds.maxY) / 2 - span / 2,
    },
  ]);
  const seed = [
    ...sampled,
    ...anchors.filter(
      (_, i) => i % Math.max(1, Math.ceil(anchors.length / 96)) === 0,
    ),
  ];
  let visits = 0;
  for (const swap of [false, true])
    for (const reverse of [false, true]) {
      const placed = [],
        occupied = [...obstacles];
      for (let block = 0; block < count; block++) {
        const coords = (axis) => {
          const lo = axis === "x" ? "minX" : "minY",
            hi = axis === "x" ? "maxX" : "maxY";
          return [
            ...new Set([
              limits[lo],
              limits[hi] - span,
              ...seed.flatMap((p) => [p[axis], p[axis] - span]),
              ...occupied.flatMap((r) => [r[hi], r[lo] - span]),
            ]),
          ]
            .filter(
              (v) => v >= limits[lo] - EPS && v + span <= limits[hi] + EPS,
            )
            .sort((a, b) => (reverse ? b - a : a - b));
        };
        const xs = coords("x"),
          ys = coords("y");
        let choice;
        for (const a of swap ? ys : xs) {
          for (const b of swap ? xs : ys) {
            if (++visits > MAX_CHECKS)
              throw new Error(
                "Purge placement search limit reached. Set a manual tower position or simplify the plate.",
              );
            const x = swap ? b : a,
              y = swap ? a : b,
              r = { minX: x, maxX: x + span, minY: y, maxY: y + span };
            if (!occupied.some((o) => overlap(o, r)) && !outline.hits(r)) {
              choice = r;
              break;
            }
          }
          if (choice) break;
        }
        if (!choice) break;
        occupied.push(choice);
        placed.push({
          x: (choice.minX + choice.maxX) / 2,
          y: (choice.minY + choice.maxY) / 2,
          z: 0,
        });
      }
      if (placed.length === count) return placed;
    }
  return null;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Full triangle projections, generated normal/tree supports, and planned adhesion strokes. */
export async function buildPurgeFootprints(
  widgets,
  clearance,
  lineWidth,
  adhesionLayers,
  api,
  progress = () => {},
) {
  const { polygons, polygon } = api;
  let triangles = 0,
    points = 0,
    segments = 0;
  const chunks = [];
  let batch = [];
  const flush = () => {
    if (batch.length)
      chunks.push(...polygons.union(batch, 0, true, { wasm: true }));
    batch = [];
  };
  const add = (p) => {
    batch.push(p);
    if (batch.length >= 512) flush();
  };
  function copy(poly, pos, depth = 0) {
    if (depth > 64 || !poly.points?.length)
      throw new Error("Invalid generated support footprint.");
    const p = polygon();
    for (const v of poly.points) {
      if (++points > 2000000)
        throw new Error(
          "Support footprint complexity limit reached. Simplify supports or split the plate.",
        );
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y))
        throw new Error("Invalid support footprint coordinates.");
      p.add(v.x + pos.x, v.y + pos.y, 0);
    }
    if (poly.inner?.length)
      p.inner = poly.inner.map((hole) => copy(hole, pos, depth + 1));
    return p;
  }
  for (let w = 0; w < widgets.length; w++) {
    progress((w / Math.max(1, widgets.length)) * 0.75, "purge footprints");
    const widget = widgets[w],
      pos = widget.track.pos;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y))
      throw new Error("Invalid model position for purge placement.");
    const v = widget.getGeoVertices({ unroll: true, translate: true });
    if (!v.length || v.length % 9)
      throw new Error("Invalid model triangles for purge placement.");
    for (let i = 0; i < v.length; i += 9) {
      if (++triangles > 2000000)
        throw new Error(
          "Purge footprint projection supports up to two million triangles. Split the plate.",
        );
      if (!Array.from(v.subarray(i, i + 9)).every(Number.isFinite))
        throw new Error("Invalid model coordinates for purge placement.");
      const cross =
        (v[i + 3] - v[i]) * (v[i + 7] - v[i + 1]) -
        (v[i + 4] - v[i + 1]) * (v[i + 6] - v[i]);
      if (Math.abs(cross) > 1e-10)
        add(
          polygon()
            .add(v[i] + pos.x, v[i + 1] + pos.y, 0)
            .add(v[i + 3] + pos.x, v[i + 4] + pos.y, 0)
            .add(v[i + 6] + pos.x, v[i + 7] + pos.y, 0)
            .setClockwise(),
        );
      if (i % 9216 === 0) await pause();
    }
    for (let i = 0; i < widget.slices.length; i++) {
      for (const support of widget.slices[i].supports || [])
        add(copy(support, pos));
      if (i % 32 === 0) await pause();
    }
    flush();
    await pause();
  }
  async function combine(items) {
    while (items.length > 64) {
      const merged = [];
      for (let i = 0; i < items.length; i += 64) {
        merged.push(
          ...polygons.union(items.slice(i, i + 64), 0, true, { wasm: true }),
        );
        await pause();
      }
      // Disconnected components may not reduce. One bounded native union can
      // finish that case without an endless chunk-reduction loop.
      if (merged.length >= items.length)
        return polygons.union(merged, 0, true, { wasm: true });
      items = merged;
    }
    return polygons.union(items, 0, true, { wasm: true });
  }
  progress(0.8, "purge footprints");
  const projected = await combine(chunks);
  if (widgets.length && !projected.length)
    throw new Error("Models have no printable purge-placement footprint.");
  const padded = projected.length
    ? polygons.offset(projected, clearance, {
        minArea: 0,
        clean: false,
        z: 0,
        wasm: true,
      })
    : [];
  chunks.length = 0;
  // Rafts and skirts can bridge gaps or fill holes. Reserve the actual emitted
  // strokes too, rather than assuming an offset model projection describes them.
  let previous;
  for (const layer of adhesionLayers || [])
    for (const out of layer) {
      const p = out.point;
      if (!p) continue;
      if (previous && out.emit > 0) {
        if (++segments > 250000)
          throw new Error(
            "Adhesion footprint limit reached. Reduce raft/skirt complexity.",
          );
        const dx = p.x - previous.x,
          dy = p.y - previous.y,
          length = Math.hypot(dx, dy),
          r = lineWidth / 2 + 2;
        if (![p.x, p.y, previous.x, previous.y].every(Number.isFinite))
          throw new Error("Invalid adhesion path coordinates.");
        if (length > 1e-8) {
          const ux = (dx / length) * r,
            uy = (dy / length) * r,
            a = { x: previous.x - ux, y: previous.y - uy },
            b = { x: p.x + ux, y: p.y + uy };
          add(
            polygon()
              .add(a.x - uy, a.y + ux, 0)
              .add(b.x - uy, b.y + ux, 0)
              .add(b.x + uy, b.y - ux, 0)
              .add(a.x + uy, a.y - ux, 0)
              .setClockwise(),
          );
        }
        if (segments % 512 === 0) await pause();
      }
      previous = p;
    }
  flush();
  // Keep already planned adhesion separate from the uniform model clearance.
  const outlines = await combine([...padded, ...chunks.slice()]);
  progress(1, "purge footprints");
  return outlines;
}
