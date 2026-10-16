/* Stratum support-contact modifiers. MIT license; see NOTICE.md. */
import { supportPaintMasker } from "./support-paint.js";

/** Modify contact seeds before downward projection, never sever finished columns.
 * A volume selects the upper layer's new underside at that layer's sampling plane.
 * This keeps support geometry on the same fixed/adaptive/manual material grid.
 */
export async function applySupportModifiers(
  slices,
  modifiers,
  api,
  peers = [],
  clearance = 0,
  paint = [],
) {
  if (!modifiers?.length && !peers.length && !paint.length) return;
  const { polygons: poly, point, slice: sliceMesh } = api;
  const paintMasks = supportPaintMasker(paint, api);
  const prepare = (modifier) => {
    const points = [];
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < modifier.vertices.length; i += 3) {
      const p = point(
        modifier.vertices[i],
        modifier.vertices[i + 1],
        modifier.vertices[i + 2],
      );
      if (![p.x, p.y, p.z].every(Number.isFinite))
        throw new Error("Invalid support modifier coordinates.");
      points.push(p);
      min = Math.min(min, p.z);
      max = Math.max(max, p.z);
    }
    return { ...modifier, points, min, max };
  };
  const prepared = (modifiers ?? []).map(prepare);
  const neighbors = peers.map(prepare);
  const sectionAt = async (geometry, z) => {
    if (z < geometry.min || z > geometry.max) return [];
    const section = await sliceMesh(z, geometry.points, {
      strict: true,
      union: true,
      zMin: geometry.min,
      zMax: geometry.max,
    });
    if (section.groups?.some((p) => p.open))
      throw new Error(
        geometry.name + ": supports require closed cross-sections.",
      );
    return poly.nest(section.groups ?? []);
  };
  for (const layer of slices) {
    if (!layer.height) continue;
    const occluders = [];
    for (const peer of neighbors)
      occluders.push(...(await sectionAt(peer, layer.z)));
    layer.stratumSupportOccluders = poly.union(occluders, 0, true);
    layer.stratumSupportClips = poly.offset(
      layer.stratumSupportOccluders,
      clearance,
      { z: layer.z },
    );
    const contactZ = layer.up?.z;
    let shadow = layer.shadow ?? [];
    let underside;
    for (const modifier of prepared) {
      if (contactZ === undefined) continue;
      if (contactZ < modifier.min || contactZ > modifier.max) continue;
      const mask = poly.setZ(await sectionAt(modifier, contactZ), layer.z);
      if (!mask.length) continue;
      if (modifier.kind === "support-blocker") {
        const remaining = [];
        poly.subtract(shadow, mask, remaining, null, layer.z, 0, {
          wasm: false,
        });
        shadow = remaining;
      } else if (modifier.kind === "support-enforcer") {
        if (!underside) {
          underside = [];
          poly.subtract(
            layer.up.topPolys(),
            layer.topPolys(),
            underside,
            null,
            layer.z,
            0,
            { wasm: false },
          );
        }
        const contact = poly.trimTo(underside, mask, { minArea: 0 });
        shadow = poly.union([...shadow, ...contact], 0, true);
      }
    }
    // Surface paint overrides volume-selected contacts; automatic restores the volume result.
    if (paint.length && contactZ !== undefined) {
      const masks = paintMasks(layer.z, contactZ);
      if (masks.enforce.length) {
        if (!underside) {
          underside = [];
          poly.subtract(
            layer.up.topPolys(),
            layer.topPolys(),
            underside,
            null,
            layer.z,
            0,
            { wasm: false },
          );
        }
        shadow = poly.union(
          [
            ...shadow,
            ...poly.trimTo(underside, poly.union(masks.enforce, 0, true), {
              minArea: 0,
            }),
          ],
          0,
          true,
        );
      }
      if (masks.block.length) {
        const remaining = [];
        poly.subtract(
          shadow,
          poly.union(masks.block, 0, true),
          remaining,
          null,
          layer.z,
          0,
          { wasm: false },
        );
        shadow = remaining;
      }
    }
    if (layer.stratumSupportOccluders.length) {
      const remaining = [];
      poly.subtract(
        shadow,
        layer.stratumSupportOccluders,
        remaining,
        null,
        layer.z,
        0,
        { wasm: false },
      );
      shadow = remaining;
    }
    layer.shadow = shadow;
  }
}
