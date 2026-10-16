import * as THREE from "three";
import type { Model, Vec3 } from "../types";
import { boundsOf, matrixOf } from "./geometry";
import { newId } from "./id";

export function assemblyParts(models: Model[], model: Model): Model[] {
  return model.assemblyId
    ? models.filter(
        (m) => m.plate === model.plate && m.assemblyId === model.assemblyId,
      )
    : [model];
}
export function partsBounds(parts: Model[]): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (const part of parts) bounds.union(boundsOf(part));
  return bounds;
}
/** Bake the relative transforms into each part, retaining a common editable pivot. */
export function updateAssembly(
  models: Model[],
  id: string,
  patch: Partial<Model>,
  whole: boolean,
  ground: boolean,
): Model[] {
  const selected = models.find((m) => m.id === id);
  if (!selected) return models;
  const transform = patch.position || patch.rotation || patch.scale;
  const parts =
    whole && (transform || patch.plate !== undefined)
      ? assemblyParts(models, selected)
      : [selected];
  const ids = new Set(parts.map((m) => m.id));
  const next = { ...selected, ...patch };
  const inverseOld = matrixOf(selected).invert();
  const replacements = new Map<string, Model>();
  for (const part of parts) {
    if (part.id === id) replacements.set(id, next);
    else if (!transform)
      replacements.set(part.id, { ...part, plate: next.plate });
    else {
      const local = inverseOld.clone().multiply(matrixOf(part));
      const positions = part.positions.slice(),
        point = new THREE.Vector3();
      for (let i = 0; i < positions.length; i += 3)
        point.fromArray(positions, i).applyMatrix4(local).toArray(positions, i);
      const paintTriangles = part.paintTriangles?.slice();
      if (paintTriangles)
        for (let i = 0; i < paintTriangles.length; i += 3)
          point
            .fromArray(paintTriangles, i)
            .applyMatrix4(local)
            .toArray(paintTriangles, i);
      replacements.set(part.id, {
        ...part,
        positions,
        paintTriangles,
        position: [...next.position],
        rotation: [...next.rotation],
        scale: [...next.scale],
      });
    }
  }
  if (ground) {
    // Ground the entire assembly even when this was a non-transform command.
    const grounding = whole
      ? assemblyParts(models, selected).map((m) => replacements.get(m.id) ?? m)
      : [...replacements.values()];
    const z = partsBounds(grounding).min.z;
    for (const part of grounding) {
      ids.add(part.id);
      replacements.set(part.id, {
        ...part,
        position: [part.position[0], part.position[1], part.position[2] - z],
      });
    }
  }
  return models.map((m) => (ids.has(m.id) ? replacements.get(m.id)! : m));
}
export function assembleModels(models: Model[], name = "Assembly"): Model[] {
  if (!models.length) return [];
  const assemblyId = newId(),
    bounds = partsBounds(models),
    center = bounds.getCenter(new THREE.Vector3());
  const offset = new THREE.Vector3(center.x, center.y, bounds.min.z);
  return models.map((m) => {
    const positions = m.positions.slice(),
      matrix = matrixOf(m),
      point = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 3)
      point
        .fromArray(positions, i)
        .applyMatrix4(matrix)
        .sub(offset)
        .toArray(positions, i);
    const paintTriangles = m.paintTriangles?.slice();
    if (paintTriangles)
      for (let i = 0; i < paintTriangles.length; i += 3)
        point
          .fromArray(paintTriangles, i)
          .applyMatrix4(matrix)
          .sub(offset)
          .toArray(paintTriangles, i);
    return {
      ...m,
      name: m.name || name,
      assemblyId,
      positions,
      paintTriangles,
      position: offset.toArray() as Vec3,
      rotation: [0, 0, 0] as Vec3,
      scale: [1, 1, 1] as Vec3,
    };
  });
}
export function duplicateAssembly(
  models: Model[],
  selected: Model,
  whole = true,
): Model[] {
  const parts = whole ? assemblyParts(models, selected) : [selected];
  const width = partsBounds(parts).getSize(new THREE.Vector3()).x;
  const assemblyId = parts.length > 1 ? newId() : undefined;
  return parts.map((m) => ({
    ...m,
    id: newId(),
    assemblyId,
    name: `${m.name} copy`,
    position: [m.position[0] + width + 8, m.position[1], m.position[2]] as Vec3,
  }));
}
