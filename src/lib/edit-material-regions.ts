import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { supportPaintProjector } from "./reproject-support-paint";
import {
  prepareMaterialRegions,
  type MaterialPart,
  type PreparedPart,
} from "./material-regions";

export type MaterialEdit =
  | {
      kind: "cut";
      height: number;
      keep: "both" | "lower" | "upper";
      flipUpper: boolean;
    }
  | { kind: "height"; height: number; tool: number }
  | { kind: "split" };
export interface EditedPart extends PreparedPart {
  piece: number;
}

/** Edits closed material volumes in world coordinates, without moving the result. */
export function editMaterialRegions(
  api: ManifoldToplevel,
  input: MaterialPart[],
  operation: MaterialEdit,
  progress: (value: number) => void = () => {},
): EditedPart[] {
  if (!input.length) throw new Error("Select a model to edit.");
  if (operation.kind !== "split" && !Number.isFinite(operation.height))
    throw new Error("Choose a finite height.");
  if (
    operation.kind === "height" &&
    (!Number.isInteger(operation.tool) ||
      operation.tool < 0 ||
      operation.tool > 31)
  )
    throw new Error("Choose a configured filament.");
  const live = new Set<Manifold>();
  const keep = (solid: Manifold) => {
    live.add(solid);
    return solid;
  };
  const dispose = (solid: Manifold) => {
    if (live.delete(solid)) solid.delete();
  };
  const verticesOf = (solid: Manifold) => {
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
  };
  const output: EditedPart[] = [];
  let unchangedSplit = false;
  const emit = (
    source: PreparedPart,
    solid: Manifold,
    piece: number,
    tool = source.tool,
  ) => {
    if (solid.status() !== "NoError")
      throw new Error("Unable to create a closed material region.");
    if (!solid.isEmpty()) {
      if (output.length >= 200 && !unchangedSplit)
        throw new Error(
          "This edit exceeds the project's limit of 200 material parts. The original models were kept.",
        );
      output.push({ ...source, tool, piece, vertices: verticesOf(solid) });
    }
  };
  try {
    const regions: { part: PreparedPart; solid: Manifold }[] = [];
    const parts = prepareMaterialRegions(
      api,
      input,
      (n) => progress(n * 0.65),
      false,
      (part, solid) => {
        // Keep Manifold's internal topology and precision through the edit.
        // Rebuilding its triangulated Float32 export can collapse tiny edges.
        const copy = keep(solid.translate([0, 0, 0]));
        copy.status();
        regions.push({ part, solid: copy });
      },
    );
    if (operation.kind !== "split") {
      const boxes = regions.map(({ solid }) => solid.boundingBox());
      if (
        operation.height <= Math.min(...boxes.map((b) => b.min[2])) + 1e-5 ||
        operation.height >= Math.max(...boxes.map((b) => b.max[2])) - 1e-5
      )
        throw new Error("The boundary must pass through the selected object.");
      const recolored: { part: PreparedPart; solid: Manifold }[] = [];
      for (const [i, { part, solid }] of regions.entries()) {
        const [upper, lower] = solid
          .splitByPlane([0, 0, 1], operation.height)
          .map(keep);
        if (operation.kind === "height") {
          emit(part, lower, 0);
          if (!upper.isEmpty()) recolored.push({ part, solid: upper });
        } else {
          if (operation.keep !== "upper") emit(part, lower, 0);
          if (operation.keep !== "lower") emit(part, upper, 1);
          dispose(upper);
        }
        dispose(lower);
        progress(0.65 + (0.3 * (i + 1)) / regions.length);
      }
      // Eliminate internal same-color boundaries above a height assignment.
      // Keep hidden and visible source regions distinct in the editor.
      if (operation.kind === "height")
        for (const visible of [true, false]) {
          const group = recolored.filter(
            (r) => (r.part.visible !== false) === visible,
          );
          if (group.length)
            emit(
              {
                ...group[0].part,
                name: `${input[0].name} · above ${operation.height} mm`,
              },
              keep(api.Manifold.union(group.map((r) => r.solid))),
              0,
              operation.tool,
            );
        }
    } else {
      if (parts.reduce((n, p) => n + p.vertices.length / 9, 0) > 500000)
        throw new Error(
          "Split is limited to 500,000 material triangles on this device.",
        );
      const united = keep(api.Manifold.union(regions.map((r) => r.solid)));
      const shells = united.decompose().map(keep);
      const positive = shells
        .filter((s) => s.volume() > 0)
        .sort((a, b) => a.volume() - b.volume());
      if (positive.length > 200)
        throw new Error(
          "This object has more than 200 disconnected parts. Repair it before splitting.",
        );
      const holes = new Map<Manifold, Manifold[]>();
      // Decompose separates cavity surfaces too. Reattach each negative shell
      // to its smallest enclosing positive shell before intersecting materials.
      // A solid island inside a cavity remains a separate physical object.
      for (const shell of shells.filter((s) => s.volume() < 0)) {
        const point = verticesOf(shell).subarray(0, 3);
        const owner = positive.find((s) => containsPoint(verticesOf(s), point));
        if (!owner)
          throw new Error(
            "A cavity has no enclosing solid. Repair the mesh before splitting.",
          );
        holes.set(owner, [...(holes.get(owner) ?? []), shell]);
      }
      const pieces = positive.map((s) =>
        holes.has(s) ? keep(api.Manifold.compose([s, ...holes.get(s)!])) : s,
      );
      unchangedSplit = pieces.length === 1;
      for (const [i, piece] of pieces.entries()) {
        for (const { part, solid } of regions) {
          const intersection = keep(solid.intersect(piece));
          emit(part, intersection, i);
          dispose(intersection);
        }
        progress(0.65 + (0.3 * (i + 1)) / pieces.length);
      }
    }
    if (!output.length)
      throw new Error("The edit produced no printable material.");
    for (const visible of [true, false]) {
      const project = supportPaintProjector(
        input
          .filter((p) => (p.visible !== false) === visible)
          .flatMap((p) => (p.supportPaint ? [p.supportPaint] : [])),
      );
      for (const part of output.filter(
        (p) => (p.visible !== false) === visible,
      ))
        part.supportPaint = project(part.vertices);
    }
    progress(1);
    return output;
  } finally {
    for (const solid of live) solid.delete();
  }
}

/** Signed solid-angle winding number; avoids edge/vertex parity ambiguities. */
function containsPoint(vertices: Float32Array, point: Float32Array) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 9) {
    const ax = vertices[i] - point[0],
      ay = vertices[i + 1] - point[1],
      az = vertices[i + 2] - point[2];
    const bx = vertices[i + 3] - point[0],
      by = vertices[i + 4] - point[1],
      bz = vertices[i + 5] - point[2];
    const cx = vertices[i + 6] - point[0],
      cy = vertices[i + 7] - point[1],
      cz = vertices[i + 8] - point[2];
    const a = Math.hypot(ax, ay, az),
      b = Math.hypot(bx, by, bz),
      c = Math.hypot(cx, cy, cz);
    const determinant =
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);
    const denominator =
      a * b * c +
      (ax * bx + ay * by + az * bz) * c +
      (bx * cx + by * cy + bz * cz) * a +
      (cx * ax + cy * ay + cz * az) * b;
    sum += 2 * Math.atan2(determinant, denominator);
  }
  return Math.abs(sum) > 2 * Math.PI;
}
