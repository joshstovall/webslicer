import { transformModifierMeshes, validateModifiers } from "./modifiers";
import { transformSupportPaint } from "./support-paint";
import { Matrix4 } from "three";
import { matrixOf } from "./geometry";
import { newId } from "./id";
import type { Model } from "../types";
import {
  assemblyParts,
  assembleModels,
  updateAssembly,
  partsBounds,
} from "./assemblies";
import { boundsOf, createModel, geometryOf } from "./geometry";
import { colorAboveHeight } from "./height-colors";
import { cutModel, splitModel } from "./mesh-tools";
import { editMaterials } from "./prepare-materials";
import type { MaterialEdit, EditedPart } from "./edit-material-regions";

export function modelsFromMaterialEdit(
  sources: Model[],
  edited: EditedPart[],
  operation: MaterialEdit,
  colors: string[],
): Model[] {
  const groups = new Map<number, EditedPart[]>();
  for (const part of edited)
    groups.set(part.piece, [...(groups.get(part.piece) ?? []), part]);
  // A split of one physical object is a no-op, retaining editable surface paint.
  if (operation.kind === "split" && groups.size === 1) return sources;
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([index, regions]) => {
      let group: Model[] = regions.map((part) => {
        const positions = part.vertices.slice(),
          temporary = {
            ...sources[0],
            positions,
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
          },
          bounds = boundsOf(temporary);
        const suffix =
          operation.kind === "cut"
            ? index === 0
              ? "lower"
              : "upper"
            : operation.kind === "split"
              ? `part ${index + 1}`
              : "height color";
        const model = createModel(
          `${part.name} · ${suffix} · filament ${part.tool + 1}`,
          geometryOf(positions),
          sources[0].plate,
        );
        return {
          ...model,
          position: [
            (bounds.min.x + bounds.max.x) / 2,
            (bounds.min.y + bounds.max.y) / 2,
            bounds.min.z,
          ] as [number, number, number],
          tool: part.tool,
          color: colors[part.tool] ?? sources[0].color,
          visible: part.visible !== false,
          supportPaint: transformSupportPaint(
            part.supportPaint,
            new Matrix4().makeTranslation(
              -(bounds.min.x + bounds.max.x) / 2,
              -(bounds.min.y + bounds.max.y) / 2,
              -bounds.min.z,
            ),
          ),
        };
      });
      group = assembleModels(group);
      for (const visible of [true, false]) {
        const owner = group.findIndex((m) => m.visible === visible);
        if (owner < 0) continue;
        const inverse = matrixOf(group[owner]).invert();
        const modifiers = sources
          .filter((s) => s.visible === visible)
          .flatMap(
            (s) =>
              transformModifierMeshes(
                s.modifiers,
                inverse.clone().multiply(matrixOf(s)),
              ) ?? [],
          );
        if (modifiers.length)
          group[owner] = {
            ...group[owner],
            modifiers: validateModifiers(
              modifiers.map((m) => ({ ...m, id: newId() })),
            ),
          };
      }
      if (operation.kind === "height" && sources[0].assemblyId)
        group = group.map((m) => ({ ...m, assemblyId: sources[0].assemblyId }));
      if (operation.kind === "cut") {
        if (index === 1 && operation.flipUpper)
          group = updateAssembly(
            group,
            group[0].id,
            { rotation: [180, 0, 0] },
            true,
            true,
          );
        else {
          const floor = partsBounds(group).min.z;
          group = group.map((m) => ({
            ...m,
            position: [m.position[0], m.position[1], m.position[2] - floor],
          }));
        }
      }
      return group;
    });
}

export async function editModelSelection(
  models: Model[],
  id: string,
  operation: MaterialEdit,
  colors: string[],
  depth: number,
  whole: boolean,
  signal: AbortSignal,
  progress: (value: number, stage: string) => void,
): Promise<{ models: Model[]; selectedId: string; pieces: number }> {
  if (signal.aborted)
    throw new DOMException("Editing cancelled.", "AbortError");
  const selected = models.find((m) => m.id === id);
  if (!selected) throw new Error("Select a model to edit.");
  const sources = whole ? assemblyParts(models, selected) : [selected];
  let replacements: Model[];
  const simple = sources.every(
    (m) => !m.faceTools && !m.modifiers?.length && !m.supportPaint && m.visible,
  );
  if (operation.kind === "height" && simple) {
    const result = colorAboveHeight(
      models,
      id,
      operation.height,
      operation.tool,
      colors[operation.tool],
      whole,
    );
    checkSize(result);
    const oldIds = new Set(models.map((m) => m.id));
    return {
      models: result,
      selectedId: result.find((m) => !oldIds.has(m.id))?.id ?? id,
      pieces: 1,
    };
  } else if (sources.length === 1 && simple && operation.kind === "cut") {
    replacements = cutModel(
      selected,
      operation.height,
      operation.keep,
      !operation.flipUpper,
    );
  } else if (sources.length === 1 && simple && operation.kind === "split") {
    replacements = splitModel(selected);
  } else {
    const edited = await editMaterials(
      sources,
      depth,
      operation,
      signal,
      progress,
    );
    if (signal.aborted)
      throw new DOMException("Editing cancelled.", "AbortError");
    replacements = modelsFromMaterialEdit(sources, edited, operation, colors);
  }
  const ids = new Set(sources.map((m) => m.id));
  const result = models.flatMap((m) =>
    m.id === id ? replacements : ids.has(m.id) ? [] : [m],
  );
  checkSize(result);
  return {
    models: result,
    selectedId: replacements[0]?.id ?? id,
    pieces: new Set(replacements.map((m) => m.assemblyId ?? m.id)).size,
  };
}

function checkSize(models: Model[]) {
  if (models.length > 200)
    throw new Error(
      "This edit exceeds the project's limit of 200 material parts. The original models were kept.",
    );
  if (models.some((m) => m.positions.length > 18000000))
    throw new Error(
      "This edit creates too much geometry for one part. Reduce mesh or painting detail first.",
    );
}
