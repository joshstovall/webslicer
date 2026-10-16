import { applySettingsPatch } from "../src/lib/material-settings";
import { expect, it } from "vitest";
import {
  materialCompatibility,
  materialRequirements,
  validMaterialRequirements,
  validPrinterHardware,
} from "../src/lib/material-compatibility";
import {
  materialErrors,
  defaultFilament,
  DEFAULT_MULTI_MATERIAL as multi,
} from "../src/lib/multimaterial";
import { DEFAULT_SETTINGS as settings, PRINTERS } from "../src/lib/profiles";
import { primitive } from "../src/lib/geometry";
import { validateProject } from "../src/lib/project";
import { slicePlate } from "../src/lib/slicer";
import type { Filament, Printer } from "../src/types";
const u1 = PRINTERS.find((p) => p.id === "snapmaker-u1")!;
const p1 = PRINTERS.find((p) => p.id === "bambu-p1s")!;
const x1 = PRINTERS.find((p) => p.id === "bambu-x1c")!;
const a1 = PRINTERS.find((p) => p.id === "bambu-a1")!;
const model = (tool = 0) => ({ ...primitive("cube", 1), tool });
const filament = (
  material: string,
  requirements?: Filament["requirements"],
): Filament => ({ ...defaultFilament(settings), material, requirements });
const report = (
  printer: Printer,
  filaments: Filament[],
  models = [model()],
  s = settings,
) => materialCompatibility(models, printer, filaments, s, multi);
it("checks stock hardware and upgrades against physical heads, not AMS slots", () => {
  const cf = filament("PA6-CF");
  expect(report(u1, [cf]).errors.join(" ")).toMatch(/enclosure/);
  expect(report(u1, [cf]).errors.join(" ")).toMatch(/physical head 1/);
  const upgraded = { ...u1, hardware: { enclosed: true, abrasiveTools: [3] } };
  expect(report(upgraded, [cf, cf, cf, cf], [model(3)]).errors).toEqual([]);
  expect(
    report(upgraded, [cf, cf, cf, cf], [model(2)]).errors.join(" "),
  ).toMatch(/physical head 3/);
  expect(report(x1, Array(16).fill(cf), [model(15)]).errors).toEqual([]);
  expect(report(p1, [cf]).errors.join(" ")).toMatch(/physical head 1/);
  expect(
    report({ ...p1, hardware: { abrasiveTools: [0] } }, [cf]).errors,
  ).toEqual([]);
});
it("scopes flexible spool feed approval to the actual AMS system", () => {
  const tpu = filament("TPU 95A");
  expect(report(p1, [tpu]).errors.join(" ")).toMatch(/AMS/);
  expect(report(a1, [tpu]).errors.join(" ")).toMatch(/AMS lite/);
  expect(report(u1, [tpu]).errors).toEqual([]);
  const certified = filament("TPU 95A", {
    feedSystem: "AMS",
    feedCompatibility: "compatible",
  });
  expect(report(p1, [certified]).errors).toEqual([]);
  expect(report(a1, [certified]).errors.join(" ")).toMatch(/AMS lite/);
  expect(
    report(p1, [
      filament("PLA", { feedSystem: "AMS", feedCompatibility: "incompatible" }),
    ]).errors.join(" "),
  ).toMatch(/AMS/);
});
it("checks painted and support slots but excludes hidden and unused spools", () => {
  const fs = [filament("PLA"), filament("PA-CF")];
  expect(report(u1, fs).errors).toEqual([]);
  expect(
    report(u1, fs, [model(), { ...model(1), visible: false }]).errors,
  ).toEqual([]);
  expect(
    report(u1, fs, [{ ...model(), faceTools: new Uint8Array([0, 1]) }]).errors,
  ).toHaveLength(2);
  expect(
    materialCompatibility(
      [model()],
      u1,
      fs,
      { ...settings, supports: "auto" },
      { ...multi, supportTool: 1 },
    ).errors,
  ).toHaveLength(2);
  expect(
    materialCompatibility(
      [],
      u1,
      fs,
      { ...settings, supports: "auto" },
      { ...multi, supportTool: 1 },
    ).errors,
  ).toEqual([]);
});
it("enforces each spool's first and normal shared-bed range and reports disjoint materials", () => {
  const fs = [
    filament("PLA", { bedRange: [50, 65] }),
    filament("PETG", { bedRange: [70, 85] }),
  ];
  const result = report(u1, fs, [model(), model(1)], {
    ...settings,
    bedTemp: 60,
    firstBedTemp: 80,
  });
  expect(result.errors.join(" ")).toMatch(/First-layer bed temperature 80/);
  expect(result.errors.join(" ")).toMatch(/Bed temperature 60/);
  expect(result.errors.join(" ")).toMatch(/do not overlap/);
  expect(
    report(
      u1,
      [fs[0], filament("PETG", { bedRange: [60, 85] })],
      [model(), model(1)],
      { ...settings, bedTemp: 60, firstBedTemp: 65 },
    ).errors,
  ).toEqual([]);
});
it("supports exact-product enclosure and nozzle requirements without using cosmetic names", () => {
  const f = { ...filament("PLA"), name: "PA-CF" };
  expect(materialRequirements(f).abrasive).toBe(false);
  expect(report(u1, [filament("ABS", { enclosure: false })]).errors).toEqual(
    [],
  );
  expect(
    report(x1, [filament("PLA-CF", { minNozzle: 0.6 })]).errors.join(" "),
  ).toMatch(/at least 0.6/);
  expect(report(u1, [filament("Mystery")]).warnings.join(" ")).toMatch(
    /unknown/,
  );
});
it("warns about actual mixed-family assemblies, soluble feeders and flexible towers", () => {
  const fs = [filament("PLA"), filament("PETG")];
  expect(report(u1, fs, [model(), model(1)]).warnings).toEqual([]);
  expect(
    report(
      u1,
      fs,
      [0, 1].map((tool) => ({ ...model(tool), assemblyId: "joined" })),
    ).warnings.join(" "),
  ).toMatch(/Bonding/);
  expect(
    report(u1, fs, [
      { ...model(), faceTools: new Uint8Array([1]) },
    ]).warnings.join(" "),
  ).toMatch(/Bonding/);
  expect(report(p1, [filament("PVA")]).warnings.join(" ")).toMatch(/dry/);
  expect(
    report(
      u1,
      [filament("PLA"), filament("TPU")],
      [model(), model(1)],
    ).warnings.join(" "),
  ).toMatch(/rigidity/);
});
it("rejects malformed hardware, requirements and control characters during import", () => {
  for (const value of [
    null,
    [],
    { abrasive: 1 },
    { enclosure: null },
    { minNozzle: NaN },
    { bedRange: [80, 60] },
    { bedRange: [0, Infinity] },
    { feedCompatibility: "compatible" },
    { feedSystem: "bogus" },
  ])
    expect(validMaterialRequirements(value)).toBe(false);
  for (const h of [
    null,
    [],
    { abrasiveTools: [0, 0] },
    { abrasiveTools: [4] },
    { enclosed: 1 },
  ])
    expect(validPrinterHardware({ ...u1, hardware: h } as Printer)).toBe(false);
  const project = {
    version: 1,
    name: "Requirements",
    plates: [1],
    activePlate: 1,
    models: [],
    printer: { ...u1, hardware: { enclosed: true, abrasiveTools: [0, 3] } },
    settings,
    filaments: [
      filament("PA6-CF", {
        abrasive: true,
        enclosure: true,
        minNozzle: 0.4,
        bedRange: [80, 100],
      }),
    ],
  };
  expect(validateProject(project).filaments).toEqual(project.filaments);
  expect(validateProject(project).printer.hardware).toEqual(
    project.printer.hardware,
  );
  expect(() =>
    validateProject({ ...project, filaments: [filament("PLA\nM104 S999")] }),
  ).toThrow(/filament data/);
  expect(() =>
    validateProject({
      ...project,
      filaments: [filament("PLA", { minNozzle: 0 })],
    }),
  ).toThrow(/material requirements/);
});
it("enforces compatibility in direct slicing before creating an engine worker", async () => {
  const fs = [filament("ABS")];
  expect(materialErrors([model()], u1, fs, settings, multi).join(" ")).toMatch(
    /enclosure/,
  );
  await expect(
    slicePlate(
      [model()],
      u1,
      settings,
      () => {},
      new AbortController().signal,
      fs,
      multi,
    ),
  ).rejects.toThrow(/enclosure/);
});

