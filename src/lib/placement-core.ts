import type {
  CrossSection,
  Manifold,
  ManifoldToplevel,
  Vec2,
} from "manifold-3d";
import type { Vec3 } from "../types";
import type { BedRectangle } from "./bed-exclusions";

export interface PlacementPart {
  id: string;
  name: string;
  plate: number;
  assemblyId?: string;
  visible: boolean;
  vertices: Float32Array;
}
export interface PlacementRequest {
  mode: "arrange" | "validate";
  parts: PlacementPart[];
  bed: Vec3;
  exclusions: BedRectangle[];
  gap: number;
  edge: number;
  rotate: boolean;
}
export interface PlacementMove {
  id: string;
  angle: number;
  translation: Vec3;
}
export interface PlacementResult {
  moves: PlacementMove[];
  errors: string[];
}
type Bounds = { min: number[]; max: number[] };
const EPS = 1e-6;
const overlaps = (a: Bounds, b: Bounds, dimensions = 2) =>
  Array.from(
    { length: dimensions },
    (_, i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]),
  ).every((v) => v > EPS);
function boundsOf(vertices: Float32Array): Bounds {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i++) {
    if (!Number.isFinite(vertices[i]))
      throw new Error("Placement requires finite model coordinates.");
    const a = i % 3;
    min[a] = Math.min(min[a], vertices[i]);
    max[a] = Math.max(max[a], vertices[i]);
  }
  return { min, max };
}

