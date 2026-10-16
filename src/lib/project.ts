import { validateModifiers } from "./modifiers";
import { validManualLayerSettings } from "./layer-height";
import {
  validMaterialRequirements,
  validPrinterHardware,
  validMaterialCode,
} from "./material-compatibility";
import { get, set } from "idb-keyval";
import { strToU8, strFromU8, gzipSync, gunzipSync } from "fflate";
import type { Project, Model } from "../types";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
  validPurgeOverrides,
  validTowerPositions,
  independentPurgeBudgets,
} from "./multimaterial";
import { DEFAULT_SETTINGS, PRINTERS } from "./profiles";
import { settingsForFilament } from "./material-settings";
import { validCoolingSettings } from "./cooling";
const KEY = "stratum-project-v1";
export async function saveLocal(p: Project) {
  await set(KEY, p);
}
export async function loadLocal(): Promise<Project | undefined> {
  const p = await get(KEY);
  return p ? validateProject(p) : undefined;
}
export function download(
  data: BlobPart,
  name: string,
  type = "application/octet-stream",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function saveProject(p: Project) {
  const json = JSON.stringify({
    ...p,
    models: p.models.map((m) => ({
      ...m,
      positions: Array.from(m.positions),
      modifiers: m.modifiers?.map((v) => ({
        ...v,
        positions: Array.from(v.positions),
      })),
      faceTools: m.faceTools ? Array.from(m.faceTools) : undefined,
      paintTriangles: m.paintTriangles
        ? Array.from(m.paintTriangles)
        : undefined,
    })),
  });
  download(
    gzipSync(strToU8(json)) as Uint8Array<ArrayBuffer>,
    `${p.name}.webslicer`,
  );
}
export async function readProject(f: File): Promise<Project> {
  if (f.size > 100 * 1024 * 1024) throw new Error("Project exceeds 100 MB.");
  const bytes = new Uint8Array(await f.arrayBuffer());
  const text =
    bytes[0] === 31 && bytes[1] === 139
      ? strFromU8(gunzipSync(bytes))
      : await f.text();
  return validateProject(JSON.parse(text));
}
export function validateProject(p: unknown): Project {
  const v = p as Project;
  if (
    v?.version !== 1 ||
    !Array.isArray(v.models) ||
    v.models.length > 200 ||
    !v.printer ||
    !v.settings ||
    !Array.isArray(v.plates) ||
    !v.plates.length
  )
    throw new Error("This is not a valid Stratum project.");
  const vector = (a: unknown) =>
    Array.isArray(a) &&
    a.length === 3 &&
    a.every((n) => typeof n === "number" && Number.isFinite(n));
  const models = v.models.map((m: Model) => {
    if (
      !m ||
      !m.positions ||
      m.positions.length % 9 ||
      m.positions.length > 18_000_000 ||
      !vector(m.position) ||
      !vector(m.rotation) ||
      !vector(m.scale) ||
      m.scale.some((n) => n <= 0)
    )
      throw new Error("Invalid model data.");
    const a = new Float32Array(m.positions);
    if (a.some((n) => !Number.isFinite(n)))
      throw new Error("Model has invalid coordinates.");
    return {
      ...m,
      id: String(m.id),
      name: String(m.name),
      positions: a,
      modifiers: validateModifiers(m.modifiers),
      tool: m.tool ?? 0,
      assemblyId:
        typeof m.assemblyId === "string" && m.assemblyId.length <= 128
          ? m.assemblyId
          : undefined,
      faceTools: m.faceTools ? new Uint8Array(m.faceTools) : undefined,
      paintTriangles: m.paintTriangles
        ? new Float32Array(m.paintTriangles)
        : undefined,
      color: /^#[a-f0-9]{6}$/i.test(m.color) ? m.color : "#91ad87",
    };
  });
  if (
    !vector(v.printer.bed) ||
    v.printer.bed.some((n) => n <= 0 || n > 2000) ||
    !(v.printer.nozzle > 0) ||
    !(v.printer.filament > 0)
  )
    throw new Error("Invalid printer dimensions.");
  if (
    v.printer.profileNozzle !== undefined &&
    ![0.2, 0.4, 0.6, 0.8].includes(v.printer.profileNozzle)
  )
    throw new Error("Invalid official nozzle profile metadata.");
  if (!validPrinterHardware(v.printer))
    throw new Error("Invalid printer hardware configuration.");
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const current = (v.settings as unknown as Record<string, unknown>)[key];
    if (
      typeof value === "number" &&
      (typeof current !== "number" || !Number.isFinite(current))
    )
      throw new Error(`Invalid setting: ${key}`);
  }
  if (
    v.settings.layerHeight <= 0 ||
    v.settings.layerHeight > 2 ||
    v.settings.firstLayerHeight <= 0 ||
    v.settings.speed <= 0
  )
    throw new Error("Invalid layer height or print speed.");
  if (!validManualLayerSettings(v.settings))
    throw new Error("Invalid manual layer-height settings.");
  for (const m of v.models) {
    if (
      m.faceTools &&
      (m.faceTools.length !== (m.paintTriangles ?? m.positions).length / 9 ||
        Array.from(m.faceTools).some(
          (t) => !Number.isInteger(t) || t < 0 || t > 63,
        ))
    )
      throw new Error("Invalid triangle material data.");
    if (
      m.paintTriangles &&
      (!m.faceTools ||
        !m.paintTriangles.length ||
        m.paintTriangles.length % 9 ||
        m.paintTriangles.length > 18_000_000 ||
        Array.from(m.paintTriangles).some((n) => !Number.isFinite(n)))
    )
      throw new Error("Invalid painted surface geometry.");
    if (
      m.paintDepth !== undefined &&
      (!Number.isFinite(m.paintDepth) ||
        m.paintDepth < 0.1 ||
        m.paintDepth > 20)
    )
      throw new Error("Invalid painted surface depth.");
  }
  let filaments = v.filaments ?? [defaultFilament(v.settings)];
  if (!Array.isArray(filaments) || !filaments.length || filaments.length > 64)
    throw new Error("Invalid filament list.");
  for (const f of filaments) {
    if (
      !f ||
      typeof f.name !== "string" ||
      !validMaterialCode(f.material) ||
      !/^#[0-9a-f]{6}$/i.test(f.color)
    )
      throw new Error("Invalid filament data.");
    if (!validMaterialRequirements(f.requirements))
      throw new Error("Invalid filament material requirements.");
    if (!validCoolingSettings(f, { ...DEFAULT_SETTINGS, ...v.settings }))
      throw new Error("Invalid filament layer cooling settings.");
    for (const [key, min, max] of [
      ["nozzleTemp", 150, 350],
      ["firstNozzleTemp", 150, 350],
      ["density", 0.5, 3],
      ["cost", 0, 1000],
      ["flow", 0.5, 1.5],
      ["maxFlow", 1, 100],
      ["fan", 0, 100],
    ] as const) {
      if (!Number.isFinite(f[key]) || f[key] < min || f[key] > max)
        throw new Error(`Invalid filament ${key}.`);
    }
  }
  filaments = filaments.map((f) => ({
    ...f,
    fanLayer: f.fanLayer ?? v.settings.fanLayer,
  }));
  if (
    filaments.some(
      (f) =>
        !Number.isInteger(f.fanLayer) || f.fanLayer! < 1 || f.fanLayer! > 20,
    )
  )
    throw new Error("Invalid filament fan start layer.");
  if (
    v.printer.mainsVoltage !== undefined &&
    ![110, 220].includes(v.printer.mainsVoltage)
  )
    throw new Error("Invalid printer mains voltage.");
  for (const m of models)
    if (!Number.isInteger(m.tool) || m.tool < 0 || m.tool >= filaments.length)
      throw new Error("Invalid model filament assignment.");
  for (const m of models)
    if (m.faceTools?.some((t) => t >= filaments.length))
      throw new Error("Invalid triangle filament assignment.");
  const multiMaterial = independentPurgeBudgets({
    ...DEFAULT_MULTI_MATERIAL,
    ...v.multiMaterial,
  });
  if (
    !Number.isFinite(multiMaterial.purgeVolume) ||
    !validPurgeOverrides(multiMaterial.purgeVolumes) ||
    !validPurgeOverrides(multiMaterial.flushVolumes, 0) ||
    !validTowerPositions(multiMaterial.towerPositions) ||
    Object.keys(multiMaterial.towerPositions ?? {}).some(
      (id) => !v.plates.includes(Number(id)),
    ) ||
    !Number.isFinite(multiMaterial.flushVolume) ||
    multiMaterial.flushVolume! < 0 ||
    multiMaterial.flushVolume! > 2000 ||
    multiMaterial.purgeVolume < 1 ||
    multiMaterial.purgeVolume > 2000 ||
    !Number.isInteger(multiMaterial.supportTool) ||
    multiMaterial.supportTool < 0 ||
    multiMaterial.supportTool >= filaments.length ||
    typeof multiMaterial.purgeTower !== "boolean"
  )
    throw new Error("Invalid multi-material settings.");
  if (
    v.printer.toolCount !== undefined &&
    (!Number.isInteger(v.printer.toolCount) ||
      v.printer.toolCount < 1 ||
      v.printer.toolCount > 64)
  )
    throw new Error("Invalid printer tool count.");
  return {
    ...v,
    filaments,
    multiMaterial,
    name: String(v.name || "Untitled project"),
    models,
    printer: { ...PRINTERS[0], ...v.printer },
    settings:
      filaments.length === 1
        ? settingsForFilament(
            { ...DEFAULT_SETTINGS, ...v.settings },
            filaments[0],
          )
        : { ...DEFAULT_SETTINGS, ...v.settings },
  };
}
