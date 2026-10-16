import { expect, it } from "vitest";
import {
  placePurgeBlocks,
  planKiriPurgeBlocks,
} from "../public/engine/purge-planner.js";
import { auditPurgeVolumes } from "../src/lib/purge-audit";
import { DEFAULT_MULTI_MATERIAL } from "../src/lib/multimaterial";

it("places separated blocks in an interior gap when every outer side is occupied", () => {
  const obstacles = [
    { minX: -50, maxX: -25, minY: -50, maxY: 50 },
    { minX: 25, maxX: 50, minY: -50, maxY: 50 },
    { minX: -25, maxX: 25, minY: -50, maxY: -25 },
    { minX: -25, maxX: 25, minY: 25, maxY: 50 },
  ];
  const blocks = placePurgeBlocks({
    width: 100,
    depth: 100,
    size: 12,
    count: 9,
    lineWidth: 0.42,
    obstacles,
  });
  expect(blocks).toHaveLength(9);
  for (const b of blocks) {
    expect(Math.abs(b.x) + 6.21).toBeLessThan(25);
    expect(Math.abs(b.y) + 6.21).toBeLessThan(25);
    for (const other of blocks)
      if (b !== other)
        expect(
          Math.abs(b.x - other.x) >= 13.42 - 1e-7 ||
            Math.abs(b.y - other.y) >= 13.42 - 1e-7,
        ).toBe(true);
  }
});
it("fails explicitly on a full bed and respects disabled or single-material towers", () => {
  const options = {
    width: 60,
    depth: 60,
    size: 12,
    count: 1,
    lineWidth: 0.42,
    obstacles: [{ minX: -30, maxX: 30, minY: -30, maxY: 30 }],
  };
  expect(() => placePurgeBlocks(options)).toThrow("No room");
  expect(placePurgeBlocks({ ...options, count: 0 })).toEqual([]);
  expect(placePurgeBlocks({ ...options, size: 0 })).toEqual([]);
});
it("includes sliced support extents and adhesion, and scales capacity for thin layers and low flow", () => {
  const widgets = [0, 2].map((tool) => ({
    anno: { extruder: tool },
    track: { pos: { x: 0, y: 0 } },
    bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
    slices: [
      {
        height: 0.1,
        supports: [{ bounds: { minx: -50, maxx: 50, miny: -50, maxy: 5 } }],
      },
    ],
  }));
  const settings = {
    device: {
      bedWidth: 100,
      bedDepth: 100,
      extruders: [0, 1, 2].map(() => ({ extNozzle: 0.4 })),
    },
    process: {
      outputPurgeTower: 100,
      sliceLineWidth: 0.42,
      firstSliceHeight: 0.24,
      sliceHeight: 0.2,
      sliceSupportNozzle: 2,
      stratumPurgeVolume: 20,
      stratumPurgeVolumes: { "0:1": 2000, "0:2": 30 },
      stratumFilamentFlows: [1, 1, 0.5],
      firstLayerBrim: 3,
      firstLayerBrimGap: 0.1,
    },
  };
  const plan = planKiriPurgeBlocks(widgets, settings, 1)!;
  expect(plan.positions[0].y - plan.size / 2).toBeGreaterThan(15);
  expect(plan.size).toBeGreaterThan(25);
  expect(plan.size).toBeLessThan(35); // unused tool 1's 2000 mm³ override is excluded
  const higher = planKiriPurgeBlocks(
    widgets.map((w) => ({
      ...w,
      slices: w.slices.map((s) => ({ ...s, height: 0.2 })),
    })),
    settings,
    1,
  )!;
  expect(higher.size).toBeLessThan(plan.size);
});
it("checks directional physical extrusion without counting E-only recovery or change macros", () => {
  const area = Math.PI * (1.75 / 2) ** 2;
  const gcode = (amount: number) => `M83
;STRATUM_PRINT_BEGIN
;STRATUM_TOOL_CHANGE:0:2
;TYPE:purge tower
G1 X0 Y0 E100
;STRATUM_TOOL_READY
G1 E10
G1 X1 Y0 E${amount / area}
;TYPE:outer wall
G1 X2 Y0 E1
;STRATUM_PRINT_END`;
  const multi = { ...DEFAULT_MULTI_MATERIAL, purgeVolumes: { "0:2": 30 } };
  expect(auditPurgeVolumes(gcode(30), 1.75, multi)[0].deposited).toBeCloseTo(
    30,
  );
  expect(() => auditPurgeVolumes(gcode(29), 1.75, multi)).toThrow(
    "29.0 of 30.0",
  );
  expect(() => auditPurgeVolumes(gcode(0), 1.75, multi)).toThrow("0.0 of 30.0");
  expect(
    auditPurgeVolumes(gcode(0), 1.75, { ...multi, purgeTower: false }),
  ).toEqual([]);
});

