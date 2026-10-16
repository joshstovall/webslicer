import type { Printer } from "../types";
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
const cache = new Map<string, Printer>();
/** Import official, pinned templates on selection; retained in the local project. */
export async function loadVendorPrinter(printer: Printer): Promise<Printer> {
  if (!printer.firmware || printer.startGcode) return printer;
  if (cache.has(printer.id)) return structuredClone(cache.get(printer.id)!);
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
  const fields = ["startGcode", "endGcode", "toolChangeGcode"] as const;
  const loaded = { ...printer };
  if (printer.firmware === "bambu") {
    const model = names[printer.id];
    if (!model) throw new Error("Unknown Bambu profile.");
    const sources = await Promise.all(
      keys.map((key) =>
        json(
          `https://raw.githubusercontent.com/bambulab/BambuStudio/${BAMBU_REVISION}/resources/profiles/BBL/machine/${encodeURIComponent(`Bambu Lab ${model} 0.4 nozzle template ${key}.json`)}`,
        ),
      ),
    );
    keys.forEach((key, i) => {
      loaded[fields[i]] = sources[i][key];
    });
  } else {
    const source = await json(
      `https://raw.githubusercontent.com/Snapmaker/OrcaSlicer/${SNAPMAKER_REVISION}/resources/profiles/Snapmaker/machine/${encodeURIComponent("Snapmaker U1 (0.4 nozzle).json")}`,
    );
    keys.forEach((key, i) => {
      loaded[fields[i]] = source[key];
    });
  }
  for (const field of fields) {
    if (
      typeof loaded[field] !== "string" ||
      !loaded[field] ||
      loaded[field]!.length > 100000
    )
      throw new Error(`Official printer profile is missing ${field}.`);
  }
  cache.set(printer.id, loaded);
  return structuredClone(loaded);
}
