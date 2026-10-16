import { vendorNozzleLimits } from "./nozzle-profiles";
import type { Printer } from "../types";
import { get, set } from "idb-keyval";
const BAMBU_REVISION = "79df7ae309be398ed30c9f397c13c9911c2edc57";
const SNAPMAKER_REVISION = "89311782298309040ee28b9a183f33f0f5477b15";
const bambu = (model: string, id: string, size = 256, tools = 16): Printer => ({
  id,
  name: `Bambu Lab ${model} + AMS`,
  bed: [size, size, size],
  nozzle: 0.4,
  filament: 1.75,
  toolCount: tools,
  multiMaterialMode: "shared-nozzle",
  firmware: "bambu",
  startGcode: "",
  endGcode: "",
  toolChangeGcode: "",
  bedType: "Textured PEI Plate",
  profileSource: `https://github.com/bambulab/BambuStudio/tree/${BAMBU_REVISION}/resources/profiles/BBL/machine`,
  profileRevision: BAMBU_REVISION,
});
export const VENDOR_PRINTERS: Printer[] = [
  bambu("X1 Carbon", "bambu-x1c"),
  bambu("P1S", "bambu-p1s"),
  bambu("P1P", "bambu-p1p"),
  bambu("A1", "bambu-a1", 256, 4),
  bambu("A1 mini", "bambu-a1-mini", 180, 4),
  {
    id: "snapmaker-u1",
    name: "Snapmaker U1",
    bed: [270, 270, 270],
    bedOrigin: [0.5, 1],
    nozzle: 0.4,
    filament: 1.75,
    toolCount: 4,
    multiMaterialMode: "toolchanger",
    firmware: "snapmaker-u1",
    bedType: "Textured PEI Plate",
    startGcode: "",
    endGcode: "",
    toolChangeGcode: "",
    profileRevision: SNAPMAKER_REVISION,
    profileSource: `https://github.com/Snapmaker/OrcaSlicer/tree/${SNAPMAKER_REVISION}/resources/profiles/Snapmaker/machine`,
  },
];
const names: Record<string, string> = {
  "bambu-x1c": "X1 Carbon",
  "bambu-p1s": "P1S",
  "bambu-p1p": "P1P",
  "bambu-a1": "A1",
  "bambu-a1-mini": "A1 mini",
};
const fields = ["startGcode", "endGcode", "toolChangeGcode"] as const;
type Templates = Required<Pick<Printer, (typeof fields)[number]>>;
const cache = new Map<string, Templates>();
function validTemplates(value: unknown): value is Templates {
  return (
    !!value &&
    typeof value === "object" &&
    fields.every((field) => {
      const text = (value as Templates)[field];
      return (
        typeof text === "string" &&
        text.trim().length > 0 &&
        text.length <= 100000
      );
    })
  );
}
async function storedTemplates(key: string): Promise<unknown> {
  try {
    return await get(key);
  } catch {
    return undefined;
  }
}
/** Cache pinned templates separately from editable printer dimensions/settings. */
export async function loadVendorPrinter(printer: Printer): Promise<Printer> {
  if (!printer.firmware) return printer;
  if (!vendorNozzleLimits(printer))
    throw new Error("Unsupported official nozzle profile.");
  if (
    validTemplates(printer) &&
    (printer.profileNozzle ?? 0.4) === printer.nozzle
  )
    return { ...printer, profileNozzle: printer.nozzle };
  const preset = VENDOR_PRINTERS.find(
    (p) => p.id === printer.id && p.firmware === printer.firmware,
  );
  if (!preset) throw new Error("Unknown official printer profile.");
  const revision =
    printer.firmware === "bambu" ? BAMBU_REVISION : SNAPMAKER_REVISION;
  const modelName =
    printer.firmware === "bambu"
      ? `Bambu Lab ${names[printer.id]} ${printer.nozzle} nozzle`
      : `Snapmaker U1 (${printer.nozzle} nozzle)`;
  const repository =
    printer.firmware === "bambu"
      ? "bambulab/BambuStudio"
      : "Snapmaker/OrcaSlicer";
  const directory = printer.firmware === "bambu" ? "BBL" : "Snapmaker";
  const source = `https://github.com/${repository}/blob/${revision}/resources/profiles/${directory}/machine/${encodeURIComponent(modelName + ".json")}`;
  const key = `vendor-templates:v2:${printer.firmware}:${printer.id}:${revision}:${printer.nozzle}`;
  let saved = cache.get(key) ?? (await storedTemplates(key));
  if (!saved && printer.nozzle === 0.4)
    saved = await storedTemplates(
      `vendor-templates:v1:${printer.firmware}:${printer.id}:${revision}`,
    );
  if (validTemplates(saved)) {
    const templates = {
      startGcode: saved.startGcode,
      endGcode: saved.endGcode,
      toolChangeGcode: saved.toolChangeGcode,
    };
    cache.set(key, templates);
    return {
      ...printer,
      ...templates,
      profileRevision: revision,
      profileSource: source,
      profileNozzle: printer.nozzle,
    };
  }
  const json = async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok)
      throw new Error(
        `Could not load official printer profile (${response.status}).`,
      );
    return response.json();
  };
  const keys = [
    "machine_start_gcode",
    "machine_end_gcode",
    "change_filament_gcode",
  ] as const;
  const loaded = {
    ...printer,
    profileRevision: revision,
    profileSource: source,
    profileNozzle: printer.nozzle,
  };
  const rawBase = `https://raw.githubusercontent.com/${repository}/${revision}/resources/profiles/${directory}/machine/`;
  const read = (name: string) =>
    json(rawBase + encodeURIComponent(name + ".json"));
  const root = await read(modelName);
  if (
    !Array.isArray(root.nozzle_diameter) ||
    !root.nozzle_diameter.length ||
    !root.nozzle_diameter.every((n: string) => Number(n) === printer.nozzle)
  )
    throw new Error(
      "Official profile nozzle diameter does not match the requested nozzle.",
    );
  if (printer.firmware === "bambu") {
    const base =
      printer.nozzle === 0.4
        ? root
        : await read(`Bambu Lab ${names[printer.id]} 0.4 nozzle`);
    const templates = await Promise.all(
      keys.map(async (key) => {
        const suffix = ` template ${key}`;
        const include =
          (root.include ?? []).find((n: string) => n.endsWith(suffix)) ??
          (base.include ?? []).find((n: string) => n.endsWith(suffix));
        if (
          typeof include !== "string" ||
          !include.startsWith(`Bambu Lab ${names[printer.id]} `) ||
          /[/\\]/.test(include)
        )
          throw new Error(`Official profile is missing ${key}.`);
        return (await read(include))[key];
      }),
    );
    keys.forEach((_, i) => {
      loaded[fields[i]] = templates[i];
    });
  } else {
    keys.forEach((key, i) => {
      loaded[fields[i]] = root[key];
    });
  }
  for (const field of fields) {
    if (
      typeof loaded[field] !== "string" ||
      !loaded[field]?.trim() ||
      loaded[field]!.length > 100000
    )
      throw new Error(`Official printer profile is missing ${field}.`);
  }
  const templates: Templates = {
    startGcode: loaded.startGcode!,
    endGcode: loaded.endGcode!,
    toolChangeGcode: loaded.toolChangeGcode!,
  };
  cache.set(key, templates);
  // Storage may be disabled/full. A successful online selection still works;
  // saving the project also retains these templates in its portable payload.
  try {
    await set(key, templates);
  } catch {
    /* Optional offline cache. */
  }
  return structuredClone(loaded);
}
