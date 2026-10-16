import { Matrix4, Vector3 } from "three";
import type { Model, ModifierMesh, Settings } from "../types";
import type { PreparedPart } from "./material-regions";
import { matrixOf } from "./geometry";

export const MODIFIER_PATTERNS = [
  "gyroid",
  "grid",
  "hex",
  "triangle",
  "linear",
  "cubic",
];
export interface WorldModifier {
  name: string;
  kind?: ModifierMesh["kind"];
  speedPercent?: number;
  flowPercent?: number;
  vertices: Float32Array;
  infill: number;
  infillPattern: string;
}
/** Validate before copying potentially large imported buffers. */
export function validateModifiers(value: unknown): ModifierMesh[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32)
    throw new Error("An object can have at most 32 modifier meshes.");
  const ids = new Set<string>();
  let coordinates = 0;
  return value.map((m) => {
    const vector = (v: unknown) =>
      Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    if (
      !m ||
      typeof m.id !== "string" ||
      !m.id ||
      ids.has(m.id) ||
      typeof m.name !== "string" ||
      typeof m.enabled !== "boolean" ||
      (m.kind !== undefined &&
        !["infill", "support-enforcer", "support-blocker", "process"].includes(
          m.kind,
        )) ||
      [m.speedPercent, m.flowPercent].some(
        (v) =>
          v !== undefined &&
          (typeof v !== "number" || !Number.isFinite(v) || v < 10 || v > 300),
      ) ||
      !vector(m.position) ||
      !vector(m.rotation) ||
      !vector(m.scale) ||
      m.scale.some((v: number) => v <= 0) ||
      !(Array.isArray(m.positions) || m.positions instanceof Float32Array) ||
      !m.positions.length ||
      m.positions.length % 9 ||
      (coordinates += m.positions.length) > 4_500_000 ||
      m.positions.some(
        (v: unknown) => typeof v !== "number" || !Number.isFinite(v),
      ) ||
      !Number.isFinite(m.infill) ||
      m.infill < 0 ||
      m.infill > 100 ||
      !MODIFIER_PATTERNS.includes(m.infillPattern)
    )
      throw new Error("Invalid modifier mesh, transform or process settings.");
    ids.add(m.id);
    const positions =
      m.positions instanceof Float32Array
        ? m.positions
        : new Float32Array(m.positions);
    if (positions.some((v: number) => !Number.isFinite(v)))
      throw new Error("Modifier coordinates exceed supported precision.");
    return {
      ...m,
      positions,
    };
  });
}

export function modifierErrors(models: Model[], settings: Settings): string[] {
  try {
    for (const model of models) validateModifiers(model.modifiers);
    if (
      settings.vase &&
      models.some((m) => m.visible && m.modifiers?.some((v) => v.enabled))
    )
      return ["Disable modifiers before using spiral vase mode."];
    if (
      settings.supports === "disabled" &&
      models.some(
        (m) =>
          m.visible &&
          m.modifiers?.some((v) => v.enabled && v.kind === "support-enforcer"),
      )
    )
      return [
        "Enable Automatic or Enforced only supports to use support enforcers.",
      ];
    return [];
  } catch (error) {
    return [(error as Error).message];
  }
}

export function worldModifiers(model: Model): WorldModifier[] {
  return (model.modifiers ?? [])
    .filter((m) => m.enabled)
    .map((m) => {
      const matrix = matrixOf(model).multiply(matrixOf(m));
      const vertices = m.positions.slice(),
        point = new Vector3();
      for (let i = 0; i < vertices.length; i += 3)
        point.fromArray(vertices, i).applyMatrix4(matrix).toArray(vertices, i);
      return {
        name: m.name,
        kind: m.kind,
        speedPercent: m.speedPercent,
        flowPercent: m.flowPercent,
        vertices,
        infill: m.infill,
        infillPattern: m.infillPattern,
      };
    });
}

/** Bake a parent-space change without losing rotations or nonuniform scales. */
export function transformModifierMeshes(
  modifiers: ModifierMesh[] | undefined,
  parent: Matrix4,
) {
  return modifiers?.map((m) => {
    const matrix = parent.clone().multiply(matrixOf(m));
    const positions = m.positions.slice(),
      point = new Vector3();
    for (let i = 0; i < positions.length; i += 3)
      point.fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i);
    return {
      ...m,
      positions,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
  });
}

/** Modifiers belong to an object (all linked material parts), never the whole plate. */
export function attachModifiers(models: Model[], parts: PreparedPart[]) {
  const groups = new Map<string, WorldModifier[]>();
  for (const model of models.filter((m) => m.visible)) {
    const group = model.assemblyId ?? model.id;
    groups.set(group, [...(groups.get(group) ?? []), ...worldModifiers(model)]);
  }
  return parts.map((part) => {
    const groupIds = new Set(
      models
        .filter((m) => part.sourceIds?.includes(m.id))
        .map((m) => m.assemblyId ?? m.id),
    );
    const modifiers = [...groupIds].flatMap((id) => groups.get(id) ?? []);
    return { ...part, modifiers: modifiers.length ? modifiers : undefined };
  });
}
