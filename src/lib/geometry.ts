import { newId } from "./id";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { importObj } from "./import-obj";
import { bedExclusions, rectanglesOverlap } from "./bed-exclusions";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { import3mf, type ModelImport } from "./import-3mf";
import type { Model, Vec3, Printer } from "../types";
export const COLORS = ["#91ad87", "#86a5bd", "#c6a272", "#b995b2", "#d0866e"];
export function geometryOf(positions: Float32Array, normals = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (normals) g.computeVertexNormals();
  return g;
}
export function rawGeometry(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  const positions = new Float32Array(n.getAttribute("position").array);
  if (n !== g) n.dispose();
  return positions;
}
export function createModel(
  name: string,
  g: THREE.BufferGeometry,
  plate = 1,
): Model {
  const attribute = g.getAttribute("position");
  if (!attribute?.count || attribute.array.some((n) => !Number.isFinite(n))) {
    g.dispose();
    throw new Error("The model contains empty or invalid geometry.");
  }
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -b.min.z);
  const positions = rawGeometry(g);
  g.dispose();
  return {
    id: newId(),
    name,
    positions,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: COLORS[0],
    visible: true,
    plate,
  };
}
export function matrixOf(m: Model) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...m.position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(m.rotation.map((v) => (v * Math.PI) / 180) as Vec3)),
    ),
    new THREE.Vector3(...m.scale),
  );
}
export function transformedGeometry(m: Model) {
  return geometryOf(m.positions.slice(), false).applyMatrix4(matrixOf(m));
}
const boundsCache = new WeakMap<
  Model,
  { transform: string; positions: Float32Array; box: THREE.Box3 }
