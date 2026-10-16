import { get, set } from "idb-keyval";
import { strToU8, strFromU8, gzipSync, gunzipSync } from "fflate";
import type { Project, Model } from "../types";
import { DEFAULT_SETTINGS, PRINTERS } from "./profiles";
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
    models: p.models.map((m) => ({ ...m, positions: Array.from(m.positions) })),
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
  return {
    ...v,
    name: String(v.name || "Untitled project"),
    models,
    printer: { ...PRINTERS[0], ...v.printer },
    settings: { ...DEFAULT_SETTINGS, ...v.settings },
  };
}
