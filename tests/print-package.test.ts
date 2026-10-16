import { it, expect } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
Object.assign(globalThis, { DOMParser });
import { createHash } from "node:crypto";
import { unzipSync, strFromU8, strToU8 } from "fflate";
import {
  createPrintPackage,
  md5,
  readPrintPackage,
} from "../src/lib/print-package";
import { VENDOR_PRINTERS } from "../src/lib/vendor-printers";
import { DEFAULT_SETTINGS } from "../src/lib/profiles";
import { defaultFilament } from "../src/lib/multimaterial";
import { parseGcode } from "../src/lib/gcode";
import type { Project } from "../src/types";
it("matches MD5 reference vectors including UTF-8 and block boundaries", () => {
  for (const input of [
    "",
    "a",
    "abc",
    "Stratum — 多色",
    "a".repeat(55),
    "b".repeat(64),
    "c".repeat(1500),
  ])
    expect(md5(strToU8(input))).toBe(
      createHash("md5").update(input).digest("hex"),
    );
});
it("exports a self-consistent Bambu print archive with machine and filament metadata", () => {
  const filaments = [0, 1, 2].map((i) => defaultFilament(DEFAULT_SETTINGS, i));
  const project: Project = {
    version: 1,
    name: "A & B",
    models: [],
    printer: {
      ...VENDOR_PRINTERS[1],
      name: "My workshop printer",
      nozzle: 0.6,
    },
    settings: DEFAULT_SETTINGS,
    filaments,
    plates: [1],
    activePlate: 1,
  };
  const result = parseGcode(
    "M83\n;LAYER:0\nG1 Z0.2\nT0\nG1 X10 E1\nT2\nG1 X20 E1",
    { diameter: 1.75, density: 1.24, cost: 25, filaments },
  );
  const bytes = createPrintPackage(project, result),
    files = unzipSync(bytes);
  expect(strFromU8(files["Metadata/plate_1.gcode.md5"])).toBe(
    createHash("md5").update(files["Metadata/plate_1.gcode"]).digest("hex"),
  );
  expect(strFromU8(files["Metadata/model_settings.config"])).toContain(
    "A &amp; B",
  );
  const info = strFromU8(files["Metadata/slice_info.config"]);
  expect(info).toContain('key="printer_model_id" value="C12"');
  expect(info).toContain('<filament id="3"');
  expect(info).not.toContain('<filament id="2"');
  expect(
    JSON.parse(strFromU8(files["Metadata/project_settings.config"])),
  ).toMatchObject({
    printer_model: "Bambu Lab P1S",
    printer_settings_id: "Bambu Lab P1S 0.6 nozzle",
    nozzle_diameter: ["0.6"],
  });
  expect(readPrintPackage(bytes)?.printer?.nozzle).toBe(0.6);
  expect(readPrintPackage(bytes)?.gcode).toBe(result.gcode);
  expect(readPrintPackage(bytes)?.filaments?.map((f) => f.color)).toEqual(
    filaments.map((f) => f.color),
  );
});

