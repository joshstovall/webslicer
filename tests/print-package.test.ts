import { it, expect } from "vitest";
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
    printer: VENDOR_PRINTERS[1],
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
  expect(readPrintPackage(bytes)?.gcode).toBe(result.gcode);
  expect(readPrintPackage(bytes)?.filaments?.map((f) => f.color)).toEqual(
    filaments.map((f) => f.color),
  );
});
