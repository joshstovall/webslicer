import { expect, it } from "vitest";
import {
  placePurgeBlocks,
  planKiriPurgeBlocks,
} from "../public/engine/purge-planner.js";
import {
  validTowerPositions,
  DEFAULT_MULTI_MATERIAL,
  defaultFilament,
  materialErrors,
} from "../src/lib/multimaterial";
import { DEFAULT_SETTINGS, PRINTERS, deviceProfile } from "../src/lib/profiles";
import { validateProject } from "../src/lib/project";

const options = {
  width: 100,
  depth: 100,
  size: 12,
  count: 3,
  lineWidth: 0.42,
  obstacles: [],
};
it("anchors the first manual block exactly and extends along either positive axis", () => {
  for (const axis of ["x", "y"]) {
    const points = placePurgeBlocks({
      ...options,
      position: { x: -30, y: -20, axis },
    });
    expect(points).toHaveLength(3);
    points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(-30 + (axis === "x" ? i * 13.42 : 0));
      expect(p.y).toBeCloseTo(-20 + (axis === "y" ? i * 13.42 : 0));
    });
  }
});
it("rejects later blocks that exceed the bed and never silently changes manual placement", () => {
  expect(() =>
    placePurgeBlocks({ ...options, position: { x: 30, y: 0, axis: "x" } }),
  ).toThrow("Manual tower block 2");
  expect(
    placePurgeBlocks({ ...options, position: { x: 30, y: 0, axis: "y" } }),
  ).toHaveLength(3);
  expect(() =>
    placePurgeBlocks({
      ...options,
      obstacles: [{ minX: 0, maxX: 10, minY: -10, maxY: 10 }],
      position: { x: -10, y: 0, axis: "x" },
    }),
  ).toThrow("Manual tower block 2 overlaps");
  for (const position of [
    null,
    { x: NaN, y: 0, axis: "x" },
    { x: 0, y: 0, axis: "z" },
  ])
    expect(() => placePurgeBlocks({ ...options, position })).toThrow(
      "Invalid manual",
    );
});
it("converts U1 machine coordinates without losing its physical origin offsets", () => {
  const printer = PRINTERS.find((p) => p.id === "snapmaker-u1")!;
  const result = planKiriPurgeBlocks(
    [],
    {
      device: deviceProfile(printer),
      process: {
        outputPurgeTower: 100,
        sliceLineWidth: 0.42,
        stratumTowerPosition: { x: 30, y: 40, axis: "y" },
      },
    },
    3,
  )!;
  expect(result.positions[0]).toEqual({
    x: 30 - 135 - 0.5,
    y: 40 - 135 - 1,
    z: 0,
  });
});
it("rejects manual blocks in reserved Bambu regions, support bounds or adhesion clearance", () => {
  const printer = PRINTERS.find((p) => p.id === "bambu-p1s")!;
  const settings = {
    device: deviceProfile(printer),
    process: {
      outputPurgeTower: 100,
      sliceLineWidth: 0.42,
      stratumTowerPosition: { x: 10, y: 20, axis: "y" },
    },
  };
  expect(() => planKiriPurgeBlocks([], settings, 1)).toThrow(
    "reserved bed area",
  );
  const widgets = [
    {
      anno: { extruder: 0 },
      track: { pos: { x: 0, y: 0 } },
      bounds: { min: { x: -5, y: -5 }, max: { x: 5, y: 5 } },
      slices: [
        { supports: [{ bounds: { minx: -60, maxx: 5, miny: -5, maxy: 5 } }] },
      ],
    },
  ];
  expect(() =>
    planKiriPurgeBlocks(
      widgets,
      {
        ...settings,
        process: {
          ...settings.process,
          stratumTowerPosition: { x: 70, y: 128, axis: "y" },
        },
      },
      1,
    ),
  ).toThrow("overlaps");
  expect(() =>
    planKiriPurgeBlocks(
      [{ ...widgets[0], slices: [] }],
      {
        ...settings,
        process: {
          ...settings.process,
          firstLayerBrim: 8,
          stratumTowerPosition: { x: 148, y: 128, axis: "y" },
        },
      },
      1,
    ),
  ).toThrow("overlaps");
});
it("preserves per-plate positions in portable projects and rejects malformed or orphaned entries", () => {
  const positions = {
    "1": { x: 30, y: 40, axis: "x" },
    "2": { x: 45, y: 50, axis: "y" },
  };
  const file = {
    version: 1,
    name: "Manual towers",
    models: [],
    plates: [1, 2],
    activePlate: 1,
    printer: PRINTERS[0],
    settings: DEFAULT_SETTINGS,
    filaments: [defaultFilament(DEFAULT_SETTINGS)],
    multiMaterial: { ...DEFAULT_MULTI_MATERIAL, towerPositions: positions },
  };
  expect(validateProject(file).multiMaterial?.towerPositions).toEqual(
    positions,
  );
  for (const value of [
    null,
    [],
    { "0": positions[1] },
    { "1": { x: Infinity, y: 20, axis: "x" } },
    { "1": { x: "3", y: 20, axis: "x" } },
    { "1": { x: 3, y: 20, axis: "z" } },
    { "-1": positions[1] },
  ]) {
    expect(validTowerPositions(value)).toBe(false);
    expect(() =>
      validateProject({
        ...file,
        multiMaterial: { ...file.multiMaterial, towerPositions: value },
      }),
    ).toThrow("multi-material");
  }
  expect(() => validateProject({ ...file, plates: [1] })).toThrow(
    "multi-material",
  );
  expect(
    materialErrors([], PRINTERS[0], [], DEFAULT_SETTINGS, {
      ...DEFAULT_MULTI_MATERIAL,
      towerPositions: { "1": { x: NaN, y: 0, axis: "x" } },
    }).join(),
  ).toContain("Invalid manual tower");
});
