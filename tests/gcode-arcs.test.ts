import { describe, expect, it } from "vitest";
import { arcPath, type Point3 } from "../src/lib/gcode-arcs";
import { parseGcode } from "../src/lib/gcode";

const path = (
  start: Point3,
  end: Point3,
  args: Record<string, number>,
  cw = false,
) => arcPath(start, end, args, cw, 17, false, "marlin");
const points = (result: ReturnType<typeof parseGcode>) =>
  result.layers.flatMap((l) => [...l.segments]);

describe("imported arc geometry", () => {
  it("follows clockwise and counterclockwise quarter arcs, not their chord", () => {
    const ccw = path([10, 0, 0.2], [0, 10, 0.2], { I: -10 });
    const cw = path([0, 10, 0.2], [10, 0, 0.2], { J: -10 }, true);
    for (const arc of [ccw, cw]) {
      expect(arc.length).toBeCloseTo(5 * Math.PI, 10);
      expect(arc.pointAt(0.5)).toEqual([
        expect.closeTo(Math.sqrt(50)),
        expect.closeTo(Math.sqrt(50)),
        0.2,
      ]);
      expect(arc.coarse).toBe(false);
      for (let i = 0; i < arc.steps; i++) {
        const a = arc.pointAt(i / arc.steps),
          b = arc.pointAt((i + 1) / arc.steps);
        expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(1);
        expect(
          10 - Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
        ).toBeLessThanOrEqual(0.02);
      }
    }
  });
  it("resolves signed-radius minor and major arcs in both directions", () => {
    for (const cw of [true, false]) {
      const end: Point3 = [0, cw ? -10 : 10, 0];
      const minor = path([10, 0, 0], end, { R: 10 }, cw);
      const major = path([10, 0, 0], end, { R: -10 }, cw);
      expect(minor.length).toBeCloseTo(5 * Math.PI, 10);
      expect(major.length).toBeCloseTo(15 * Math.PI, 10);
      expect(minor.pointAt(0.5)).toEqual([
        expect.closeTo(Math.sqrt(50)),
        expect.closeTo((cw ? -1 : 1) * Math.sqrt(50)),
        0,
      ]);
      expect(major.pointAt(1)).toEqual(end);
    }
  });
  it("renders full circles and helices with analytic distance and precise endpoints", () => {
    const arc = path([10, 0, 1], [10, 0, 9], { I: -10 }, true);
    expect(arc.length).toBeCloseTo(Math.hypot(20 * Math.PI, 8), 10);
    expect(arc.pointAt(0.25)).toEqual([
      expect.closeTo(0),
      expect.closeTo(-10),
      3,
    ]);
    expect(arc.pointAt(1)).toEqual([10, 0, 9]);
    const r = parseGcode("G92 X10 Y0 Z0.2 E0\nM83\nG2 I-10 E2 F600");
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].features.every((f) => f === 0)).toBe(true);
    expect(r.filament).toBe(2);
    expect(r.seconds).toBeCloseTo(2 * Math.PI, 10);
  });
  it("uses the correct handedness in each firmware's vertical planes", () => {
    const marlin = arcPath(
      [10, 0, 0],
      [0, 0, 10],
      { I: -10 },
      true,
      18,
      false,
      "marlin",
    );
    const klipper = arcPath(
      [10, 0, 0],
      [0, 0, 10],
      { I: -10 },
      false,
      18,
      false,
      "klipper",
    );
    for (const a of [marlin, klipper]) {
      expect(a.length).toBeCloseTo(5 * Math.PI, 10);
      expect(a.pointAt(0.5)).toEqual([
        expect.closeTo(Math.sqrt(50)),
        0,
        expect.closeTo(Math.sqrt(50)),
      ]);
    }
    const yz = arcPath(
      [2, 10, 0],
      [4, 0, 10],
      { J: -10 },
      false,
      19,
      false,
      "marlin",
    );
    expect(yz.pointAt(0.5)).toEqual([
      3,
      expect.closeTo(Math.sqrt(50)),
      expect.closeTo(Math.sqrt(50)),
    ]);
  });
  it("bounds tessellation for large radii without changing distance", () => {
    const a = path([1e6, 0, 0], [1e6, 0, 0], { I: -1e6 });
    expect(a.steps).toBe(4096);
    expect(a.coarse).toBe(true);
    expect(a.length).toBeCloseTo(2e6 * Math.PI);
  });
});

