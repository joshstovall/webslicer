import { Box3, Triangle, Vector3 } from "three";
import type { SupportPaint } from "../types";

interface Patch {
  points: Vector3[];
  normal: Vector3;
  box: Box3;
  state: number;
  order: number;
}
interface Node {
  box: Box3;
  patches?: Patch[];
  left?: Node;
  right?: Node;
}
const TOLERANCE = 0.0003;
function tree(patches: Patch[]): Node {
  const box = new Box3();
  for (const p of patches) box.union(p.box);
  if (patches.length <= 12) return { box, patches };
  const size = box.getSize(new Vector3());
  const axis =
    size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  patches.sort(
    (a, b) =>
      a.box.min[axis] + a.box.max[axis] - b.box.min[axis] - b.box.max[axis],
  );
  const middle = Math.floor(patches.length / 2);
  return {
    box,
    left: tree(patches.slice(0, middle)),
    right: tree(patches.slice(middle)),
  };
}
function query(node: Node, box: Box3, out: Patch[]) {
  if (!node.box.intersectsBox(box)) return;
  if (node.patches)
    for (const p of node.patches) {
      if (p.box.intersectsBox(box)) out.push(p);
    }
  else {
    query(node.left!, box, out);
    query(node.right!, box, out);
  }
}
/** Partition a convex polygon with one edge plane; vertices stay on the target surface. */
function split(points: Vector3[], origin: Vector3, inward: Vector3) {
  const inside: Vector3[] = [],
    outside: Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = a.clone().sub(origin).dot(inward),
      db = b.clone().sub(origin).dot(inward);
    (da >= 0 ? inside : outside).push(a);
    if (da >= 0 !== db >= 0) {
      const p = a.clone().lerp(b, da / (da - db));
      inside.push(p);
      outside.push(p);
    }
  }
  return { inside, outside };
}

/** Build once per visibility group in the geometry worker, then reuse for each edited part.
 * Only coplanar, equally oriented original surface patches can transfer. New cut caps
 * stay automatic, removed surfaces disappear, and new material tessellations retain paint.
 */
export function supportPaintProjector(paints: SupportPaint[]) {
  const patches: Patch[] = [];
  const triangle = new Triangle();
  for (const paint of paints)
    for (let i = 0; i < paint.states.length; i++) {
      if (!paint.states[i]) continue;
      const points = [0, 3, 6].map((offset) =>
        new Vector3().fromArray(paint.positions, i * 9 + offset),
      );
      triangle.set(points[0], points[1], points[2]);
      if (triangle.getArea() < 1e-12) continue;
      patches.push({
        points,
        normal: triangle.getNormal(new Vector3()),
        box: new Box3().setFromPoints(points),
        state: paint.states[i],
        order: patches.length,
      });
    }
  const root = patches.length ? tree(patches) : undefined;
  return (positions: Float32Array): SupportPaint | undefined => {
    if (!root) return undefined;
    const output: number[] = [],
      states: number[] = [];
    let painted = false;
    for (let i = 0; i < positions.length; i += 9) {
      const points = [0, 3, 6].map((offset) =>
        new Vector3().fromArray(positions, i + offset),
      );
      const normal = triangle
        .set(points[0], points[1], points[2])
        .getNormal(new Vector3());
      const candidates: Patch[] = [];
      query(
        root,
        new Box3().setFromPoints(points).expandByScalar(TOLERANCE),
        candidates,
      );
      let pieces = [{ points, state: 0 }];
      for (const patch of candidates.sort((a, b) => a.order - b.order)) {
        if (
          normal.dot(patch.normal) < 0.999999 ||
          patch.points.some(
            (p) => Math.abs(p.clone().sub(points[0]).dot(normal)) > TOLERANCE,
          )
        )
          continue;
        const next: typeof pieces = [];
        for (const piece of pieces) {
          let remainder = piece.points;
          for (let edge = 0; edge < 3 && remainder.length >= 3; edge++) {
            const a = patch.points[edge],
              b = patch.points[(edge + 1) % 3];
            const inward = new Vector3().crossVectors(normal, b.clone().sub(a));
            const cut = split(remainder, a, inward);
            if (cut.outside.length >= 3)
              next.push({ points: cut.outside, state: piece.state });
            remainder = cut.inside;
          }
          if (remainder.length >= 3)
            next.push({ points: remainder, state: patch.state });
        }
        pieces = next;
        if (pieces.length > 2_000_000)
          throw new Error(
            "Support-paint transfer exceeds the surface detail limit.",
          );
      }
      for (const piece of pieces)
        for (let j = 1; j < piece.points.length - 1; j++) {
          const [a, b, c] = [
            piece.points[0],
            piece.points[j],
            piece.points[j + 1],
          ];
          if (triangle.set(a, b, c).getArea() < 1e-12) continue;
          if (states.length >= 2_000_000)
            throw new Error(
              "Support-paint transfer exceeds two million triangles. Use a lower-detail model.",
            );
          output.push(...a.toArray(), ...b.toArray(), ...c.toArray());
          states.push(piece.state);
          painted ||= piece.state !== 0;
        }
    }
    return painted
      ? { positions: new Float32Array(output), states: new Uint8Array(states) }
      : undefined;
  };
}
