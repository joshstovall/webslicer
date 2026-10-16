/* Original Stratum regional surface-skin adapter. MIT; see NOTICE.md. */
import { splitRegionMove } from "./process-modifiers.js";

/** Native short-line joining must stay in the selected skin, including holes. */
export function skinMoveInside(a, b, area) {
  return (
    !area ||
    (area.length > 0 &&
      splitRegionMove(a, b, [{ polys: area, walls: 1 }]).every(
        (p) => p.walls === 1,
      ))
  );
}

/** Resolve each setting separately. A zero-count region still masks earlier
 * overrides; an unspecified setting inherits earlier volumes or the process.
 */
export function skinRegions(area, masks, key, fallback, api, z) {
  let remaining = area;
  const regions = [];
  for (const mask of [...masks].reverse()) {
    if (mask[key] === undefined) continue;
    const clipped = api.trimTo(remaining, mask.polys, { minArea: 0.00001 });
    if (clipped.length) regions.push({ area: clipped, count: mask[key] });
    remaining = api.subtract(remaining, mask.polys, [], null, z, 0.00001);
  }
  if (remaining.length) regions.push({ area: remaining, count: fallback });
  return regions;
}

/** A region is skin when material disappears within its requested number of
 * neighboring physical layers. Intersecting every intervening layer prevents
 * projection across an air gap. Modifier boundaries never become surfaces.
 */
export async function applySkinModifiers(slices, widget, process, api) {
  const { point, section, polygons } = api;
  const records = (widget.anno.stratumSkinModifiers ?? []).filter(
    (m) => m.topLayers !== undefined || m.bottomLayers !== undefined,
  );
  if (!records.length) return;
  const prepare = (m) => {
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
  };
  const sources = records.map((m) => {
    for (const key of ["topLayers", "bottomLayers"])
      if (
        m[key] !== undefined &&
        (!Number.isInteger(m[key]) || m[key] < 0 || m[key] > 30)
      )
        throw new Error("Regional skin counts must be integers from 0 to 30.");
    return prepare(m);
  });
  const peers = (widget.anno.stratumSkinPeers ?? []).map(prepare);
  const own = new Map(
    slices.filter((s) => s.height > 0).map((s) => [s.index, s]),
  );
  const first = process.firstSliceHeight || process.sliceHeight;
  const planeAt = (index) => {
    if (index < 0) return undefined;
    if (process.stratumLayerPlan) return process.stratumLayerPlan[index]?.z;
    return (
      Math.round(
        (index === 0
          ? first / 2
          : first + (index - 0.5) * process.sliceHeight) * 1000,
      ) / 1000
    );
  };
  const sectionAt = async (source, z) => {
    if (z < source.min || z > source.max) return [];
    const result = await section(z, source.points, {
      strict: true,
      union: true,
      zMin: source.min,
      zMax: source.max,
    });
    if (result.groups?.some((p) => p.open))
      throw new Error(source.name + ": skins require closed cross-sections.");
    return polygons.nest(result.groups ?? []);
  };
  const cache = new Map();
  const physical = async (index) => {
    if (cache.has(index)) return cache.get(index);
    const z = planeAt(index);
    if (z === undefined) return [];
    const areas = (own.get(index)?.tops ?? []).map((t) => t.poly.clone(true));
    for (const peer of peers) areas.push(...(await sectionAt(peer, z)));
    const union = polygons.union(areas, 0, true);
    cache.set(index, union);
    return union;
  };
  for (const slice of slices) {
    if (!(slice.height > 0) || slice.index < 0) continue;
    // Keep at most the bounded look-behind/look-ahead window in memory.
    for (const index of cache.keys())
      if (index < slice.index - 30) cache.delete(index);
    const area = slice.tops.flatMap((top) => top.fill_off ?? []);
    const masks = [];
    for (const source of sources) {
      const polys = await sectionAt(source, slice.z);
      if (polys.length)
        masks.push({
          polys,
          topLayers: source.topLayers,
          bottomLayers: source.bottomLayers,
        });
    }
    const params = slice.params ?? process;
    slice.isSolidLayer = false;
    slice.isBridgeLayer = false;
    slice.isFlatsLayer = false;
    slice.finishSolids = false;
    slice.stratumSkins = true;
    slice.solids = [];
    for (const top of slice.tops) {
      top.fill_lines = [];
      top.fill_lines_ang = undefined;
      top.solids = [];
    }
    for (const [key, direction, base] of [
      ["topLayers", 1, params.sliceTopLayers],
      ["bottomLayers", -1, params.sliceBottomLayers],
    ]) {
      const regions = skinRegions(
        area,
        masks,
        key,
        base || 0,
        polygons,
        slice.z,
      );
      const counts = new Set(regions.map((r) => r.count).filter((c) => c > 0));
      let covered = area;
      const exposed = new Map();
      for (let count = 1; count <= Math.max(0, ...counts); count++) {
        if (covered.length)
          covered = polygons.trimTo(
            covered,
            await physical(slice.index + direction * count),
            { minArea: 0.00001 },
          );
        if (counts.has(count) || count === 1)
          exposed.set(
            count,
            polygons.subtract(area, covered, [], null, slice.z, 0.00001),
          );
      }
      for (const region of regions) {
        if (!region.count) continue;
        const skins = polygons.trimTo(exposed.get(region.count), region.area, {
          minArea: 0.00001,
        });
        const surface = polygons.trimTo(exposed.get(1), region.area, {
          minArea: 0.00001,
        });
        const projected = polygons.subtract(
          skins,
          surface,
          [],
          null,
          slice.z,
          0.00001,
        );
        for (const poly of surface) poly.hintFillAngle();
        slice.solids.push(...surface, ...projected);
        if (surface.length) {
          slice.finishSolids = true;
          if (direction > 0) slice.isFlatsLayer = true;
          else slice.isBridgeLayer = true;
        }
      }
    }
    slice.solids = polygons.union(slice.solids, 0, true);
    // Removing skins does not remove independently requested full-density infill.
    if (params.sliceFillSparse > 0.995 && !widget.anno.stratumModifiers?.length)
      slice.solids = area.map((p) => p.clone(true));
  }
}