import { zipSync } from "fflate";
import { multiPlateFiles, multiPlatePackage } from "./fixtures/multi-plate";
it("indexes every job in numeric plate order and applies the selected plate's name, machine and sparse material IDs", () => {
  const bytes = multiPlatePackage();
  const first = readPrintPackage(bytes)!;
  expect(first.plates.map((p) => p.index)).toEqual([2, 3, 10]);
  expect(first.path).toBe("Metadata/plate_2.gcode");
  expect(first.plates.map((p) => p.name)).toEqual([
    "Base",
    "Plate 3",
    "Cap & clip",
  ]);
  expect(first.plates[1].unavailable).toBe("Empty G-code");
  expect(first.printer?.id).toBe("bambu-p1s");
  expect(first.filaments?.[0].color).toBe("#CC3322");
  expect(first.filaments?.[0].name).toBe("Original PLA");
  expect(first.warnings).toEqual([]);
  const other = readPrintPackage(bytes, "Metadata/plate_10.gcode")!;
  expect(other.gcode).toContain("T2\n");
  expect(other.printer?.id).toBe("bambu-a1-mini");
  expect(other.printer?.bed).toEqual([180, 180, 180]);
  expect(other.printer?.nozzle).toBe(0.6);
  expect(other.filaments).toHaveLength(3);
  expect(other.filaments?.[2]).toMatchObject({
    material: "PETG",
    color: "#2233AA",
    name: "PETG 3",
  });
  expect(other.filaments?.[0].color).toBe("#ffffff");
  expect(() => readPrintPackage(bytes, "Metadata/plate_3.gcode")).toThrow(
    "Empty G-code",
  );
  expect(() => readPrintPackage(bytes, "missing")).toThrow(
    "not in this print package",
  );
});
it("does not inflate unselected jobs, even when their compressed payload is corrupt", () => {
  const bytes = multiPlatePackage();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint16(8, true)).toBe(8); // DEFLATE, first job is plate 10.
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  bytes[start] = 7; // Invalid reserved DEFLATE block type.
  expect(readPrintPackage(bytes)?.path).toBe("Metadata/plate_2.gcode");
  expect(() => readPrintPackage(bytes, "Metadata/plate_10.gcode")).toThrow();
});
it("keeps G-code viewable when optional metadata or its checksum is invalid and reports what was lost", () => {
  const files = multiPlateFiles();
  files["Metadata/project_settings.config"] = strToU8("invalid json");
  files["Metadata/model_settings.config"] = strToU8(
    "<!DOCTYPE config><config/>",
  );
  files["Metadata/plate_2.gcode.md5"] = strToU8("0".repeat(32));
  const result = readPrintPackage(zipSync(files))!;
  expect(result.gcode).toContain("T0\n");
  expect(result.printer?.id).toBe("bambu-p1s");
  expect(result.filaments?.[0].color).toBe("#CC3322");
  expect(result.warnings.join("\n")).toMatch(
    /Plate metadata could not be read/,
  );
  expect(result.warnings.join("\n")).toMatch(
    /Project metadata could not be read/,
  );
  expect(result.warnings.join("\n")).toMatch(/checksum does not match/);
});
it("uses explicit plate-to-path associations, and does not guess an unknown machine from global defaults", () => {
  const files: Record<string, Uint8Array> = multiPlateFiles();
  files["Jobs/custom.gcode"] = files["Metadata/plate_2.gcode"];
  delete files["Metadata/plate_2.gcode"];
  files["Metadata/model_settings.config"] = strToU8(
    '<config><plate><metadata key="plater_id" value="2"/><metadata key="plater_name" value="Custom job"/><metadata key="gcode_file" value="Jobs/custom.gcode"/></plate></config>',
  );
  files["Metadata/slice_info.config"] = strToU8(
    '<config><plate><metadata key="index" value="2"/><metadata key="printer_model_id" value="Unrecognized machine"/><filament id="64" type="PLA" color="#AABBCC"/><filament id="0" type="PLA" color="#000000"/></plate></config>',
  );
  const result = readPrintPackage(zipSync(files))!;
  expect(result.path).toBe("Jobs/custom.gcode");
  expect(result.printer).toBeUndefined();
  expect(result.filaments?.[63].color).toBe("#AABBCC");
  expect(result.warnings.join("\n")).toContain("Unrecognized package printer");
  expect(result.warnings.join("\n")).toContain("unsupported tool ID");
});
it("rejects ambiguous archive paths and excessive plate counts", () => {
  expect(() =>
    readPrintPackage(
      zipSync({
        "Metadata/plate_1.gcode": strToU8("G1 X1 E1"),
        "metadata/PLATE_1.GCODE": strToU8("G1 X2 E2"),
      }),
    ),
  ).toThrow("duplicate G-code paths");
  expect(() =>
    readPrintPackage(
      zipSync(
        Object.fromEntries(
          Array.from({ length: 201 }, (_, i) => [
            `Metadata/plate_${i}.gcode`,
            strToU8("G1 X1 E1"),
          ]),
        ),
      ),
    ),
  ).toThrow("200 plates");
});
it("lists an oversized job but refuses to inflate it while other plates stay available", () => {
  const bytes = multiPlatePackage();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let central = 0;
  while (view.getUint32(central, true) !== 0x02014b50) central++;
  expect(
    strFromU8(
      bytes.slice(
        central + 46,
        central + 46 + view.getUint16(central + 28, true),
      ),
    ),
  ).toBe("Metadata/plate_10.gcode");
  view.setUint32(central + 24, 100 * 1024 * 1024 + 1, true);
  const result = readPrintPackage(bytes)!;
  expect(result.path).toBe("Metadata/plate_2.gcode");
  expect(result.plates.find((p) => p.index === 10)?.unavailable).toBe(
    "G-code exceeds 100 MB",
  );
  expect(() => readPrintPackage(bytes, "Metadata/plate_10.gcode")).toThrow(
    "exceeds 100 MB",
  );
});
it("does not pick an arbitrary material set from duplicate per-plate metadata", () => {
  const files = multiPlateFiles();
  files["Metadata/slice_info.config"] = strToU8(
    '<config><plate><metadata key="index" value="2"/><filament id="1" color="#ff0000"/></plate><plate><metadata key="index" value="2"/><filament id="1" color="#0000ff"/></plate></config>',
  );
  const result = readPrintPackage(zipSync(files))!;
  expect(result.filaments?.[0].color).toBe("#ffffff");
  expect(result.warnings).toContain(
    "Base: duplicate slice metadata was ignored.",
  );
});
it("distinguishes A1 mini from A1 when only the project profile name is present", () => {
  for (const model of ["Bambu Lab A1 mini", "Bambu Lab A1 mini 0.4 nozzle"]) {
    const files: Record<string, Uint8Array> = multiPlateFiles();
    delete files["Metadata/slice_info.config"];
    files["Metadata/project_settings.config"] = strToU8(
      JSON.stringify({ printer_settings_id: model }),
    );
    expect(readPrintPackage(zipSync(files))?.printer?.id).toBe("bambu-a1-mini");
  }
  const files: Record<string, Uint8Array> = multiPlateFiles();
  delete files["Metadata/slice_info.config"];
  files["Metadata/project_settings.config"] = strToU8(
    JSON.stringify({ printer_model: "Bambu Lab A1 Unrecognized" }),
  );
  expect(readPrintPackage(zipSync(files))?.printer).toBeUndefined();
});