describe("arc parser state and material accounting", () => {
  it("retains sparse tools, absolute E registers, retraction debt, and modal feed after arcs", () => {
    const code = `G90\nM82\nG92 X10 Y0 Z0.2 E0\n; CHANGE_LAYER\n; FEATURE: Outer wall\nT1\nG3 X0 Y10 I-10 E5 F600\nG1 E4\nG2 X10 Y0 J-10 E7\nT3\nG3 X0 Y10 I-10 E2\nT1\nG1 X-10 E8`;
    const r = parseGcode(code);
    expect(r.warnings).toEqual([]);
    expect(r.layers).toHaveLength(1);
    expect(r.tools.map((t) => [t.tool, t.filament])).toEqual([
      [1, 8],
      [3, 2],
    ]);
    expect(r.toolChanges).toBe(2);
    expect(new Set(r.layers[0].tools)).toEqual(new Set([1, 3]));
    expect(r.layers[0].features).toContain(4); // Recovery portion of the second arc.
    expect(r.layers[0].speeds.every((v) => v === 10)).toBe(true);
    expect(points(r).slice(-6)).toEqual([
      0,
      10,
      expect.closeTo(0.2),
      -10,
      10,
      expect.closeTo(0.2),
    ]);
    expect(r.seconds).toBeCloseTo((15 * Math.PI + 1 + 10) / 10, 10);
    expect(r.gcode).toBe(code);
  });
  it("normalizes inch units, relative endpoints, absolute centers, plus signs and comments", () => {
    const r = parseGcode(
      "G20\nG90\nM83\nG92 X1 Y0 Z0 E0\nG91\nG90.1\nN2 G03 X-1 Y+1 I0 J0 E.1 F60 (E999) *42\nG21\nG91.1\nG1 X10 E1",
    );
    expect(r.filament).toBeCloseTo(3.54);
    expect(r.seconds).toBeCloseTo(Math.PI / 2 + 10 / 25.4);
    expect(points(r).slice(-3)).toEqual([10, expect.closeTo(25.4), 0]);
    expect(r.warnings).toEqual([]);
  });
  it("recognizes external layer/feature markers and excludes startup and machine change geometry", () => {
    for (const marker of [
      "; CHANGE_LAYER",
      ";LAYER_CHANGE",
      ";LAYER:0",
      ";; --- layer 1",
    ]) {
      const r = parseGcode(
        `M83\nG92 X10 Y0 Z0.2\nG2 I-10 E10\n${marker}\n; FEATURE: Sparse infill\nG2 I-10 E2\n;STRATUM_MACHINE_CHANGE_BEGIN\nG1 X500 E5\nG1 X10\n;STRATUM_MACHINE_CHANGE_END\n${marker}\nG1 Z0.4\n;TYPE:Wipe tower\nG3 I-10 E3\n;STRATUM_PRINT_END\nG1 X600 E2`,
      );
      expect(r.layers).toHaveLength(2);
      expect(r.filament).toBe(22);
      expect(r.layers[0].features).toContain(1);
      expect(r.layers[1].features.every((f) => f === 5)).toBe(true);
      expect(Math.max(...points(r))).toBeLessThanOrEqual(10.001);
    }
  });
  it("reports malformed arcs, retains endpoint/feed/E, and never draws invented chords", () => {
    const r = parseGcode(
      "M82\nG92 X10 Z0.2 E0\nG2 X0 Y10 R2 E3 F600\nG1 X20 E4\nG3 X30 Y10 I5 R5 E5\nG1 X40 E6",
    );
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain("radius cannot reach");
    expect(r.warnings[1]).toContain("mixes R");
    expect(r.filament).toBe(6);
    expect(r.seconds).toBe(3);
    expect(r.layers[0].segments.length).toBe(12);
    expect(points(r).slice(0, 3)).toEqual([0, 10, expect.closeTo(0.2)]);
    expect(points(r).slice(-6)).toEqual([
      30,
      10,
      expect.closeTo(0.2),
      40,
      10,
      expect.closeTo(0.2),
    ]);
  });
  it("keeps fully retracted arc motion as travel and separates partial recovery", () => {
    const r = parseGcode(
      "M83\nG92 X10 Z0.2\nG2 I-10 E1\nG1 E-2\nG2 I-10 E1\nG2 I-10 E2",
    );
    expect(r.filament).toBe(2);
    const layer = r.layers[0];
    let deposited = 0,
      travel = 0;
    for (let i = 0; i < layer.features.length; i++) {
      const s = layer.segments.slice(i * 6, i * 6 + 6);
      const d = Math.hypot(s[3] - s[0], s[4] - s[1], s[5] - s[2]);
      if (layer.features[i] === 4) travel += d;
      else deposited += d;
    }
    expect(deposited).toBeCloseTo(travel, 5);
  });
  it("warns on ambiguous multi-turn, missing centers, and inconsistent radii", () => {
    for (const command of ["G3 X20 E1", "G3 X20 I-10 E1", "G3 I-10 P3 E1"]) {
      const r = parseGcode(`G92 X10\n${command}`);
      expect(r.layers).toHaveLength(0);
      expect(r.warnings[0]).toMatch(/Arc omitted:/);
      expect(r.filament).toBe(1);
    }
  });
});

it("bounds imported preview geometry without truncating usage, time, or generated-job audits", () => {
  const code = "M83\nG92 X10 Z0.2\nG2 I-10 E2 F600\nG2 I-10 E3";
  const capped = parseGcode(code, {
    diameter: 1.75,
    density: 1.24,
    cost: 25,
    previewSegmentLimit: 20,
  });
  expect(capped.layers[0].features.length).toBe(20);
  expect(capped.warnings).toHaveLength(1);
  expect(capped.warnings[0]).toContain("Preview reached 20 segments");
  expect(capped.filament).toBe(5);
  expect(capped.seconds).toBeCloseTo(4 * Math.PI, 10);
  expect(capped.gcode).toBe(code);
  const complete = parseGcode(code);
  expect(complete.layers[0].features.length).toBeGreaterThan(120);
  expect(complete.warnings).toEqual([]);
});

it("passes the U1 plane convention through the modal parser", () => {
  const r = parseGcode(
    "G92 X10 Y0 Z0\nG18\nM83\nG3 X0 Z10 I-10 E2 F600\nG17\nG3 X-10 Y0 I-5 E1",
    {
      diameter: 1.75,
      density: 1.24,
      cost: 25,
      arcConvention: "klipper",
    },
  );
  expect(r.seconds).toBeCloseTo(Math.PI, 10);
  expect(r.warnings).toEqual([]);
  expect(r.filament).toBe(3);
  expect(points(r).slice(-3)).toEqual([-10, 0, 10]);
});

it("uses a valid slow feed rate without silently shortening arc duration", () => {
  const r = parseGcode("M83\nG92 X10 Z0.2\nG2 I-10 E2 F3\nG1 X20 E1");
  expect(r.seconds).toBeCloseTo((20 * Math.PI + 10) / 0.05, 8);
});
