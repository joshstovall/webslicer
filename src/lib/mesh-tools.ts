import * as THREE from "three";
import type { Model, Vec3 } from "../types";
import {
  createModel,
  geometryOf,
  transformedGeometry,
  groundModel,
} from "./geometry";
const epsilon = 1e-5;
const key = (v: THREE.Vector3) =>
  `${Math.round(v.x * 10000)},${Math.round(v.y * 10000)},${Math.round(v.z * 10000)}`;
function worldModel(
  source: Model,
  name: string,
  positions: number[],
  ground = false,
) {
  const g = geometryOf(new Float32Array(positions));
  g.computeBoundingBox();
  const b = g.boundingBox!,
    center = b.getCenter(new THREE.Vector3()),
    z = b.min.z;
  const m = createModel(name, g, source.plate);
  m.color = source.color;
  m.tool = source.tool;
  m.position = [center.x, center.y, ground ? 0 : z];
  return m;
}
export function cutModel(
  model: Model,
  height: number,
  keep: string,
  groundUpper = true,
): Model[] {
  const g = transformedGeometry(model),
    a = g.getAttribute("position");
  g.computeBoundingBox();
  if (
    height <= g.boundingBox!.min.z + epsilon ||
    height >= g.boundingBox!.max.z - epsilon
  ) {
    g.dispose();
    throw new Error("The cut height must pass through the model.");
  }
  const lower: number[] = [],
    upper: number[] = [],
    edges: [THREE.Vector3, THREE.Vector3][] = [];
  function clip(poly: THREE.Vector3[], below: boolean) {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i],
        q = poly[(i + 1) % poly.length],
        inside = below ? p.z <= height : p.z >= height,
        next = below ? q.z <= height : q.z >= height;
      if (inside) out.push(p);
      if (inside !== next)
        out.push(p.clone().lerp(q, (height - p.z) / (q.z - p.z)));
    }
    return out;
  }
  function push(poly: THREE.Vector3[], out: number[]) {
    for (let j = 1; j < poly.length - 1; j++)
      out.push(
        ...poly[0].toArray(),
        ...poly[j].toArray(),
        ...poly[j + 1].toArray(),
      );
  }
  for (let i = 0; i < a.count; i += 3) {
    const poly = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromBufferAttribute(a, i + j),
    );
    push(clip(poly, true), lower);
    push(clip(poly, false), upper);
    const hits: THREE.Vector3[] = [];
    for (let j = 0; j < 3; j++) {
      const p = poly[j],
        q = poly[(j + 1) % 3];
      if (Math.abs(p.z - height) < epsilon) hits.push(p.clone());
      if ((p.z < height && q.z > height) || (p.z > height && q.z < height))
        hits.push(p.clone().lerp(q, (height - p.z) / (q.z - p.z)));
    }
    const unique = [...new Map(hits.map((p) => [key(p), p])).values()];
    if (unique.length === 2 && unique[0].distanceTo(unique[1]) > epsilon)
      edges.push([unique[0], unique[1]]);
  }
  g.dispose();
  const edgeKeys = new Set<string>();
  for (let i = edges.length - 1; i >= 0; i--) {
    const k = edges[i].map(key).sort().join("|");
    if (edgeKeys.has(k)) edges.splice(i, 1);
    else edgeKeys.add(k);
  }
  const adjacent = new Map<string, number[]>();
  edges.forEach((edge, i) =>
    edge.forEach((p) => {
      const k = key(p);
      adjacent.set(k, [...(adjacent.get(k) || []), i]);
    }),
  );
  const used = new Set<number>(),
    loops: THREE.Vector2[][] = [];
  for (let e = 0; e < edges.length; e++) {
    if (used.has(e)) continue;
    const loop: THREE.Vector2[] = [];
    const start = edges[e][0];
    let p = start,
      index = e;
    let closed = false;
    for (let step = 0; step <= edges.length; step++) {
      used.add(index);
      loop.push(new THREE.Vector2(p.x, p.y));
      const edge = edges[index];
      p = key(edge[0]) === key(p) ? edge[1] : edge[0];
      if (key(p) === key(start)) {
        closed = true;
        break;
      }
      const next = adjacent.get(key(p))?.find((i) => !used.has(i));
      if (next === undefined) break;
      index = next;
    }
    if (!closed)
      throw new Error(
        "The cut crosses an open or non-manifold mesh. Repair the model before cutting.",
      );
    if (loop.length >= 3) loops.push(loop);
  }
  const inside = (p: THREE.Vector2, loop: THREE.Vector2[]) => {
    let c = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i],
        b = loop[j];
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        c = !c;
    }
    return c;
  };
  const sorted = loops.sort(
    (a, b) =>
      Math.abs(THREE.ShapeUtils.area(b)) - Math.abs(THREE.ShapeUtils.area(a)),
  );
  const depths = sorted.map(
    (l, i) => sorted.slice(0, i).filter((outer) => inside(l[0], outer)).length,
  );
  sorted.forEach((loop, i) => {
    if (depths[i] % 2) return;
    const holes = sorted.filter(
      (l, j) => depths[j] === depths[i] + 1 && inside(l[0], loop),
    );
    const faces = THREE.ShapeUtils.triangulateShape(loop, holes),
      vertices = loop.concat(...holes);
    for (const face of faces) {
      let [a, b, c] = face.map((k) => vertices[k]);
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0)
        [b, c] = [c, b];
      lower.push(a.x, a.y, height, b.x, b.y, height, c.x, c.y, height);
      upper.push(a.x, a.y, height, c.x, c.y, height, b.x, b.y, height);
    }
  });
  const results: Model[] = [];
  if (keep !== "upper")
    results.push(worldModel(model, `${model.name} · lower`, lower, true));
  if (keep !== "lower") {
    let top = worldModel(model, `${model.name} · upper`, upper, true);
    if (!groundUpper) top = groundModel({ ...top, rotation: [180, 0, 0] });
    results.push(top);
  }
  return results;
}
export function splitModel(model: Model): Model[] {
  const g = transformedGeometry(model),
    a = g.getAttribute("position");
  const count = a.count / 3;
  if (count > 500000) {
    g.dispose();
    throw new Error("Split is limited to 500,000 triangles on this device.");
  }
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const verts = new Map<string, number>();
  const v = new THREE.Vector3();
  for (let t = 0; t < count; t++)
    for (let j = 0; j < 3; j++) {
      v.fromBufferAttribute(a, t * 3 + j);
      const k = key(v),
        previous = verts.get(k);
      if (previous !== undefined) union(t, previous);
      else verts.set(k, t);
    }
  const parts = new Map<number, number[]>();
  for (let t = 0; t < count; t++) {
    const root = find(t),
      part = parts.get(root) || [];
    for (let j = 0; j < 3; j++) {
      v.fromBufferAttribute(a, t * 3 + j);
      part.push(...v.toArray());
    }
    parts.set(root, part);
  }
  g.dispose();
  if (parts.size > 200)
    throw new Error(
      "This mesh has more than 200 disconnected parts. Repair it before splitting.",
    );
  if (parts.size === 1) return [model];
  return [...parts.values()].map((p, i) =>
    worldModel(model, `${model.name} · part ${i + 1}`, p),
  );
}
