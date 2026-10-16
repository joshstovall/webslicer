import type { Model } from "../types";
import { assemblyParts, assembleModels, partsBounds } from "./assemblies";
import { boundsOf } from "./geometry";
import { cutModel } from "./mesh-tools";

/** Partition closed solids without moving either side of the color boundary. */
export function colorAboveHeight(
  models: Model[],
  id: string,
  height: number,
  tool: number,
  color: string,
  whole = true,
): Model[] {
  const selected = models.find((m) => m.id === id);
  if (!selected) throw new Error("Select a model to color.");
  const parts = whole ? assemblyParts(models, selected) : [selected];
  const bounds = partsBounds(parts);
  if (
    !Number.isFinite(height) ||
    height <= bounds.min.z ||
    height >= bounds.max.z
  )
    throw new Error(
      "The color boundary must pass through the selected object.",
    );
  const colored = parts.flatMap((part) => {
    const b = boundsOf(part);
    if (b.max.z <= height + 1e-5) return [part];
    if (b.min.z >= height - 1e-5)
      return [{ ...part, tool, color, faceTools: undefined }];
    if (part.faceTools)
      throw new Error(
        "Clear surface assignments before dividing this part by height.",
      );
    const [lower, upper] = cutModel(part, height, "both", true, true);
    return [lower, { ...upper, tool, color }];
  });
  const linked = assembleModels(colored).map((m) => ({
    ...m,
    assemblyId: selected.assemblyId ?? m.assemblyId,
  }));
  const ids = new Set(parts.map((m) => m.id));
  const result: Model[] = [];
  for (const m of models) {
    if (m.id === id) result.push(...linked);
    if (!ids.has(m.id)) result.push(m);
  }
  return result;
}
