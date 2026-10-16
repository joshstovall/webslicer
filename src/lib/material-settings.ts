import type { Filament, Project, Settings } from "../types";
import { defaultFilament } from "./multimaterial";
const keys = [
  "material",
  "nozzleTemp",
  "firstNozzleTemp",
  "flow",
  "maxFlow",
  "density",
  "cost",
  "fan",
  "fanLayer",
  "fanRampLayers",
  "minLayerTime",
  "minPrintSpeed",
] as const;
/** One spool is authoritative for material settings; process edits leave it intact. */
export function settingsForFilament(
  settings: Settings,
  filament: Filament,
): Settings {
  const patch = Object.fromEntries(
    keys.map((key) => [key, filament[key] ?? settings[key]]),
  );
  return { ...settings, ...patch };
}
/** A single-material preset edits the spool too. Multi-material presets only edit process/shared-bed settings. */
export function applySettingsPatch(
  project: Project,
  patch: Partial<Settings>,
): Project {
  const filaments = project.filaments ?? [defaultFilament(project.settings)];
  if (filaments.length > 1) {
    const process = Object.fromEntries(
      Object.entries(patch).filter(
        ([key]) => !(keys as readonly string[]).includes(key),
      ),
    );
    return { ...project, settings: { ...project.settings, ...process } };
  }
  const settings = { ...project.settings, ...patch };
  const material = Object.fromEntries(
    keys
      .filter((key) => patch[key] !== undefined)
      .map((key) => [key, patch[key]]),
  );
  const filament = { ...filaments[0], ...material };
  return {
    ...project,
    settings: settingsForFilament(settings, filament),
    filaments: [filament],
  };
}
