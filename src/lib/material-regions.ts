import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { SupportPaint } from "../types";

export interface MaterialPart {
  name: string;
  sourceIds?: string[];
  visible?: boolean;
  assemblyId?: string;
  tool: number;
  vertices: Float32Array;
  paintVertices?: Float32Array;
  faceTools?: Uint8Array;
  paintDepth?: number;
  supportPaint?: SupportPaint;
}
export interface PreparedPart {
  supportPaint?: SupportPaint;
  name: string;
  sourceIds?: string[];
  visible?: boolean;
  assemblyId?: string;
  tool: number;
  vertices: Float32Array;
}
function bounds(vertices: Float32Array) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i++) {
    const a = i % 3;
    min[a] = Math.min(min[a], vertices[i]);
    max[a] = Math.max(max[a], vertices[i]);
  }
  return { min, max };
}
function overlap(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) {
  return a.min.every(
    (v, i) => Math.min(a.max[i], b.max[i]) - Math.max(v, b.min[i]) > 1e-5,
  );
}
export function needsMaterialPreparation(parts: MaterialPart[]): boolean {
  const boxes = parts.map((p) => bounds(p.vertices));
  return (
    parts.some((p) => p.faceTools?.some((t) => t !== p.tool)) ||
    parts.some(
      (p, i) =>
        p.assemblyId &&
        parts.some(
          (q, j) =>
            j > i &&
            q.assemblyId === p.assemblyId &&
            overlap(boxes[i], boxes[j]),
        ),
    )
  );
}
/** Produce disjoint closed solids. Later assembly parts take precedence in overlaps. */
export function prepareMaterialRegions(
  api: ManifoldToplevel,
  parts: MaterialPart[],
  progress: (value: number) => void = () => {},
  mergeByTool = true,
  onRegion?: (part: PreparedPart, solid: Manifold) => void,
): PreparedPart[] {
  const { Manifold, Mesh } = api;
  const live = new Set<Manifold>();
  const keep = (solid: Manifold) => {
    live.add(solid);
    return solid;
  };
  const dispose = (solid: Manifold) => {
    if (live.delete(solid)) solid.delete();
  };
  function solidOf(vertices: Float32Array) {
    const triVerts = Uint32Array.from(
      { length: vertices.length / 3 },
      (_, i) => i,
    );
    const mesh = new Mesh({ numProp: 3, vertProperties: vertices, triVerts });
    mesh.merge();
    return keep(new Manifold(mesh));
  }
  function toVertices(solid: Manifold) {
    // Remove sub-micron Boolean slivers before converting double-precision
    // topology to Float32 triangle soup for the editor and slicing engine.
    const clean = keep(solid.simplify(0.0001));
    const mesh = clean.getMesh(),
      vertices = new Float32Array(mesh.triVerts.length * 3);
    mesh.triVerts.forEach((v, i) =>
      vertices.set(
        mesh.vertProperties.subarray(v * mesh.numProp, v * mesh.numProp + 3),
        i * 3,
      ),
    );
    dispose(clean);
    return vertices;
  }
  function union(solids: Manifold[]) {
    const result = keep(Manifold.union(solids));
    // Force evaluation before releasing the input handles.
    result.status();
    solids.forEach(dispose);
    return result;
  }
  function painted(part: MaterialPart): { tool: number; solid: Manifold }[] {
    let source: Manifold;
    try {
      source = solidOf(part.vertices);
    } catch {
      throw new Error(
        `${part.name}: surface colors and overlapping materials require a closed, consistently oriented mesh.`,
      );
    }
    const colors = [...new Set(part.faceTools ?? [])]
      .filter((t) => t !== part.tool)
      .sort((a, b) => a - b);
    if (!colors.length) return [{ tool: part.tool, solid: source }];
    const surface = part.paintVertices ?? part.vertices;
    const depth = part.paintDepth ?? 0.8;
    const regions: { tool: number; solid: Manifold }[] = [];
    let remaining = source;
    // Resolve the inward overlap of adjacent painted patches deterministically.
    for (const tool of colors.reverse()) {
      const batches: Manifold[] = [],
        batch: Manifold[] = [];
      for (let face = 0; face < part.faceTools!.length; face++) {
        if (part.faceTools![face] !== tool) continue;
        const i = face * 9;
        const a = Array.from(surface.subarray(i, i + 3)),
          b = Array.from(surface.subarray(i + 3, i + 6)),
          c = Array.from(surface.subarray(i + 6, i + 9));
        const ab = b.map((v, j) => v - a[j]),
          ac = c.map((v, j) => v - a[j]);
        const n = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
        const length = Math.hypot(...n);
        if (length < 1e-12) continue;
        n.forEach((v, j) => (n[j] = v / length));
        // Extend a tiny amount outside the surface, then intersect with the original solid.
        const top = [a, b, c].map((p) => p.map((v, j) => v + n[j] * 0.0001));
        const bottom = [a, b, c].map((p) => p.map((v, j) => v - n[j] * depth));
        const points = [...top, ...bottom];
        const indices = [
          0, 1, 2, 5, 4, 3, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3,
          0,
        ];
        batch.push(
          solidOf(Float32Array.from(indices.flatMap((v) => points[v]))),
        );
        if (batch.length >= 128) {
          batches.push(union(batch));
          batch.length = 0;
        }
      }
      if (batch.length) batches.push(union(batch));
      if (!batches.length) continue;
      const mask = union(batches),
        region = keep(remaining.intersect(mask));
      region.status();
      if (!region.isEmpty()) {
        const rest = keep(remaining.subtract(region));
        rest.status();
        dispose(remaining);
        remaining = rest;
        regions.push({ tool, solid: region });
      } else dispose(region);
      dispose(mask);
    }
    if (!remaining.isEmpty())
      regions.push({ tool: part.tool, solid: remaining });
    else dispose(remaining);
    return regions;
  }
  try {
    const groups = new Map<string, MaterialPart[]>();
    parts.forEach((p, i) => {
      const key =
        (p.assemblyId ?? `individual-${i}`) +
        (!mergeByTool && p.visible === false ? ":hidden" : "");
      groups.set(key, [...(groups.get(key) ?? []), p]);
    });
    const output: PreparedPart[] = [];
    let done = 0;
    for (const [key, group] of groups) {
      const boxes = group.map((p) => bounds(p.vertices));
      const overlaps = group.some((_, i) =>
        group.some((__, j) => j > i && overlap(boxes[i], boxes[j])),
      );
      if (
        !overlaps &&
        !group.some((p) => p.faceTools?.some((t) => t !== p.tool))
      ) {
        for (const source of group) {
          const { name, sourceIds, visible, assemblyId, tool, vertices } =
            source;
          const part = {
            name,
            sourceIds,
            visible,
            assemblyId,
            tool,
            vertices,
          };
          output.push(part);
          if (onRegion) onRegion(part, solidOf(vertices));
        }
        done += group.length;
        progress(done / parts.length);
        continue;
      }
      const sourceIds = group.flatMap((p) => p.sourceIds ?? []);
      const assemblyId = group[0].assemblyId ?? `paint-${key}`;
      let occupied: Manifold | undefined;
      const byTool = new Map<number, Manifold[]>();
      for (const part of [...group].reverse()) {
        const regions = painted(part);
        for (const region of regions) {
          let solid = region.solid;
          if (occupied) {
            solid = keep(solid.subtract(occupied));
            solid.status();
            dispose(region.solid);
          }
          if (solid.isEmpty()) {
            dispose(solid);
            continue;
          }
          if (overlaps) {
            const next = keep(
              occupied ? occupied.add(solid) : solid.translate([0, 0, 0]),
            );
            next.status();
            if (occupied) dispose(occupied);
            occupied = next;
          }
          if (mergeByTool)
            byTool.set(region.tool, [
              ...(byTool.get(region.tool) ?? []),
              solid,
            ]);
          else {
            const prepared = {
              name: part.name,
              sourceIds,
              visible: part.visible,
              assemblyId,
              tool: region.tool,
              vertices: toVertices(solid),
            };
            onRegion?.(prepared, solid);
            output.push(prepared);
            dispose(solid);
          }
        }
        progress(++done / parts.length);
      }
      if (occupied) dispose(occupied);
      for (const [tool, solids] of byTool) {
        const merged = union(solids);
        if (!merged.isEmpty()) {
          const prepared = {
            name: `${group[0].name} · filament ${tool + 1}`,
            sourceIds,
            assemblyId,
            tool,
            vertices: toVertices(merged),
          };
          onRegion?.(prepared, merged);
          output.push(prepared);
        }
        dispose(merged);
      }
    }
    return output;
  } finally {
    for (const solid of live) solid.delete();
  }
}