>();
export function boundsOf(m: Model) {
  const transform = [...m.position, ...m.rotation, ...m.scale].join(","),
    cached = boundsCache.get(m);
  if (cached?.transform === transform && cached.positions === m.positions)
    return cached.box.clone();
  const matrix = matrixOf(m),
    box = new THREE.Box3(),
    point = new THREE.Vector3();
  for (let i = 0; i < m.positions.length; i += 3) {
    point.fromArray(m.positions, i).applyMatrix4(matrix);
    box.expandByPoint(point);
  }
  boundsCache.set(m, { transform, positions: m.positions, box });
  return box.clone();
}
export function dimensions(m: Model): Vec3 {
  const v = boundsOf(m).getSize(new THREE.Vector3());
  return [v.x, v.y, v.z];
}
export function groundModel(m: Model) {
  const b = boundsOf(m);
  return {
    ...m,
    position: [m.position[0], m.position[1], m.position[2] - b.min.z] as Vec3,
  };
}
export function modelVolume(m: Model) {
  const a = m.positions;
  let volume = 0;
  for (let i = 0; i < a.length; i += 9)
    volume +=
      (a[i] * (a[i + 4] * a[i + 8] - a[i + 5] * a[i + 7]) -
        a[i + 1] * (a[i + 3] * a[i + 8] - a[i + 5] * a[i + 6]) +
        a[i + 2] * (a[i + 3] * a[i + 7] - a[i + 4] * a[i + 6])) /
      6;
  return Math.abs(volume * m.scale[0] * m.scale[1] * m.scale[2]);
}
export function validatePlate(models: Model[], p: Printer, margin = 0) {
  const errors: string[] = [];
  const excluded = bedExclusions(p);
  const active = models.filter((m) => m.visible);
  if (!active.length) errors.push("Add a visible model to the plate first.");
  const groups = new Map<string, THREE.Box3>();
  for (const m of active) {
    const key = m.assemblyId ?? m.id;
    if (!groups.has(key)) groups.set(key, new THREE.Box3());
    groups.get(key)!.union(boundsOf(m));
  }
  active.forEach((m) => {
    const b = boundsOf(m);
    if (
      excluded.some((r) =>
        rectanglesOverlap(
          { minX: b.min.x, minY: b.min.y, maxX: b.max.x, maxY: b.max.y },
          r,
          margin,
        ),
      )
    )
      errors.push(
        `${m.name} overlaps a reserved bed area. Move it away from the marked corner.`,
      );
    if (
      b.min.x < -p.bed[0] / 2 + margin - 0.01 ||
      b.max.x > p.bed[0] / 2 - margin + 0.01 ||
      b.min.y < -p.bed[1] / 2 + margin - 0.01 ||
      b.max.y > p.bed[1] / 2 - margin + 0.01 ||
      b.min.z < -0.01 ||
      b.max.z > p.bed[2] + 0.01
    )
      errors.push(
        `${m.name} exceeds the printable area${margin ? " including adhesion clearance" : ""}.`,
      );
    if (groups.get(m.assemblyId ?? m.id)!.min.z > 0.01)
      errors.push(`${m.name} is floating above the bed. Use “Drop to bed”.`);
  });
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      if (active[i].assemblyId && active[i].assemblyId === active[j].assemblyId)
        continue;
      const a = boundsOf(active[i]),
        b = boundsOf(active[j]);
      a.expandByScalar(-0.01);
      if (a.intersectsBox(b))
        errors.push(
          `${active[i].name} and ${active[j].name} overlap. Arrange them before slicing.`,
        );
    }
  return errors;
}
export function arrangeModels(models: Model[], p: Printer, gap = 8): Model[] {
  const groups = new Map<string, Model[]>();
  for (const m of models) {
    const key = `${m.plate}:${m.assemblyId ?? m.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  const units = [...groups.values()]
    .map((parts) => {
      const bounds = new THREE.Box3();
      parts.forEach((m) => bounds.union(boundsOf(m)));
      return { parts, bounds, size: bounds.getSize(new THREE.Vector3()) };
    })
    .sort((a, b) => b.size.y - a.size.y);
  let x = -p.bed[0] / 2 + gap,
    y = -p.bed[1] / 2 + gap,
    row = 0;
  const placed = new Map<string, Model>();
  const excluded = bedExclusions(p);
  for (const { parts, bounds, size } of units) {
    if (size.x > p.bed[0] - gap * 2 || size.y > p.bed[1] - gap * 2)
      throw new Error(`${parts[0].name} is too large to arrange.`);
    for (;;) {
      if (x + size.x > p.bed[0] / 2 - gap) {
        x = -p.bed[0] / 2 + gap;
        y += row + gap;
        row = 0;
      }
      const collision = excluded.find((r) =>
        rectanglesOverlap(
          { minX: x, minY: y, maxX: x + size.x, maxY: y + size.y },
          r,
          gap,
        ),
      );
      if (!collision) break;
      x = collision.maxX + gap;
      row = Math.max(row, collision.maxY - y);
    }
    if (y + size.y > p.bed[1] / 2 - gap)
      throw new Error(
        "The models do not fit on this plate. Add another plate or scale them down.",
      );
    for (const m of parts)
      placed.set(m.id, {
        ...m,
        position: [
          m.position[0] + x - bounds.min.x,
          m.position[1] + y - bounds.min.y,
          m.position[2] - bounds.min.z,
        ],
      });
    x += size.x + gap;
    row = Math.max(row, size.y);
  }
  const bounds = new THREE.Box3();
  placed.forEach((m) => bounds.union(boundsOf(m)));
  const center = bounds.getCenter(new THREE.Vector3());
  const centered = models.map((m) => {
    const n = placed.get(m.id)!;
    return {
      ...n,
      position: [
        n.position[0] - center.x,
        n.position[1] - center.y,
        n.position[2],
      ] as Vec3,
    };
  });
  // Centering a tightly packed plate can move a corner part back into an
  // exclusion. Retain its already-valid packed coordinates in that case.
  if (
    centered.some((m) => {
      const b = boundsOf(m);
      return excluded.some((r) =>
        rectanglesOverlap(
          { minX: b.min.x, minY: b.min.y, maxX: b.max.x, maxY: b.max.y },
          r,
          gap,
        ),
      );
    })
  )
    return models.map((m) => placed.get(m.id)!);
  return centered;
}

export async function importModels(
  file: File,
  plate: number,
): Promise<Model[]> {
  return (await importModelFile(file, plate)).models;
}
export async function importModelFile(
  file: File,
  plate: number,
  companions: File[] = [],
): Promise<ModelImport> {
  if (file.size > 100 * 1024 * 1024)
    throw new Error("Please use a model smaller than 100 MB.");
  const ext = file.name.split(".").pop()?.toLowerCase(),
    stem = file.name.replace(/\.[^.]+$/, "");
  if (ext === "3mf")
    return import3mf(new Uint8Array(await file.arrayBuffer()), stem, plate);
  if (ext === "stl") {
    const g = new STLLoader().parse(await file.arrayBuffer());
    if (!g.getAttribute("position")?.count)
      throw new Error("This STL has no triangles.");
    return { models: [createModel(stem, g, plate)], palette: [], warnings: [] };
  }
  if (ext !== "obj") throw new Error("Supported models are STL, OBJ, and 3MF.");
  return importObj(file, plate, companions);
}

export function exportSTL(models: Model[]): ArrayBuffer {
  const group = new THREE.Group();
  for (const m of models.filter((m) => m.visible))
    group.add(new THREE.Mesh(transformedGeometry(m)));
  const data = new STLExporter().parse(group, { binary: true });
  group.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
  return data.buffer as ArrayBuffer;
}
export function mergedVertices(models: Model[]) {
  const arrays = models
    .filter((m) => m.visible)
    .map((m) => {
      const g = transformedGeometry(m),
        a = rawGeometry(g);
      g.dispose();
      return a;
    });
  const a = new Float32Array(arrays.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of arrays) {
    a.set(b, o);
    o += b.length;
  }
  return a;
}
export function primitive(kind: string, plate: number): Model {
  let g: THREE.BufferGeometry;
  if (kind === "vase") g = vaseGeometry();
  else if (kind === "cylinder") {
    g = new THREE.CylinderGeometry(15, 15, 40, 64);
    g.rotateX(Math.PI / 2);
  } else if (kind === "sphere") g = new THREE.SphereGeometry(20, 48, 32);
  else if (kind === "torus") {
    g = new THREE.TorusGeometry(22, 6, 24, 64);
  } else g = new THREE.BoxGeometry(20, 20, 20);
  return createModel(
    (
      {
        vase: "Helix planter",
        cube: "Calibration cube",
        cylinder: "Cylinder",
        sphere: "Sphere",
        torus: "Torus",
      } as Record<string, string>
    )[kind] || kind,
    g,
    plate,
  );
}
function vaseGeometry() {
  const n = 96,
    rings = 32,
    h = 80,
    verts: number[] = [];
  const r = (t: number, a: number) =>
    24 + 4 * Math.sin(t * Math.PI) + 2.1 * Math.cos(a * 12 - t * 3.8);
  const pt = (j: number, i: number, inner = false): Vec3 => {
    const t = j / rings,
      a = (i / n) * Math.PI * 2;
    const radius = r(t, a) - (inner ? 2 : 0);
    return [
      Math.cos(a) * radius,
      Math.sin(a) * radius,
      inner ? 2 + (h - 2) * t : h * t,
    ];
  };
  const tri = (a: Vec3, b: Vec3, c: Vec3) => verts.push(...a, ...b, ...c);
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < n; i++) {
      const a = pt(j, i),
        b = pt(j, i + 1),
        c = pt(j + 1, i + 1),
        d = pt(j + 1, i);
      tri(a, b, c);
      tri(a, c, d);
      const ai = pt(j, i, true),
        bi = pt(j, i + 1, true),
        ci = pt(j + 1, i + 1, true),
        di = pt(j + 1, i, true);
      tri(ai, ci, bi);
      tri(ai, di, ci);
    }
  for (let i = 0; i < n; i++) {
    tri([0, 0, 0], pt(0, i + 1), pt(0, i));
    tri([0, 0, 2], pt(0, i, true), pt(0, i + 1, true));
    tri(pt(rings, i), pt(rings, i + 1), pt(rings, i + 1, true));
    tri(pt(rings, i), pt(rings, i + 1, true), pt(rings, i, true));
  }
  return geometryOf(new Float32Array(verts));
}