it("reserves the pinned Bambu corner during placement, validation and assembly arrangement", async () => {
  const { PRINTERS, DEFAULT_SETTINGS, deviceProfile } = await import(
    "../src/lib/profiles"
  );
  const { primitive, validatePlate, arrangeModels } = await import(
    "../src/lib/geometry"
  );
  const { bedExclusions, segmentHitsRectangle } = await import(
    "../src/lib/bed-exclusions"
  );
  const p = PRINTERS.find((p) => p.id === "bambu-p1s")!;
  expect(bedExclusions(p, false)).toEqual([
    { minX: 0, minY: 0, maxX: 18, maxY: 28 },
  ]);
  expect(bedExclusions(PRINTERS.find((p) => p.id === "bambu-a1")!)).toEqual([]);
  const m = {
    ...primitive("cube", 1),
    position: [-120, -120, 0] as [number, number, number],
    scale: [0.2, 0.2, 0.1] as [number, number, number],
  };
  expect(validatePlate([m], p).join()).toContain("reserved bed area");
  const large = {
    ...primitive("cube", 1),
    scale: [12, 10, 0.1] as [number, number, number],
  };
  const arranged = arrangeModels([large], p, 8);
  expect(validatePlate(arranged, p, 8)).toEqual([]);
  const widget = {
    anno: { extruder: 0 },
    track: { pos: { x: 0, y: 0 } },
    bounds: { min: { x: -5, y: -5 }, max: { x: 5, y: 5 } },
    slices: [{ height: 0.2 }],
  };
  const plan = planKiriPurgeBlocks(
    [widget],
    {
      device: deviceProfile(p),
      process: {
        outputPurgeTower: 100,
        sliceLineWidth: 0.42,
        sliceSupportNozzle: 0,
      },
    },
    1,
  )!;
  const minX = plan.positions[0].x + 128 - plan.size / 2;
  const minY = plan.positions[0].y + 128 - plan.size / 2;
  expect(minX > 18 || minY > 28).toBe(true);
  const r = bedExclusions(p, false)[0];
  // Crossing segments must be caught even when both endpoints are outside.
  expect(segmentHitsRectangle(-5, 10, 25, 10, r)).toBe(true);
  expect(segmentHitsRectangle(19, 5, 19, 25, r, 0.21)).toBe(false);
  expect(segmentHitsRectangle(18.1, 5, 18.1, 25, r, 0.21)).toBe(true);
});

it("reserves transition capacity for a raft tool even when no model supports are generated", () => {
  const widgets = [
    {
      anno: { extruder: 1 },
      track: { pos: { x: 0, y: 0 } },
      bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
      slices: [{ height: 0.2, supports: [] }],
    },
  ];
  const settings = {
    device: {
      bedWidth: 256,
      bedDepth: 256,
      extruders: [0, 1, 2].map(() => ({ extNozzle: 0.4 })),
    },
    process: {
      outputRaft: true,
      outputPurgeTower: 100,
      sliceLineWidth: 0.42,
      firstSliceHeight: 0.2,
      sliceHeight: 0.2,
      sliceSupportNozzle: 2,
      stratumPurgeVolume: 1,
      stratumPurgeVolumes: { "2:1": 50 },
      stratumFilamentFlows: [1, 1, 0.5],
    },
  };
  const plan = planKiriPurgeBlocks(widgets, settings, 1)!;
  expect(plan.positions).toHaveLength(1);
  expect(plan.size).toBeGreaterThan(25);
  expect(Number.isFinite(plan.size)).toBe(true);
});
