import type {
  Filament,
  Model,
  MultiMaterialSettings,
  Printer,
  Settings,
} from "../types";

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
export function validPurgeOverrides(value: unknown): boolean {
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
      volume >= 1 &&
      volume <= 2000
    );
  });
}
export function materialErrors(
  models: Model[],
  printer: Printer,
  filaments: Filament[],
  settings: Settings,
  multi: MultiMaterialSettings,
): string[] {
  const errors: string[] = [];
  const capacity = printer.toolCount ?? 1;
  if (models.some((m) => m.visible && m.faceTools))
    errors.push(
      "Surface-color slicing is not ready yet. Assign a single filament to each part to clear surface assignments.",
    );
  const used = new Set(models.filter((m) => m.visible).map((m) => m.tool ?? 0));
  if (settings.supports !== "disabled") used.add(multi.supportTool);
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
  return errors;
}
