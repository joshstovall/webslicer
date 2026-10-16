// Stratum's bed-aware purge block placement. Coordinates are centered on the bed.
// This module is independent of Kiri geometry classes so its packing can be tested directly.
const EPS = 1e-7;
const overlapsX = (a, b) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS;
const transpose = (r) => ({
  minX: r.minY,
  maxX: r.maxY,
  minY: r.minX,
  maxY: r.maxX,
});

export function placePurgeBlocks({
  width,
  depth,
  size,
  count,
  obstacles,
  lineWidth,
}) {
  if (!count || !size) return [];
  if (
    ![width, depth, size, lineWidth].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > 63
  )
    throw new Error("Invalid purge tower dimensions.");
  // The perimeter centerline has a half-line-width footprint. Reserve another
  // 0.5 mm on each side so adjacent blocks and the bed edge have clearance.
  const span = size + lineWidth + 1;
  const limits = {
    minX: -width / 2 + 1,
    maxX: width / 2 - 1,
    minY: -depth / 2 + 1,
    maxY: depth / 2 - 1,
  };
  if (
    obstacles.some(
      (r) => ![r.minX, r.maxX, r.minY, r.maxY].every(Number.isFinite),
    )
  )
    throw new Error("Invalid geometry bounds while placing the purge tower.");
  for (const swap of [false, true])
    for (const reverse of [false, true]) {
      const bed = swap ? transpose(limits) : limits;
      const occupied = obstacles.map((r) => (swap ? transpose(r) : { ...r }));
      const placed = [];
      for (let block = 0; block < count; block++) {
        const xs = [
          ...new Set([
            bed.minX,
            bed.maxX - span,
            ...occupied.flatMap((r) => [r.maxX, r.minX - span]),
          ]),
        ]
          .filter((x) => x >= bed.minX - EPS && x + span <= bed.maxX + EPS)
          .sort((a, b) => (reverse ? b - a : a - b));
        let choice;
        for (const x of xs) {
          const column = { minX: x, maxX: x + span };
          const intervals = occupied
            .filter((r) => overlapsX(column, r))
            .sort((a, b) => a.minY - b.minY);
          let y = bed.minY;
          for (const interval of intervals) {
            if (interval.maxY <= y + EPS) continue;
            if (interval.minY >= y + span - EPS) break;
            y = Math.max(y, interval.maxY);
          }
          if (y + span <= bed.maxY + EPS) {
            choice = { ...column, minY: y, maxY: y + span };
            break;
          }
        }
        if (!choice) break;
        occupied.push(choice);
        const rect = swap ? transpose(choice) : choice;
        placed.push({
          x: (rect.minX + rect.maxX) / 2,
          y: (rect.minY + rect.maxY) / 2,
          z: 0,
        });
      }
      if (placed.length === count) return placed;
    }
  throw new Error(
    `No room for ${count} purge ${count === 1 ? "block" : "blocks"} (${size.toFixed(1)} mm each) with model, support and adhesion clearance. Rearrange the plate or move models to another plate.`,
  );
}

/** Use sliced supports as well as full-height model bounds, before path planning. */
export function planKiriPurgeBlocks(widgets, settings, count) {
  const { device, process } = settings;
  if (!process.outputPurgeTower || count < 1 || device.bedBelt) return null;
  const lineWidth = process.sliceLineWidth || device.extruders[0].extNozzle;
  const adhesion = Math.max(
    process.firstLayerBrim
      ? process.firstLayerBrim + (process.firstLayerBrimGap || 0)
      : 0,
    process.outputBrimCount
      ? (process.outputBrimOffset || 0) +
          process.outputBrimCount * lineWidth +
          2
      : 0,
    process.outputRaft
      ? Math.max(process.outputBrimOffset || 4, 4) + lineWidth * 4
      : 0,
  );
  const clearance = adhesion + lineWidth / 2 + 2;
  const unique = new Map();
  for (const r of device.stratumBedExclusions || []) {
    const rect = {
      minX: r.minX - 2,
      minY: r.minY - 2,
      maxX: r.maxX + 2,
      maxY: r.maxY + 2,
    };
    unique.set(JSON.stringify(rect), rect);
  }
  for (const widget of widgets) {
    const pos = widget.track.pos;
    const b = widget.bounds;
    const rect = { minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y };
    for (const slice of widget.slices) {
      // Tree/normal supports can extend outside the source mesh's projection.
      for (const polygon of slice.supports || []) {
        const s = polygon.bounds;
        rect.minX = Math.min(rect.minX, s.minx);
        rect.maxX = Math.max(rect.maxX, s.maxx);
        rect.minY = Math.min(rect.minY, s.miny);
        rect.maxY = Math.max(rect.maxY, s.maxy);
      }
    }
    rect.minX += pos.x - clearance;
    rect.maxX += pos.x + clearance;
    rect.minY += pos.y - clearance;
    rect.maxY += pos.y + clearance;
    unique.set(JSON.stringify(rect), rect);
  }
  const tools = [...new Set(widgets.map((w) => w.anno.extruder ?? 0))];
  if (
    widgets.some((w) => w.slices.some((s) => s.supports?.length)) &&
    !tools.includes(process.sliceSupportNozzle)
  )
    tools.push(process.sliceSupportNozzle);
  let size = Math.sqrt(process.outputPurgeTower);
  if (process.stratumPurgeVolume > 0) {
    const volume = Math.max(
      ...tools.flatMap((from) =>
        tools
          .filter((to) => to !== from)
          .map(
            (to) =>
              process.stratumPurgeVolumes?.[`${from}:${to}`] ??
              process.stratumPurgeVolume,
          ),
      ),
    );
    let height = process.firstSliceHeight || process.sliceHeight;
    for (const widget of widgets)
      for (const slice of widget.slices)
        if (slice.height > 0) height = Math.min(height, slice.height);
    const flow = Math.min(
      ...tools.map((tool) => process.stratumFilamentFlows?.[tool] ?? 1),
    );
    const nozzle = Math.max(
      ...tools.map((tool) => device.extruders[tool].extNozzle),
    );
    if (!(height > 0 && flow > 0 && Number.isFinite(volume)))
      throw new Error("Invalid purge capacity settings.");
    // Pinned Kiri export uses pi * lineWidth * layerHeight / 4 as the
    // extrusion cross-section. Dense tower tracks are nozzle-width apart.
    // Four nozzle widths allow for clipped diagonal rows at the boundary.
    // A separate G-code audit checks actual delivered volume before export.
    size =
      Math.sqrt(
        (volume * nozzle) / (((Math.PI * lineWidth * height) / 4) * flow),
      ) +
      4 * nozzle;
  }
  return {
    size,
    positions: placePurgeBlocks({
      width: device.bedWidth,
      depth: device.bedDepth,
      size,
      count,
      lineWidth,
      obstacles: [...unique.values()],
    }),
  };
}
