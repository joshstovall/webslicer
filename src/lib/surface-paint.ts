import { Matrix3, Triangle, Vector3 } from "three";
import type { Model, Vec3 } from "../types";
import { matrixOf } from "./geometry";
export type PaintMode = "brush" | "face" | "color";
export interface PaintStroke {
  point: Vec3;
  normal: Vec3;
  tool: number;
  radius: number;
  mode: PaintMode;
  sourceTool: number;
}
/** Paint a separate surface tessellation, preserving the watertight source mesh. */
export function paintSurface(
  model: Model,
  stroke: PaintStroke,
): Partial<Model> {
  const source = model.paintTriangles ?? model.positions;
  const colors =
    model.faceTools ?? new Uint8Array(source.length / 9).fill(model.tool ?? 0);
  const matrix = matrixOf(model),
    inverse = matrix.clone().invert();
  const hit = new Vector3(...stroke.point),
    hitNormal = new Vector3(...stroke.normal).normalize();
  const radius2 = stroke.radius ** 2;
  const positions: number[] = [],
    tools: number[] = [];
  const tri = new Triangle(),
    nearest = new Vector3(),
    normal = new Vector3();
  function emit(a: Vector3, b: Vector3, c: Vector3, tool: number) {
    if (tools.length >= 2_000_000)
      throw new Error(
        "Painting exceeds two million surface triangles. Use a larger brush or lower-detail mesh.",
      );
    for (const p of [a, b, c])
      positions.push(...p.clone().applyMatrix4(inverse).toArray());
    tools.push(tool);
  }
  function brush(
    a: Vector3,
    b: Vector3,
    c: Vector3,
    tool: number,
    depth: number,
  ) {
    tri.set(a, b, c);
    tri.closestPointToPoint(hit, nearest);
    if (nearest.distanceToSquared(hit) > radius2) {
      emit(a, b, c, tool);
      return;
    }
    if ([a, b, c].every((p) => p.distanceToSquared(hit) <= radius2)) {
      emit(a, b, c, stroke.tool);
      return;
    }
    if (
      depth >= 9 ||
      Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) <=
        stroke.radius * 0.35
    ) {
      const center = a
        .clone()
        .add(b)
        .add(c)
        .multiplyScalar(1 / 3);
      emit(
        a,
        b,
        c,
        center.distanceToSquared(hit) <= radius2 ? stroke.tool : tool,
      );
      return;
    }
    const ab = a.clone().add(b).multiplyScalar(0.5),
      bc = b.clone().add(c).multiplyScalar(0.5),
      ca = c.clone().add(a).multiplyScalar(0.5);
    brush(a, ab, ca, tool, depth + 1);
    brush(ab, b, bc, tool, depth + 1);
    brush(ca, bc, c, tool, depth + 1);
    brush(ab, bc, ca, tool, depth + 1);
  }
  for (let i = 0; i < source.length; i += 9) {
    const a = new Vector3().fromArray(source, i).applyMatrix4(matrix),
      b = new Vector3().fromArray(source, i + 3).applyMatrix4(matrix),
      c = new Vector3().fromArray(source, i + 6).applyMatrix4(matrix);
    tri.set(a, b, c).getNormal(normal);
    const old = colors[i / 9];
    if (stroke.mode === "color")
      emit(a, b, c, old === stroke.sourceTool ? stroke.tool : old);
    else if (stroke.mode === "face")
      emit(
        a,
        b,
        c,
        normal.dot(hitNormal) > 0.999 &&
          Math.abs(a.clone().sub(hit).dot(hitNormal)) < 0.01
          ? stroke.tool
          : old,
      );
    else if (normal.dot(hitNormal) > 0.1) brush(a, b, c, old, 0);
    else emit(a, b, c, old);
  }
  return {
    paintTriangles: new Float32Array(positions),
    faceTools: new Uint8Array(tools),
  };
}
export function worldNormal(local: Vec3, model: Model): Vec3 {
  return new Vector3(...local)
    .applyMatrix3(new Matrix3().getNormalMatrix(matrixOf(model)))
    .normalize()
    .toArray() as Vec3;
}
