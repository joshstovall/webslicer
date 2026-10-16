// Original Stratum spatial infill adapter. Uses the existing engine's polygon
// booleans and pattern generators; never creates model shells at mask boundaries.
export function fillModifiedInfill(slice, options, masks, api) {
  const { polygons, polygon, sparse } = api;
  if (slice.xray || slice.isSolidLayer || slice.index < 0) return;
  const difference = (a, b) =>
    b.length ? polygons.subtract(a, b, [], null, slice.z, 0.00001) : a;
  for (const top of slice.tops) {
    let remaining = difference(top.fill_off ?? [], top.solids ?? []);
    const regions = [];
    for (const mask of [...masks].reverse()) {
      if (!remaining.length) break;
      const area = polygons.trimTo(remaining, mask.polys, { minArea: 0.00001 });
      if (!area.length) continue;
      regions.push({
        area,
        density: mask.infill / 100,
        type: mask.infillPattern,
      });
      remaining = difference(remaining, mask.polys);
    }
    if (remaining.length)
      regions.push({
        area: remaining,
        density: options.density,
        type: options.type,
      });
    top.fill_sparse ??= [];
    for (const region of regions) {
      if (!region.density) continue;
      if (region.density >= 0.995) {
        const lines = polygons.fillArea(
          region.area,
          options.process.sliceFillAngle + (slice.index % 2) * 90,
          options.lineWidth,
        );
        for (let i = 0; i < lines.length; i += 2)
          top.fill_sparse.push(polygon([lines[i], lines[i + 1]]).setOpen());
      } else {
        const clippedTop = {
          ...top,
          fill_off: region.area,
          solids: [],
          fill_sparse: [],
          fill_lines: [],
        };
        const clippedSlice = Object.assign(Object.create(slice), {
          tops: [clippedTop],
          down: undefined,
          isSparseFill: false,
        });
        sparse(clippedSlice, {
          ...options,
          ...region,
          cache: false,
          promises: undefined,
        });
        top.fill_sparse.push(...clippedTop.fill_sparse);
        top.fill_lines.push(...clippedTop.fill_lines);
      }
    }
    if (top.fill_sparse.length) slice.isSparseFill = true;
  }
}