/** All native objects belong to this job and are disposed before returning. */
export function calculatePlacement(
  api: ManifoldToplevel,
  request: PlacementRequest,
  progress: (value: number, stage: string) => void = () => {},
): PlacementResult {
  const { CrossSection, Manifold, Mesh } = api;
  const live = new Set<CrossSection | Manifold>();
  const keep = <T extends CrossSection | Manifold>(value: T): T => {
    live.add(value);
    return value;
  };
  const drop = (value: CrossSection | Manifold) => {
    if (live.delete(value)) value.delete();
  };
  let checks = 0;
  const intersectionArea = (a: CrossSection, b: CrossSection) => {
    if (++checks > 1_000_000)
      throw new Error(
        "Arrangement search limit reached. Try fewer objects or place some parts manually.",
      );
    const intersection = keep(a.intersect(b));
    const area = intersection.area();
    drop(intersection);
    return area;
  };
  if (
    !Number.isFinite(request.gap) ||
    request.gap < 0 ||
    request.gap > 100 ||
    !Number.isFinite(request.edge) ||
    request.edge < 0 ||
    request.edge > 100
  )
    throw new Error(
      "Placement spacing and clearance must be between 0 and 100 mm.",
    );
  if (
    request.parts.length > 200 ||
    request.parts.reduce((n, p) => n + p.vertices.length / 9, 0) > 2_000_000
  )
    throw new Error(
      "Shape-aware placement supports up to 200 parts and two million triangles per job.",
    );
  if (
    request.bed.length !== 3 ||
    request.bed.some((v) => !Number.isFinite(v) || v <= 0)
  )
    throw new Error("Placement requires valid printer dimensions.");
  if (new Set(request.parts.map((p) => p.id)).size !== request.parts.length)
    throw new Error(
      "Models have duplicate identifiers. Reimport the affected models before arranging.",
    );
  const records = request.parts.map((part) => {
    if (!part.vertices.length || part.vertices.length % 9)
      throw new Error(`${part.name} has no valid triangles.`);
    return {
      part,
      bounds: boundsOf(part.vertices),
      solid: undefined as Manifold | null | undefined,
      shape: undefined as CrossSection | undefined,
    };
  });
  type Record = (typeof records)[number];
  const solidOf = (r: Record) => {
    if (r.solid !== undefined) return r.solid;
    try {
      const mesh = new Mesh({
        numProp: 3,
        vertProperties: r.part.vertices,
        triVerts: Uint32Array.from(
          { length: r.part.vertices.length / 3 },
          (_, i) => i,
        ),
      });
      mesh.merge();
      const solid = keep(new Manifold(mesh));
      if (solid.status() !== "NoError" || solid.isEmpty()) {
        drop(solid);
        r.solid = null;
      } else r.solid = solid;
    } catch {
      r.solid = null;
    }
    return r.solid;
  };
  const shapeOf = (r: Record) => {
    if (r.shape) return r.shape;
    const solid = solidOf(r);
    if (solid) r.shape = keep(solid.project());
    else {
      // Open meshes still have a usable projection. Each triangle contributes
      // positively, so opposite surface normals do not cancel one another.
      const chunks: CrossSection[] = [];
      let polygons: Vec2[][] = [];
      const v = r.part.vertices;
      for (let i = 0; i < v.length; i += 9) {
        const a: Vec2 = [v[i], v[i + 1]],
          b: Vec2 = [v[i + 3], v[i + 4]],
          c: Vec2 = [v[i + 6], v[i + 7]];
        const cross =
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(cross) > 1e-12)
          polygons.push(cross > 0 ? [a, b, c] : [a, c, b]);
        if (polygons.length >= 1024) {
          chunks.push(keep(new CrossSection(polygons, "Positive")));
          polygons = [];
        }
      }
      if (polygons.length)
        chunks.push(keep(new CrossSection(polygons, "Positive")));
      r.shape = keep(CrossSection.union(chunks));
      chunks.forEach(drop);
    }
    if (r.shape.isEmpty())
      throw new Error(
        `${r.part.name} has no printable XY footprint. Orient or repair it before arranging.`,
      );
    return r.shape;
  };
  const rectangle = (r: BedRectangle) =>
    keep(
      new CrossSection([
        [
          [r.minX, r.minY],
          [r.maxX, r.minY],
          [r.maxX, r.maxY],
          [r.minX, r.maxY],
        ],
      ]),
    );
  try {
    const exclusions = request.exclusions.map((r) => ({
      shape: rectangle(r),
      bounds: { min: [r.minX, r.minY], max: [r.maxX, r.maxY] },
    }));
    if (request.mode === "validate") {
      const errors: string[] = [];
      const visible = records.filter((r) => r.part.visible);
      for (let i = 0; i < visible.length; i++) {
        const a = visible[i];
        progress(
          i / Math.max(1, visible.length),
          "Checking model intersections",
        );
        for (const exclusion of exclusions) {
          const expanded = {
            min: a.bounds.min.map((v) => v - request.edge),
            max: a.bounds.max.map((v) => v + request.edge),
          };
          if (!overlaps(expanded, exclusion.bounds)) continue;
          const shape = shapeOf(a),
            padded = request.edge
              ? keep(shape.offset(request.edge, "Miter", 2))
              : shape;
          if (intersectionArea(padded, exclusion.shape) > EPS)
            errors.push(
              `${a.part.name} overlaps a reserved bed area including adhesion clearance.`,
            );
          if (padded !== shape) drop(padded);
        }
        for (let j = i + 1; j < visible.length; j++) {
          const b = visible[j];
          if (
            a.part.plate !== b.part.plate ||
            (a.part.assemblyId && a.part.assemblyId === b.part.assemblyId) ||
            !overlaps(a.bounds, b.bounds, 3)
          )
            continue;
          // Disjoint projections prove separation, including a part inside a
          // through-hole, even when one of the input surfaces is open.
          if (intersectionArea(shapeOf(a), shapeOf(b)) <= EPS) continue;
          const sa = solidOf(a),
            sb = solidOf(b);
          if (!sa || !sb) {
            errors.push(
              `Cannot verify separation of ${a.part.name} and ${b.part.name}. Repair open meshes or separate their footprints.`,
            );
            continue;
          }
          const intersection = keep(sa.intersect(sb));
          if (intersection.status() !== "NoError")
            throw new Error(
              "Solid collision checking failed. Repair the meshes and retry.",
            );
          if (intersection.volume() > 1e-6)
            errors.push(
              `${a.part.name} and ${b.part.name} overlap. Arrange them before slicing.`,
            );
          drop(intersection);
        }
      }
      return { moves: [], errors };
    }
    const groups = new Map<string, Record[]>();
    for (const r of records) {
      const key = `${r.part.plate}:${r.part.assemblyId || r.part.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const units = [...groups.values()]
      .filter((parts) => parts.some((r) => r.part.visible))
      .map((parts, i) => {
        progress(
          (i / Math.max(1, groups.size)) * 0.3,
          "Projecting model outlines",
        );
        const visible = parts.filter((r) => r.part.visible);
        const shape = keep(CrossSection.union(visible.map(shapeOf)));
        const bounds = shape.bounds();
        return {
          parts,
          shape,
          bounds,
          z: Math.min(...visible.map((r) => r.bounds.min[2])),
          area:
            (bounds.max[0] - bounds.min[0]) * (bounds.max[1] - bounds.min[1]),
        };
      })
      .sort((a, b) => b.area - a.area);
    const moves: PlacementMove[] = [];
    const plates = [...new Set(units.map((u) => u.parts[0].part.plate))];
    let done = 0;
    for (const plate of plates) {
      const plateUnits = units.filter((u) => u.parts[0].part.plate === plate);
      const pad = request.gap / 2;
      const low: Vec2 = [
        -request.bed[0] / 2 + request.edge - pad,
        -request.bed[1] / 2 + request.edge - pad,
      ];
      const high: Vec2 = [
        request.bed[0] / 2 - request.edge + pad,
        request.bed[1] / 2 - request.edge + pad,
      ];
      const obstacles = exclusions.map((e) => {
        const clearance = Math.max(request.gap, request.edge) - pad;
        const shape = clearance
          ? keep(e.shape.offset(clearance, "Miter", 2))
          : e.shape;
        return { shape, bounds: shape.bounds() };
      });
      const placed: {
        shape: CrossSection;
        bounds: ReturnType<CrossSection["bounds"]>;
        unit: (typeof units)[number];
        move: PlacementMove;
      }[] = [];
      const samples = (shape: CrossSection): Vec2[] => {
        const polygons = shape.toPolygons();
        const result: Vec2[] = [];
        for (const polygon of polygons) {
          const stride = Math.max(1, Math.ceil(polygon.length / 24));
          for (let i = 0; i < polygon.length; i += stride)
            result.push(polygon[i]);
        }
        if (result.length > 256)
          throw new Error(
            "The outline has too many separate contours for arrangement. Try fewer parts.",
          );
        return result;
      };
      for (const unit of plateUnits) {
        progress(
          0.3 + (0.65 * done++) / Math.max(1, units.length),
          "Finding space between model outlines",
        );
        const candidates: {
          shape: CrossSection;
          bounds: ReturnType<CrossSection["bounds"]>;
          angle: number;
          x: number;
          y: number;
          dx: number;
          dy: number;
          score: number[];
        }[] = [];
        const variants: (0 | 90)[] = request.rotate ? [0, 90] : [0];
        const occupied = [...obstacles, ...placed];
        for (const angle of variants) {
          const rotated = keep(unit.shape.rotate(angle));
          const shape = pad ? keep(rotated.offset(pad, "Miter", 2)) : rotated;
          const b = shape.bounds();
          const w = b.max[0] - b.min[0],
            h = b.max[1] - b.min[1];
          if (w > high[0] - low[0] + EPS || h > high[1] - low[1] + EPS)
            continue;
          const points = samples(shape),
            seen = new Set<string>();
          const add = (x: number, y: number) => {
            if (
              x < low[0] - EPS ||
              y < low[1] - EPS ||
              x + w > high[0] + EPS ||
              y + h > high[1] + EPS
            )
              return;
            const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
            if (seen.has(key)) return;
            seen.add(key);
            if (seen.size > 50000)
              throw new Error(
                "Arrangement candidate limit reached. Try fewer objects.",
              );
            const top = Math.max(y + h, ...placed.map((p) => p.bounds.max[1]));
            const right = Math.max(
              x + w,
              ...placed.map((p) => p.bounds.max[0]),
            );
            candidates.push({
              shape,
              bounds: b,
              angle,
              x,
              y,
              dx: x - b.min[0],
              dy: y - b.min[1],
              score: [top, right, y, x, angle],
            });
          };
          add(low[0], low[1]);
          add(high[0] - w, low[1]);
          add(low[0], high[1] - h);
          for (const obstacle of occupied) {
            const ob = obstacle.bounds;
            for (const x of [
              low[0],
              ob.min[0] - w,
              ob.max[0],
              ob.min[0],
              ob.max[0] - w,
            ])
              for (const y of [
                low[1],
                ob.min[1] - h,
                ob.max[1],
                ob.min[1],
                ob.max[1] - h,
              ])
                add(x, y);
            for (const p of samples(obstacle.shape))
              for (const q of points)
                add(p[0] - q[0] + b.min[0], p[1] - q[1] + b.min[1]);
          }
        }
        candidates.sort((a, b) => {
          for (let i = 0; i < a.score.length; i++) {
            const d = a.score[i] - b.score[i];
            if (Math.abs(d) > EPS) return d;
          }
          return 0;
        });
        let choice: (typeof placed)[number] | undefined;
        for (const c of candidates) {
          const bounds = {
            min: [c.x, c.y] as Vec2,
            max: [
              c.x + c.bounds.max[0] - c.bounds.min[0],
              c.y + c.bounds.max[1] - c.bounds.min[1],
            ] as Vec2,
          };
          const nearby = occupied.filter((o) => overlaps(bounds, o.bounds));
          const shape = keep(c.shape.translate([c.dx, c.dy]));
          if (nearby.some((o) => intersectionArea(shape, o.shape) > EPS)) {
            drop(shape);
            continue;
          }
          choice = {
            shape,
            bounds,
            unit,
            move: {
              id: "",
              angle: c.angle,
              translation: [c.dx, c.dy, -unit.z],
            },
          };
          break;
        }
        if (!choice)
          throw new Error(
            "Could not find an arrangement on this plate. Try rotation, less spacing, another plate or manual placement.",
          );
        placed.push(choice);
      }
      // Center the complete layout only if its exact padded outlines remain valid.
      const min = [
        Math.min(...placed.map((p) => p.bounds.min[0])),
        Math.min(...placed.map((p) => p.bounds.min[1])),
      ];
      const max = [
        Math.max(...placed.map((p) => p.bounds.max[0])),
        Math.max(...placed.map((p) => p.bounds.max[1])),
      ];
      const shift: Vec2 = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2];
      const canCenter = placed.every((p) => {
        const b = {
          min: [p.bounds.min[0] + shift[0], p.bounds.min[1] + shift[1]],
          max: [p.bounds.max[0] + shift[0], p.bounds.max[1] + shift[1]],
        };
        if (
          b.min.some((v, i) => v < low[i] - EPS) ||
          b.max.some((v, i) => v > high[i] + EPS)
        )
          return false;
        const shape = keep(p.shape.translate(shift));
        const good = !obstacles.some(
          (o) =>
            overlaps(b, o.bounds) && intersectionArea(shape, o.shape) > EPS,
        );
        drop(shape);
        return good;
      });
      for (const p of placed)
        for (const r of p.unit.parts)
          moves.push({
            ...p.move,
            id: r.part.id,
            translation: [
              p.move.translation[0] + (canCenter ? shift[0] : 0),
              p.move.translation[1] + (canCenter ? shift[1] : 0),
              p.move.translation[2],
            ],
          });
    }
    progress(1, "Arrangement ready");
    return { moves, errors: [] };
  } finally {
    for (const value of live) value.delete();
  }
}
