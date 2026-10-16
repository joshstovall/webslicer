import { manualLayerErrors } from "./layer-height";
import { nozzleProfileErrors } from "./nozzle-profiles";
import { materialCompatibility } from "./material-compatibility";
import type {
  Filament,
  Model,
  MultiMaterialSettings,
  Printer,
  Settings,
} from "../types";
import { thermalErrors } from "./thermal-limits";
import { validCoolingSettings } from "./cooling";

export const FILAMENT_COLORS = [
  "#91ad87",
  "#86a5bd",
  "#d0866e",
  "#e1bd56",
  "#b995b2",
  "#f0ede4",
  "#41464b",
  "#5ab4ad",
];
export const DEFAULT_MULTI_MATERIAL: MultiMaterialSettings = {
  purgeTower: true,
  purgeVolume: 140,
  supportTool: 0,
};
export function defaultFilament(s: Settings, index = 0): Filament {
  return {
    name: `${s.material} ${index + 1}`,
    color: FILAMENT_COLORS[index % FILAMENT_COLORS.length],
    material: s.material,
    nozzleTemp: s.nozzleTemp,
    firstNozzleTemp: s.firstNozzleTemp,
    density: s.density,
    cost: s.cost,
    flow: s.flow,
    maxFlow: s.maxFlow,
    fan: s.fan,
    fanLayer: s.fanLayer,
    fanRampLayers: s.fanRampLayers ?? 1,
    minLayerTime: s.minLayerTime,
    minPrintSpeed: s.minPrintSpeed ?? 10,
  };
}
export function purgeVolumeFor(
  multi: MultiMaterialSettings,
  from: number,
  to: number,
): number {
  return from === to
    ? 0
    : (multi.purgeVolumes?.[`${from}:${to}`] ?? multi.purgeVolume);
}
export function maximumPurgeVolume(
  multi: MultiMaterialSettings,
  tools?: number[],
): number {
  if (!tools)
    return Math.max(
      multi.purgeVolume,
      ...Object.values(multi.purgeVolumes ?? {}),
    );
  return Math.max(
    0,
    ...tools.flatMap((from) =>
      tools.map((to) => purgeVolumeFor(multi, from, to)),
    ),
  );
}
export function independentPurgeBudgets(
  multi: MultiMaterialSettings,
): MultiMaterialSettings {
  return {
    ...multi,
    flushVolume:
      multi.flushVolume === undefined ? multi.purgeVolume : multi.flushVolume,
    flushVolumes:
      multi.flushVolumes === undefined
        ? multi.flushVolume === undefined
          ? { ...multi.purgeVolumes }
          : {}
        : multi.flushVolumes,
  };
}
export function flushVolumeFor(
  multi: MultiMaterialSettings,
  from: number,
  to: number,
): number {
  if (from === to) return 0;
  const budgets = independentPurgeBudgets(multi);
  return budgets.flushVolumes?.[`${from}:${to}`] ?? budgets.flushVolume!;
}
export function validPurgeOverrides(value: unknown, minimum = 1): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, volume]) => {
    const match = key.match(/^(\d{1,2}):(\d{1,2})$/);
    return (
      !!match &&
      Number(match[1]) < 64 &&
      Number(match[2]) < 64 &&
      typeof volume === "number" &&
      Number.isFinite(volume) &&
      volume >= minimum &&
      volume <= 2000
    );
  });
}
export function validTowerPositions(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, position]) =>
      /^[1-9]\d*$/.test(key) &&
      Number.isSafeInteger(Number(key)) &&
      position &&
      typeof position === "object" &&
      !Array.isArray(position) &&
      typeof position.x === "number" &&
      Number.isFinite(position.x) &&
      typeof position.y === "number" &&
      Number.isFinite(position.y) &&
      (position.axis === "x" || position.axis === "y"),
  );
}
export function materialErrors(
  models: Model[],
  printer: Printer,
  filaments: Filament[],
  settings: Settings,
  multi: MultiMaterialSettings,
): string[] {
  const errors: string[] = [
    ...nozzleProfileErrors(printer, settings),
    ...manualLayerErrors(printer, settings),
  ];
  if (!Number.isFinite(settings.flow) || settings.flow <= 0)
    errors.push("Process flow ratio must be positive.");
  const capacity = printer.toolCount ?? 1;
  const used = new Set(models.filter((m) => m.visible).map((m) => m.tool ?? 0));
  for (const m of models)
    if (m.visible && m.faceTools)
      for (const tool of m.faceTools) used.add(tool);
  if (settings.supports !== "disabled") used.add(multi.supportTool);
  errors.push(...thermalErrors(printer, settings, filaments, used));
  for (const tool of used) {
    const f = filaments[tool];
    if (!f) continue;
    if (
      !Number.isFinite(f.flow) ||
      f.flow < 0.5 ||
      f.flow > 1.5 ||
      !Number.isFinite(f.maxFlow) ||
      f.maxFlow < 1 ||
      f.maxFlow > 100
    )
      errors.push(`Filament ${tool + 1} has invalid flow settings.`);
    const fanLayer = f.fanLayer ?? settings.fanLayer;
    if (
      !validCoolingSettings(f, settings) ||
      !Number.isFinite(f.fan) ||
      f.fan < 0 ||
      f.fan > 100 ||
      !Number.isInteger(fanLayer) ||
      fanLayer < 1 ||
      fanLayer > 20
    )
      errors.push(`Filament ${tool + 1} has invalid cooling settings.`);
  }
  if (!filaments.length || filaments.length > capacity)
    errors.push(`This printer supports ${capacity} filament slots.`);
  for (const tool of used) {
    if (
      !Number.isInteger(tool) ||
      tool < 0 ||
      tool >= filaments.length ||
      tool >= capacity
    )
      errors.push(`Filament ${tool + 1} is not configured for this printer.`);
  }
  if (used.size > 1 && settings.vase)
    errors.push("Spiral vase mode requires a single filament.");
  if (
    used.size > 1 &&
    printer.multiMaterialMode === "shared-nozzle" &&
    !multi.purgeTower
  )
    errors.push("Enable the purge tower for this shared-nozzle printer.");
  if (!(multi.purgeVolume >= 1 && multi.purgeVolume <= 2000))
    errors.push("Purge volume must be between 1 and 2000 mm³.");
  if (!validPurgeOverrides(multi.purgeVolumes))
    errors.push(
      "Invalid directional purge volumes. Use 1–2000 mm³ per change.",
    );
  if (!validTowerPositions(multi.towerPositions))
    errors.push(
      "Invalid manual tower position. Use finite X/Y coordinates and an X or Y row direction.",
    );
  if (
    (multi.flushVolume !== undefined &&
      (!Number.isFinite(multi.flushVolume) ||
        multi.flushVolume < 0 ||
        multi.flushVolume > 2000)) ||
    !validPurgeOverrides(multi.flushVolumes, 0)
  )
    errors.push("Station flushing volumes must be between 0 and 2000 mm³.");
  errors.push(
    ...materialCompatibility(models, printer, filaments, settings, multi)
      .errors,
  );
  return errors;
}
