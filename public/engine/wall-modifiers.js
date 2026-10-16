/* Original Stratum regional wall adapter. MIT; see NOTICE.md. */
import { splitRegionMove } from "./process-modifiers.js";

const same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;
const sameState = (a, b) =>
  !!a.skip === !!b.skip && (a.moved ?? 0) === (b.moved ?? 0);

/** Clip actual perimeter centerlines, never generate walls on a mask edge.
 * Retain closed loops when untouched, and join fragments across the loop seam.
 */
export function clipWallPath(poly, masks, count, baseCount, polygon) {
  const runs = [];
  let run;
  const points = poly.points;
  const pointAt = (a, b, t) => {
    const p = Object.assign(Object.create(Object.getPrototypeOf(a)), a);
    p.x = a.x + (b.x - a.x) * t;
    p.y = a.y + (b.y - a.y) * t;
    p.z = a.z + (b.z - a.z) * t;
    // Basic thin walls carry flow compensation at the segment endpoints.
    if (a.moved !== undefined || b.moved !== undefined)
      p.moved = (a.moved ?? 0) + ((b.moved ?? 0) - (a.moved ?? 0)) * t;
    p.skip = t === 0 ? a.skip : t === 1 ? b.skip : a.skip && b.skip;
    delete p.poly;
    delete p._key;
    return p;
  };
  for (let i = 0; i < points.length - (poly.open ? 1 : 0); i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    let start = 0;
    for (const part of splitRegionMove(a, b, masks)) {
      if ((part.walls ?? baseCount) === count) {
        const p = pointAt(a, b, start),
          q = pointAt(a, b, part.end);
        if (!run || !same(run.at(-1), p)) runs.push((run = [p]));
        else if (!sameState(run.at(-1), p)) run.push(p);
        if (!same(p, q) || !sameState(p, q)) run.push(q);
      } else run = undefined;
      start = part.end;
    }
  }
  if (
    !poly.open &&
    runs.length > 1 &&
    same(runs.at(-1).at(-1), runs[0][0]) &&
    sameState(runs.at(-1).at(-1), runs[0][0])
  ) {
    const tail = runs.pop();
    runs[0] = [...tail.slice(0, -1), ...runs[0]];
  }
  return runs
    .filter(
      (points) => points.length > 1 && points.some((p) => !same(p, points[0])),
    )
    .map((points) => {
      const closed = !poly.open && same(points[0], points.at(-1));
      if (closed && sameState(points[0], points.at(-1))) points.pop();
      const path = polygon(points);
      path.open = !closed;
      path.depth = poly.depth;
      path.stratumWallPath = true;
      path._epk = poly._epk;
      return path;
    });
}

export async function applyWallModifiers(
  slices,
  widget,
  process,
  lineWidth,
  api,
) {
  const { point, section, polygons, polygon, shell } = api;
  const records = widget.anno.stratumWallModifiers ?? [];
  if (!records.length) return;
  if (
    records.every((m) =>
      slices.every(
        (s) => !(s.height > 0) || m.walls === (s.params ?? process).sliceShells,
      ),
    )
  )
    return;
  const sources = records.map((m) => {
    if (!Number.isInteger(m.walls) || m.walls < 0 || m.walls > 20)
      throw new Error("Regional wall counts must be integers from 0 to 20.");
    const points = [];
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < m.vertices.length; i += 3) {
      const p = point(m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]);
      points.push(p);
      min = Math.min(min, p.z);
      max = Math.max(max, p.z);
    }
    return { ...m, points, min, max };
  });
  const flatten = (poly) => [poly, ...(poly.inner ?? []).flatMap(flatten)];
  for (const slice of slices) {
    if (!(slice.height > 0) || slice.index < 0) continue;
    const masks = [];
    for (const source of sources) {
      if (slice.z < source.min || slice.z > source.max) continue;
      const result = await section(slice.z, source.points, {
        strict: true,
        union: true,
        zMin: source.min,
        zMax: source.max,
      });
      if (result.groups?.some((p) => p.open))
        throw new Error(
          source.name + ": wall modifiers need closed cross-sections.",
        );
      const polys = polygons.nest(result.groups ?? []);
      if (polys.length) masks.push({ polys, walls: source.walls });
    }
    const params = slice.params ?? process;
    const baseCount = params.sliceShells;
    const fillOffset =
      lineWidth * (1 - Math.max(0, Math.min(0.8, params.sliceFillOverlap)));
    const difference = (a, b) =>
      b.length ? polygons.subtract(a, b, [], null, slice.z, 0.00001) : a;
    for (const top of slice.tops) {
      // Skin projections follow changes in the physical model, not changes in
      // wall thickness. Actual skins are subsequently clipped to fill_off.
      top.last = [top.poly];
      if (!masks.length || masks.every((m) => m.walls === baseCount)) continue;
      const counts = new Set([baseCount, ...masks.map((m) => m.walls)]);
      const variants = new Map();
      for (const count of counts) {
        variants.set(
          count,
          shell(
            slice.z,
            { poly: top.poly.clone(true) },
            count,
            lineWidth / 2,
            lineWidth,
            fillOffset,
            { thinType: params.sliceDetectThin, stratumWallDepth: true },
          ),
        );
      }
      const paths = [];
      for (const [count, variant] of variants)
        for (const outer of variant.shells ?? [])
          for (const path of flatten(outer))
            paths.push(...clipWallPath(path, masks, count, baseCount, polygon));
      const fill = [];
      let covered = [];
      for (const mask of [...masks].reverse()) {
        const area = polygons.trimTo(
          variants.get(mask.walls).fill_off ?? [],
          mask.polys,
          { minArea: 0.00001 },
        );
        fill.push(...difference(area, covered));
        covered = polygons.union([...covered, ...mask.polys], 0, true);
      }
      fill.push(...difference(variants.get(baseCount).fill_off ?? [], covered));
      top.fill_off = polygons.union(fill, 0, true);
      top.stratumWallRoute = top.poly;
      top.shells = paths;
    }
  }
}
