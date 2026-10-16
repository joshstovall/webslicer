import { Box3, Quaternion, Ray, Vector3 } from "three";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Vec3 } from "../types";
export type OrientationPriority = "balanced" | "support" | "base" | "height";
export interface OrientationRequest {
  parts: { name: string; vertices: Float32Array }[];
  bed: Vec3;
  edge: number;
  angle: number;
  priority: OrientationPriority;
}
export interface OrientationCandidate {
  quaternion: [number, number, number, number];
  size: Vec3;
  translation: Vec3;
  supportVolume: number;
  overhangArea: number;
  contactArea: number;
  score: number;
  fits: boolean;
  current: boolean;
}
export interface OrientationResult {
  baseline: OrientationCandidate;
  candidates: OrientationCandidate[];
  examined: number;
  samples: number;
}
interface Face {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  normal: Vector3;
  area: number;
  center: Vector3;
}
interface Node {
  box: Box3;
  faces?: Face[];
  left?: Node;
  right?: Node;
}
function tree(faces: Face[]): Node {
  const box = new Box3();
  for (const f of faces)
    box.expandByPoint(f.a).expandByPoint(f.b).expandByPoint(f.c);
  if (faces.length <= 12) return { box, faces };
  const size = box.getSize(new Vector3());
  const axis =
    size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  faces.sort((a, b) => a.center[axis] - b.center[axis]);
  const mid = Math.floor(faces.length / 2);
  return {
    box,
    left: tree(faces.slice(0, mid)),
    right: tree(faces.slice(mid)),
  };
}
function nearest(node: Node, ray: Ray, max: number, point: Vector3): number {
  if (
    !node.box.containsPoint(ray.origin) &&
    (!ray.intersectBox(node.box, point) ||
      ray.origin.distanceToSquared(point) > max * max)
  )
    return max;
  if (node.faces) {
    for (const f of node.faces) {
      if (ray.intersectTriangle(f.a, f.b, f.c, false, point)) {
        const distance = point.distanceTo(ray.origin);
        if (distance > 1e-7) max = Math.min(max, distance);
      }
    }
    return max;
  }
  return nearest(node.right!, ray, nearest(node.left!, ray, max, point), point);
}
/** Original finite search: exact closed union/bounds, area-stratified support rays. */
export function calculateOrientation(
  api: ManifoldToplevel,
  request: OrientationRequest,
  progress: (value: number, stage: string) => void = () => {},
): OrientationResult {
  if (
    !request.parts.length ||
    request.parts.length > 200 ||
    request.parts.reduce((n, p) => n + p.vertices.length / 9, 0) > 500_000
  )
    throw new Error(
      "Orientation supports 1–200 visible parts and up to 500,000 triangles per selection.",
    );
  if (
    request.bed.length !== 3 ||
    request.bed.some((v) => !Number.isFinite(v) || v <= 0) ||
    !Number.isFinite(request.edge) ||
    request.edge < 0 ||
    request.edge > 100 ||
    !Number.isFinite(request.angle) ||
    request.angle < 15 ||
    request.angle > 85 ||
    !["balanced", "support", "base", "height"].includes(request.priority)
  )
    throw new Error("Invalid orientation settings or printer dimensions.");
  const live = new Set<Manifold>();
  const keep = (s: Manifold) => {
    live.add(s);
    return s;
  };
  try {
    progress(0.02, "Combining visible assembly surfaces");
    const solids = request.parts.map((part) => {
      if (
        !part.vertices.length ||
        part.vertices.length % 9 ||
        part.vertices.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e7)
      )
        throw new Error(`${part.name} has invalid triangle coordinates.`);
      const mesh = new api.Mesh({
        numProp: 3,
        vertProperties: part.vertices,
        triVerts: Uint32Array.from(
          { length: part.vertices.length / 3 },
          (_, i) => i,
        ),
      });
      try {
        mesh.merge();
        const solid = keep(new api.Manifold(mesh));
        if (
          solid.status() !== "NoError" ||
          solid.isEmpty() ||
          solid.volume() <= 0
        )
          throw new Error();
        return solid;
      } catch {
        throw new Error(
          `${part.name} needs a closed, consistently oriented mesh before automatic orientation.`,
        );
      }
    });
    const solid = keep(api.Manifold.union(solids));
    if (solid.status() !== "NoError" || solid.isEmpty())
      throw new Error(
        "Could not combine the selected surfaces for orientation.",
      );
    const mesh = solid.getMesh();
    if (mesh.triVerts.length / 3 > 750_000)
      throw new Error(
        "Combined geometry is too complex for orientation. Try a smaller selection.",
      );
    const faces: Face[] = [];
    const vertices: Vector3[] = [];
    const bounds = new Box3();
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
      const v = new Vector3().fromArray(mesh.vertProperties, i);
      vertices.push(v);
      bounds.expandByPoint(v);
    }
    const clusters = new Map<
      string,
      { area: number; largest: number; up: Vector3 }
    >();
    let surfaceArea = 0;
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      const [a, b, c] = [
        vertices[mesh.triVerts[i]],
        vertices[mesh.triVerts[i + 1]],
        vertices[mesh.triVerts[i + 2]],
      ];
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      const area = normal.length() / 2;
      if (area < 1e-10) continue;
      normal.normalize();
      faces.push({
        a,
        b,
        c,
        normal,
        area,
        center: a
          .clone()
          .add(b)
          .add(c)
          .multiplyScalar(1 / 3),
      });
      surfaceArea += area;
      const key = normal
        .toArray()
        .map((v) => Math.round(v * 20))
        .join(":");
      const cluster = clusters.get(key);
      if (!cluster)
        clusters.set(key, { area, largest: area, up: normal.clone().negate() });
      else {
        cluster.area += area;
        if (area > cluster.largest) {
          cluster.largest = area;
          cluster.up = normal.clone().negate();
        }
      }
    }
    if (!faces.length) throw new Error("No printable surfaces were found.");
    const directions: Vector3[] = [];
    const add = (v: Vector3) => {
      if (!directions.some((d) => d.dot(v) > 0.99999)) directions.push(v);
    };
    for (const v of [
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ])
      add(new Vector3(...v));
    for (const cluster of [...clusters.values()]
      .sort((a, b) => b.area - a.area)
      .slice(0, 32))
      add(cluster.up);
    for (let i = 0; i < 24; i++) {
      const z = 1 - (2 * (i + 0.5)) / 24,
        r = Math.sqrt(1 - z * z),
        a = i * Math.PI * (3 - Math.sqrt(5));
      add(new Vector3(r * Math.cos(a), r * Math.sin(a), z));
    }
    // Deterministic area-stratified samples avoid making tessellation density a weight.
    const count = 4096,
      samples: { point: Vector3; normal: Vector3 }[] = [];
    let faceIndex = 0,
      cumulative = faces[0].area;
    for (let i = 0; i < count; i++) {
      const target = ((i + 0.5) * surfaceArea) / count;
      while (cumulative < target && faceIndex < faces.length - 1)
        cumulative += faces[++faceIndex].area;
      const f = faces[faceIndex],
        u = Math.sqrt(((i + 1) * 0.7548776662466927) % 1),
        v = ((i + 1) * 0.5698402909980532) % 1;
      samples.push({
        point: f.a
          .clone()
          .multiplyScalar(1 - u)
          .addScaledVector(f.b, u * (1 - v))
          .addScaledVector(f.c, u * v),
        normal: f.normal,
      });
    }
    progress(0.12, "Building support-distance search");
    const root = tree([...faces]),
      zAxis = new Vector3(0, 0, 1),
      point = new Vector3(),
      ray = new Ray();
    const maxExtent = bounds.getSize(new Vector3()).length(),
      volume = solid.volume();
    const eps = Math.max(1e-5, maxExtent * 1e-7);
    const threshold = Math.sin((request.angle * Math.PI) / 180);
    const candidates: OrientationCandidate[] = [];
    for (let index = 0; index < directions.length; index++) {
      progress(
        0.15 + (0.8 * index) / directions.length,
        `Comparing printing angles ${index + 1} of ${directions.length}`,
      );
      const up = directions[index],
        q = new Quaternion().setFromUnitVectors(up, zAxis),
        rotated = new Box3();
      for (const v of vertices)
        rotated.expandByPoint(point.copy(v).applyQuaternion(q));
      let size = rotated.getSize(new Vector3());
      let fits =
        size.x <= request.bed[0] - 2 * request.edge + eps &&
        size.y <= request.bed[1] - 2 * request.edge + eps;
      if (
        !fits &&
        size.y <= request.bed[0] - 2 * request.edge + eps &&
        size.x <= request.bed[1] - 2 * request.edge + eps
      ) {
        q.premultiply(new Quaternion().setFromAxisAngle(zAxis, Math.PI / 2));
        rotated.makeEmpty();
        for (const v of vertices)
          rotated.expandByPoint(point.copy(v).applyQuaternion(q));
        size = rotated.getSize(new Vector3());
        fits = true;
      }
      fits &&= size.z <= request.bed[2] + eps;
      let contactArea = 0,
        overhangArea = 0,
        supportVolume = 0;
      for (const f of faces) {
        const down = -f.normal.dot(up);
        if (
          down > 0.99999 &&
          Math.max(f.a.dot(up), f.b.dot(up), f.c.dot(up)) - rotated.min.z <
            eps * 3
        )
          contactArea += f.area * down;
      }
      ray.direction.copy(up).negate();
      for (const s of samples) {
        const down = -s.normal.dot(up),
          height = s.point.dot(up) - rotated.min.z;
        if (down < threshold || height <= eps * 4) continue;
        ray.origin.copy(s.point).addScaledVector(up, -eps);
        const distance = nearest(root, ray, height - eps, point) + eps;
        if (distance <= eps * 4) continue;
        const area = (surfaceArea / count) * down;
        overhangArea += area;
        supportVolume += area * distance;
      }
      const baseRatio = Math.min(
        1,
        contactArea / Math.max(eps, size.x * size.y),
      );
      const support =
        supportVolume / Math.max(eps, volume) +
        (0.15 * overhangArea) / surfaceArea;
      const base = 1 - baseRatio + (contactArea < eps ? 0.5 : 0);
      const height = size.z / maxExtent;
      const weights =
        request.priority === "support"
          ? [1, 0.03, 0.01]
          : request.priority === "base"
            ? [0.25, 1, 0.05]
            : request.priority === "height"
              ? [0.3, 0.15, 1]
              : [1, 0.2, 0.1];
      candidates.push({
        quaternion: q.toArray(),
        translation: [
          -(rotated.min.x + rotated.max.x) / 2,
          -(rotated.min.y + rotated.max.y) / 2,
          -rotated.min.z,
        ],
        size: size.toArray(),
        supportVolume,
        overhangArea,
        contactArea,
        score: support * weights[0] + base * weights[1] + height * weights[2],
        fits,
        current: index === 0 && Math.abs(q.w - 1) < 1e-8,
      });
    }
    const baseline = {
      ...candidates[0],
      current: true,
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      size: bounds.getSize(new Vector3()).toArray() as Vec3,
      translation: [
        -(bounds.min.x + bounds.max.x) / 2,
        -(bounds.min.y + bounds.max.y) / 2,
        -bounds.min.z,
      ] as Vec3,
      fits:
        bounds.max.x - bounds.min.x <=
          request.bed[0] - 2 * request.edge + eps &&
        bounds.max.y - bounds.min.y <=
          request.bed[1] - 2 * request.edge + eps &&
        bounds.max.z - bounds.min.z <= request.bed[2] + eps,
    };
    const ranked = candidates
      .filter((c) => c.fits)
      .sort(
        (a, b) => a.score - b.score || Number(b.current) - Number(a.current),
      );
    if (!ranked.length)
      throw new Error(
        "No tested printing angle fits the selected bed and clearance. Change the printer, scale the model, or orient it manually.",
      );
    progress(1, "Printing angles ready");
    return {
      baseline,
      candidates: ranked.slice(0, 6),
      examined: candidates.length,
      samples: count,
    };
  } finally {
    for (const s of live) s.delete();
  }
}
