import { newId } from "./id";
import type { ModelImport } from "./import-3mf";

export const STEP_QUALITY = {
  draft: {
    label: "Draft · 0.15 mm",
    linearDeflection: 0.15,
    angularDeflection: 0.6,
  },
  balanced: {
    label: "Balanced · 0.05 mm",
    linearDeflection: 0.05,
    angularDeflection: 0.35,
  },
  fine: {
    label: "Fine · 0.02 mm",
    linearDeflection: 0.02,
    angularDeflection: 0.2,
  },
} as const;
export type StepQuality = keyof typeof STEP_QUALITY;
export interface StepOptions {
  quality: StepQuality;
  colors: boolean;
}
export interface CadMesh {
  name?: string;
  color?: number[];
  attributes: { position: { array: number[] } };
  index: { array: number[] };
  brep_faces?: { first: number; last: number; color: number[] | null }[];
}
export interface CadResult {
  success: boolean;
  meshes?: CadMesh[];
}

export function cadColor(color: number[] | undefined | null): string {
  if (!color) return "#91ad87";
  if (
    color.length !== 3 ||
    color.some((c) => !Number.isFinite(c) || c < 0 || c > 1)
  )
    throw new Error(
      "STEP contains an invalid surface color. Try importing without CAD colors.",
    );
  return (
    "#" +
    color
      .map((c) =>
        Math.round(
          255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055),
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** OCCT has already applied each face's placement and converted units to mm. */
export function convertStep(
  result: CadResult,
  name: string,
  plate: number,
  options: StepOptions,
): ModelImport {
  if (!result.success || !result.meshes?.length)
    throw new Error(
      "No readable surfaces found in this STEP file. Export a self-contained STEP model with solid geometry.",
    );
  if (result.meshes.length > 200)
    throw new Error(
      "STEP contains more than 200 parts. Export a smaller assembly.",
    );
  let triangles = 0;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  // Validate the complete result before allocating expanded triangle buffers.
  for (const mesh of result.meshes) {
    const vertices = mesh.attributes?.position?.array,
      indices = mesh.index?.array;
    if (
      !vertices?.length ||
      vertices.length % 3 ||
      !indices?.length ||
      indices.length % 3
    )
      throw new Error("STEP produced empty or malformed mesh geometry.");
    triangles += indices.length / 3;
    if (triangles > 2_000_000)
      throw new Error(
        "STEP exceeds two million triangles. Choose Draft quality or export a smaller assembly.",
      );
    for (const index of indices) {
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index * 3 + 2 >= vertices.length
      )
        throw new Error("STEP produced an invalid triangle index.");
      for (let axis = 0; axis < 3; axis++) {
        const value = vertices[index * 3 + axis];
        if (!Number.isFinite(value) || Math.abs(value) > 1e7)
          throw new Error(
            "STEP coordinates are invalid or exceed the supported range.",
          );
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }
  const origin = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  const palette: ModelImport["palette"] = [];
  const slot = (color: string) => {
    const found = palette.findIndex((p) => p.color === color);
    if (found >= 0) return found;
    if (palette.length >= 64)
      throw new Error(
        "STEP contains more than 64 colors. Import without CAD colors or simplify the palette.",
      );
    palette.push({ name: `CAD ${color}`, color });
    return palette.length - 1;
  };
  const assemblyId = result.meshes.length > 1 ? newId() : undefined;
  const models = result.meshes.map((mesh, n) => {
    const indices = mesh.index.array,
      vertices = mesh.attributes.position.array;
    const positions = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i++)
      for (let axis = 0; axis < 3; axis++)
        positions[i * 3 + axis] =
          vertices[indices[i] * 3 + axis] - origin[axis];
    let color = options.colors ? cadColor(mesh.color) : "#91ad87";
    let tool = options.colors ? slot(color) : 0;
    let faceTools: Uint8Array | undefined;
    if (options.colors) {
      const assignments = new Uint8Array(indices.length / 3).fill(tool);
      for (const face of mesh.brep_faces ?? []) {
        if (
          !Number.isSafeInteger(face.first) ||
          !Number.isSafeInteger(face.last) ||
          face.first < 0 ||
          face.last < face.first ||
          face.last >= assignments.length
        )
          throw new Error("STEP produced an invalid face color range.");
        if (face.color)
          assignments.fill(
            slot(cadColor(face.color)),
            face.first,
            face.last + 1,
          );
      }
      // The dominant face material fills the interior, matching OBJ color import.
      const counts = new Uint32Array(palette.length);
      for (const value of assignments) counts[value]++;
      tool = counts.indexOf(Math.max(...counts));
      color = palette[tool].color;
      if (assignments.some((value) => value !== tool)) faceTools = assignments;
    }
    return {
      id: newId(),
      name:
        mesh.name?.trim().slice(0, 200) ||
        `${name}${result.meshes!.length > 1 ? ` · Part ${n + 1}` : ""}`,
      positions,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      color,
      tool,
      faceTools,
      assemblyId,
      visible: true,
      plate,
    };
  });
  // Remove unused base colors so they do not consume physical filament slots.
  const used = new Set(
    models.flatMap((m) => [m.tool, ...new Set(m.faceTools ?? [])]),
  );
  const remap = new Map<number, number>();
  const compact = palette.filter((_, i) => {
    if (!used.has(i)) return false;
    remap.set(i, remap.size);
    return true;
  });
  if (options.colors)
    for (const model of models) {
      model.tool = remap.get(model.tool)!;
      if (model.faceTools)
        model.faceTools = model.faceTools.map((t) => remap.get(t)!);
    }
  return {
    models,
    palette: compact,
    warnings: [
      "STEP surfaces were tessellated in millimeters. Nested assemblies are linked parts; CAD history and external references are not imported. Open surfaces may need repair before printing.",
    ],
  };
}
