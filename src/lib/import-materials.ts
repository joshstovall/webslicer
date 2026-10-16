import type { Project } from "../types";
import type { ModelImport } from "./import-3mf";
import { defaultFilament } from "./multimaterial";
import { MATERIALS } from "./profiles";
/** Bind file-local color IDs to project slots without overwriting existing spools. */
export function bindImportedMaterials(project: Project, imported: ModelImport) {
  const filaments = [
    ...(project.filaments ?? [defaultFilament(project.settings)]),
  ];
  const mapping = imported.palette.map((material, index) => {
    const match = filaments.findIndex(
      (f) =>
        f.color.toLowerCase() === material.color.toLowerCase() &&
        (!material.material || f.material === material.material),
    );
    if (match >= 0) return match;
    if (filaments.length >= 64)
      throw new Error("This import would exceed 64 filament slots.");
    const base = defaultFilament(project.settings, index),
      preset = MATERIALS.find((m) => m.name === material.material);
    filaments.push({
      ...base,
      ...(preset
        ? {
            material: preset.name,
            nozzleTemp: preset.nozzle,
            firstNozzleTemp: preset.nozzle + 5,
            density: preset.density,
            fan: preset.fan,
            maxFlow: preset.flow,
          }
        : {}),
      name: material.name || base.name,
      color: material.color,
    });
    return filaments.length - 1;
  });
  const models = imported.models.map((m) => {
    const tool = mapping[m.tool ?? 0] ?? 0;
    return {
      ...m,
      tool,
      color: filaments[tool].color,
      faceTools: m.faceTools
        ? m.faceTools.map((t) => mapping[t] ?? 0)
        : undefined,
    };
  });
  return { models, filaments };
}