it("clears old product requirements on single-spool material changes, preserving process-only edits", () => {
  const f = filament("PLA", {
    enclosure: false,
    feedSystem: "AMS",
    feedCompatibility: "compatible",
  });
  const project = {
    version: 1 as const,
    name: "Preset",
    plates: [1],
    activePlate: 1,
    models: [],
    printer: p1,
    settings,
    filaments: [f],
  };
  expect(
    applySettingsPatch(project, { speed: 80 }).filaments![0].requirements,
  ).toEqual(f.requirements);
  expect(
    applySettingsPatch(project, { material: "TPU" }).filaments![0].requirements,
  ).toBeUndefined();
  expect(
    applySettingsPatch({ ...project, filaments: [f, f] }, { material: "TPU" })
      .filaments,
  ).toEqual([f, f]);
});

it("recognizes compact flexible grades and underscore-separated fiber codes", () => {
  expect(report(p1, [filament("TPU95A")]).errors.join(" ")).toMatch(
    /compatible with AMS/,
  );
  expect(report(u1, [filament("PETG_CF")]).errors.join(" ")).toMatch(
    /abrasion-resistant/,
  );
  expect(
    report(p1, [
      filament("TPU", { feedSystem: "AMS", feedCompatibility: "unspecified" }),
    ]).errors.join(" "),
  ).toMatch(/compatible with AMS/);
});
