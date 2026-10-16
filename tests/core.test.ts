import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  primitive,
  boundsOf,
  groundModel,
  dimensions,
  arrangeModels,
  validatePlate,
  modelVolume,
  exportSTL,
  createModel,
} from "../src/lib/geometry";
import { parseGcode } from "../src/lib/gcode";
import {
  processProfile,
  deviceProfile,
  DEFAULT_SETTINGS,
  PRINTERS,
} from "../src/lib/profiles";
import { cutModel, splitModel } from "../src/lib/mesh-tools";
import { validateProject } from "../src/lib/project";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
const printer = PRINTERS[0];
describe("geometry and plate operations", () => {
  it("creates a grounded 20 mm calibration cube with correct volume", () => {
    const m = primitive("cube", 1);
    expect(dimensions(m)).toEqual([20, 20, 20]);
    expect(modelVolume(m)).toBeCloseTo(8000);
    expect(boundsOf(m).min.z).toBe(0);
  });
  it("grounds a rotated mesh and reports transformed dimensions", () => {
    const m = groundModel({
      ...primitive("cube", 1),
      rotation: [45, 0, 0],
      scale: [2, 1, 1],
    });
    expect(boundsOf(m).min.z).toBeCloseTo(0);
    expect(dimensions(m)[0]).toBeCloseTo(40);
    expect(dimensions(m)[2]).toBeCloseTo(Math.sqrt(800));
  });
  it("arranges models without overlaps and centers the result", () => {
    const models = arrangeModels(
      Array.from({ length: 8 }, () => primitive("cube", 1)),
      printer,
    );
    expect(validatePlate(models, printer)).toEqual([]);
    const b = new THREE.Box3();
    models.forEach((m) => b.union(boundsOf(m)));
    expect(b.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
  });
  it("rejects an overflowing arrangement", () => {
    expect(() =>
      arrangeModels(
        Array.from({ length: 100 }, () => primitive("cube", 1)),
        printer,
      ),
    ).toThrow("do not fit");
  });
  it("detects floating, overlaps, out-of-bounds, and brim clearance", () => {
    const m = primitive("cube", 1);
    expect(
      validatePlate([{ ...m, position: [0, 0, 2] }], printer)[0],
    ).toContain("floating");
    expect(
      validatePlate([{ ...m, position: [0, 0, 2] }], printer, 0, true),
    ).toEqual([]);
    expect(
      validatePlate([{ ...m, position: [0, 0, -2] }], printer, 0, true)[0],
    ).toContain("printable area");
    expect(validatePlate([m, { ...m, id: "other" }], printer)[0]).toContain(
      "overlap",
    );
    expect(
      validatePlate([{ ...m, position: [100, 0, 0] }], printer, 5)[0],
    ).toContain("printable area");
  });
  it("exports a binary STL that round-trips with the applied transform", () => {
    const m = {
      ...primitive("cube", 1),
      position: [23, 8, 0] as [number, number, number],
    };
    const g = new STLLoader().parse(exportSTL([m]));
    g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(13);
    expect(g.getAttribute("position").count).toBe(36);
  });
  it("cuts a cube into two closed halves with conserved volume", () => {
    const m = primitive("cube", 1),
      parts = cutModel(m, 10, "both");
    expect(parts).toHaveLength(2);
    expect(parts.map((m) => dimensions(m)[2])).toEqual([10, 10]);
    expect(parts.reduce((v, m) => v + modelVolume(m), 0)).toBeCloseTo(8000);
  });
  it("caps a hollow planter cut without filling its cavity", () => {
    const m = primitive("vase", 1),
      parts = cutModel(m, 40, "both");
    expect(parts).toHaveLength(2);
    expect(parts.reduce((v, m) => v + modelVolume(m), 0)).toBeCloseTo(
      modelVolume(m),
      0,
    );
  });
  it("splits disconnected meshes and preserves world positions", () => {
    const a = primitive("cube", 1),
      b = primitive("cube", 1);
    const arr = new Float32Array(a.positions.length + b.positions.length);
    arr.set(a.positions);
    arr.set(
      b.positions.map((n, i) => (i % 3 === 0 ? n + 40 : n)),
      a.positions.length,
    );
    const m = { ...a, positions: arr };
    const parts = splitModel(m);
    expect(parts).toHaveLength(2);
    expect(
      parts
        .map((m) => boundsOf(m).getCenter(new THREE.Vector3()).x)
        .sort((a, b) => a - b),
    ).toEqual([0, 40]);
  });
  it("rejects invalid cuts", () =>
    expect(() => cutModel(primitive("cube", 1), 40, "both")).toThrow());
});
describe("G-code interpreter", () => {
  it("tracks absolute extrusion, resets, retractions, features, and distinct layers", () => {
    const r = parseGcode(
      "G90\nM82\nG92 E0\n;LAYER:0\nG1 X0 Y0 Z0.2 F1200\n;TYPE:wall\nG1 X20 E1\nG1 E0.5\nG1 E1\n;TYPE:infill\nG1 Y20 E2\n;LAYER:1\nG1 Z0.4\nG92 E0\n;TYPE:support\nG1 X0 E1",
    );
    expect(r.layers).toHaveLength(2);
    expect(r.filament).toBeCloseTo(3);
    expect(r.layers[0].features[0]).toBe(0);
    expect(r.layers[0].features[1]).toBe(1);
    expect(r.layers[1].features[0]).toBe(3);
    expect(r.weight).toBeGreaterThan(0);
  });
  it("handles relative axes and relative extrusion", () => {
    const r = parseGcode("G91\nM83\nG1 Z0.2\nG1 X10 E1 F600\nG1 Y10 E1");
    expect(r.filament).toBe(2);
    expect(Array.from(r.layers[0].segments).slice(-3)).toEqual([
      10,
      10,
      expect.closeTo(0.2),
    ]);
  });
  it("does not turn Z-hop travel into a new layer", () => {
    const r = parseGcode(
      "G1 Z0.2\nG1 X10 E1\nG1 Z0.6\nG1 X20\nG1 Z0.2\nG1 X30 E2",
    );
    expect(r.layers).toHaveLength(1);
  });
  it("includes purge filament without counting unretraction twice", () => {
    const r = parseGcode("G1 E10\nG1 E9\nG1 E10\nG1 Z0.2\nG1 X10 E11");
    expect(r.filament).toBe(11);
  });
});
describe("slicer settings", () => {
  it("maps all exposed settings to the actual engine options", () => {
    const p = processProfile({
      ...DEFAULT_SETTINGS,
      supports: "tree",
      infill: 37,
      adhesion: "brim",
      brimWidth: 6,
      flow: 0.95,
    });
    expect(p.sliceSupportType).toBe("auto");
    expect(p.sliceSupportTree).toBe(true);
    expect(p.sliceFillSparse).toBe(0.37);
    expect(p.firstLayerBrim).toBe(6);
    expect(p.outputBrimCount).toBe(0);
    expect(p.outputFillMult).toBe(0.95);
  });
  it("vase mode forces one wall and no top or infill", () => {
    const p = processProfile({ ...DEFAULT_SETTINGS, vase: true });
    expect(p.sliceFillType).toBe("vase");
    expect(p.sliceShells).toBe(1);
    expect(p.sliceTopLayers).toBe(0);
    expect(p.sliceFillSparse).toBe(0);
  });
  it("configures printer bounds, extrusion, and G-code templates", () => {
    const p = deviceProfile(printer);
    expect(p.bedWidth).toBe(220);
    expect(p.extrudeAbs).toBe(true);
    expect(p.gcodePre).toContain("G28");
    expect(p.gcodePost).toContain("M104 S0");
  });
  it("rejects corrupt project values before rendering", () => {
    const p = {
      version: 1,
      name: "test",
      models: [],
      printer,
      settings: { ...DEFAULT_SETTINGS, layerHeight: 0 },
      plates: [1],
      activePlate: 1,
    };
    expect(() => validateProject(p)).toThrow("Invalid layer height");
  });
});
