/* Original Stratum support contact interfaces. MIT; see NOTICE.md. */
import { collectSupportLayers } from "./tree-supports.js";

/** Contact gaps use the engine's empty neighboring layer. Counts follow the
 * actual shared layer grid, so variable-height interfaces remain N layers. */
export async function planSupportInterfaces(
  widgets,
  process,
  api,
  device,
  progress = () => {},
) {
  const top = process.stratumSupportTopLayers || 0;
  const bottom = process.stratumSupportBottomLayers || 0;
  if ((!top && !bottom) || process.sliceSupportType === "disabled") return;
  if (device.bedBelt)
    throw new Error("Support interfaces are not available for belt printers.");
  if (![top, bottom].every((n) => Number.isInteger(n) && n >= 0 && n <= 10))
    throw new Error(
      "Support interface counts must be between 0 and 10 whole layers.",
    );
  const density = process.stratumSupportInterfaceDensity;
  if (!(density >= 0.05 && density <= 1))
    throw new Error("Invalid support interface density.");
  const layers = collectSupportLayers(widgets, process, api, device);
  const byIndex = new Map(layers.map((l) => [l.index, l]));
  const P = api.polygons;
  const intersect = (a, b, z) =>
    a.length && b.length ? P.setZ(P.trimTo(a, b, { minArea: 0 }), z) : [];
  const gap = process.sliceSupportGap ? 2 : 1;
  for (const layer of layers) layer.interfaces = [];
  let steps = 0;
  // Project only real contact footprints, never the exposed sides of a sloping
  // branch. Intersect each step with supports to stop at holes/disconnections.
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    for (const [count, direction] of [
      [top, -1],
      [bottom, 1],
    ]) {
      if (!count) continue;
      const contact = byIndex.get(layer.index - direction * gap);
      let mask = intersect(layer.supports, contact?.tops ?? [], layer.z);
      for (let k = 0; k < count && mask.length; k++) {
        const target = byIndex.get(layer.index + direction * k);
        if (!target) break;
        mask = intersect(mask, target.supports, target.z);
        target.interfaces.push(...mask.map((p) => p.clone(true)));
        if (++steps > 250000)
          throw new Error(
            "Support interface planning exceeded its complexity limit.",
          );
      }
    }
    if (layer.index % 8 === 0) {
      progress((0.5 * (index + 1)) / layers.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  const lineWidth = process.sliceLineWidth || device.extruders[0].extNozzle;
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    const dense = P.union(layer.interfaces, 0, true);
    // A shared section is assigned once even when different materials generated
    // overlapping support columns. Raft/purge planning sees these same sections.
    for (const ref of layer.refs) ref.slice.supports = [];
    const { slice, pos } = layer.refs[0];
    const shift = (polys) =>
      polys.map((p) => p.clone(true).move({ x: -pos.x, y: -pos.y, z: 0 }));
    slice.supports = shift(layer.supports);
    const localDense = shift(dense);
    for (const poly of slice.supports) {
      const interfaces = intersect([poly], localDense, slice.z);
      const body = [];
      if (interfaces.length)
        P.subtract([poly], interfaces, body, null, slice.z, 0, { wasm: false });
      else body.push(poly.clone(true));
      const groups = [
        {
          polys: body,
          density: process.sliceSupportDensity,
          angle: process.sliceSupportFill,
        },
        {
          polys: interfaces,
          density,
          angle:
            ((process.stratumSupportInterfaceAngle || 0) +
              (layer.index % 2) * 90) %
              180 || 360,
        },
      ];
      poly.fill = [];
      for (const group of groups) {
        api.fill({
          ...group,
          lineWidth,
          z: slice.z,
          isBelt: false,
          outline: true,
        });
        // Keep the original outer/inner outlines; never emit partition borders.
        for (const region of group.polys)
          poly.fill.push(...(region.fill ?? []));
      }
    }
    if (index % 8 === 0) {
      progress(0.5 + (0.5 * (index + 1)) / layers.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  progress(1);
}
