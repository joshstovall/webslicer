import { applyLayerCooling } from "../src/lib/cooling";
import { parseGcode } from "../src/lib/gcode";
import { expect, it } from "vitest";
import {
  unsupportedLength,
  annotateBridges,
} from "../public/engine/bridge-cooling.js";
import { applyFilamentSettings } from "../src/lib/filament-gcode";
import { validCoolingSettings } from "../src/lib/cooling";
import { auxiliaryFanIndex, finalizeFanShutdown } from "../src/lib/fan-control";
import {
  materialErrors,
  defaultFilament,
  DEFAULT_MULTI_MATERIAL as multi,
} from "../src/lib/multimaterial";
import { DEFAULT_SETTINGS as s, PRINTERS } from "../src/lib/profiles";
import { primitive } from "../src/lib/geometry";
import { validateProject } from "../src/lib/project";
const p = PRINTERS.find((p) => p.id === "bambu-p1s")!;
const u = PRINTERS.find((p) => p.id === "snapmaker-u1")!;
const f = {
  ...defaultFilament(s),
  fan: 40,
  fanLayer: 2,
  fanRampLayers: 2,
  bridgeFan: 90,
  auxiliaryFan: 60,
  auxiliaryFanLayer: 3,
  auxiliaryFanRampLayers: 2,
};
const wrap = (code: string) =>
  `;STRATUM_INITIAL_TOOL:0\nG90\nM83\n;STRATUM_PRINT_BEGIN\n${code}\n;STRATUM_PRINT_END`;
const rect = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  inner: any[] = [],
) => ({
  minX,
  minY,
  maxX,
  maxY,
  points: [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ],
  inner,
});
it("computes unsupported spans across overlapping materials, holes and collinear edges", () => {
  const a = { x: 0, y: 0 },
    b = { x: 10, y: 0 };
  expect(
    unsupportedLength(a, b, [rect(0, -2, 4, 2), rect(6, -2, 10, 2)]),
  ).toBeCloseTo(2);
  expect(unsupportedLength(a, b, [rect(0, -2, 7, 2), rect(5, -2, 10, 2)])).toBe(
    0,
  );
  expect(
    unsupportedLength(a, b, [rect(0, -2, 10, 2, [rect(4, -1, 6, 1)])]),
  ).toBeCloseTo(2);
  expect(unsupportedLength(a, b, [rect(0, 0, 10, 2)])).toBe(0);
  expect(unsupportedLength(a, b, [])).toBe(10);
});
it("labels only unsupported solid-fill deposition while preserving output geometry and modal types", () => {
  const points = [
    { point: { x: 0, y: 0 }, type: "solid fill", emit: 0 },
    { point: { x: 10, y: 0 }, emit: 1 },
    { point: { x: 0, y: 0 }, type: "shells", emit: 1 },
    { point: { x: 10, y: 0 }, type: "purge tower", emit: 1 },
  ];
  const layer = Object.assign(points, { z: 0.4, height: 0.2 });
  const source = (poly: any, top = 0.2) => ({
    offset: { x: 0, y: 0, z: 0 },
    slices: [{ z: top - 0.1, height: 0.2, tops: [{ poly }] }],
  });
  annotateBridges(
    [layer],
    [source(rect(0, -1, 4, 1)), source(rect(6, -1, 10, 1))],
    0.4,
  );
  expect(points.map((p: any) => p.stratumBridge)).toEqual([
    false,
    true,
    false,
    false,
  ]);
  annotateBridges(
    [layer],
    [source(rect(0, -1, 4, 1)), source(rect(4, -1, 10, 1))],
    0.4,
  );
  expect(points.map((p: any) => p.stratumBridge)).toEqual([
    false,
    false,
    false,
    false,
  ]);
  annotateBridges([layer], [source(rect(0, -1, 10, 1), 0.1)], 0.4);
  expect((points[1] as any).stratumBridge).toBe(true);
  layer.z = 0.2;
  annotateBridges([layer], [], 0.4);
  expect((points[1] as any).stratumBridge).toBe(false);
});
it("accounts for widget offsets, small supported gaps and polygon holes", () => {
  const layer = Object.assign(
    [
      { point: { x: 20, y: 10 }, type: "solid fill", emit: 0 },
      { point: { x: 30, y: 10 }, emit: 1 },
    ],
    { z: 1.4, height: 0.2 },
  );
  annotateBridges(
    [layer],
    [
      {
        offset: { x: 20, y: 10, z: 1 },
        slices: [{ z: 0.1, height: 0.2, tops: [{ poly: rect(0, -2, 10, 2) }] }],
      },
    ],
    0.4,
  );
  expect((layer[1] as any).stratumBridge).toBe(false);
});
it("applies bridge overrides after fan start, restores ramp speed, and independently ramps auxiliary cooling", () => {
  const code = applyFilamentSettings(
    wrap(
      ";LAYER:0\n;STRATUM_BRIDGE:1\nG1 X1 E1 F600\n;LAYER:1\n;STRATUM_BRIDGE:1\nG1 X2 E1\n;STRATUM_BRIDGE:0\nG1 X3 E1\n;LAYER:2\n;LAYER:3",
    ),
    p,
    s,
    [f],
  );
  expect(code).toContain(
    ";LAYER:0\nM109 S215\nM106 P1 S0\nM106 P2 S0\n;STRATUM_BRIDGE:1\nG1",
  );
  expect(code).toContain(";STRATUM_BRIDGE:1\nM106 P1 S230");
  expect(code).toContain(";STRATUM_BRIDGE:0\nM106 P1 S51");
  expect(code).toContain("M106 P2 S77");
  expect(code).toContain("M106 P2 S153");
  expect(finalizeFanShutdown(code)).toContain("M106 P2 S0\n;STRATUM_PRINT_END");
});
it("restores per-spool fans after U1 switches and prevents auxiliary leakage to unconfigured spools", () => {
  const a = {
    ...f,
    fanLayer: 1,
    fanRampLayers: 1,
    auxiliaryFanLayer: 1,
    auxiliaryFanRampLayers: 1,
  };
  const b = { ...defaultFilament(s), fanLayer: 1, fan: 20, bridgeFan: 80 };
  const code = applyFilamentSettings(
    wrap(
      ";LAYER:0\n;STRATUM_BRIDGE:1\n;STRATUM_TOOL_CHANGE:0:1\nM106 P2 S200\nT1\n;STRATUM_TOOL_READY\n;STRATUM_BRIDGE:1\nG1 X1 E1 F600\n;STRATUM_BRIDGE:0\nM106 P3 S90\n;STRATUM_TOOL_CHANGE:1:0\nT0\n;STRATUM_TOOL_READY",
    ),
    u,
    s,
    [a, b],
  );
  expect(code).toContain("M106 S51\nM106 P2 S0\n;STRATUM_BRIDGE:1\nM106 S204");
  expect(code).toContain(";STRATUM_BRIDGE:0\nM106 S51\nM106 P3 S90");
  expect(code).toContain("M106 S102\nM106 P2 S153");
  expect(code).not.toContain("M106 P1");
});
it("leaves auxiliary commands untouched unless an active spool opts in", () => {
  const code = applyFilamentSettings(
    wrap(";LAYER:0\nM106 P2 S123\nM106 P3 S66"),
    p,
    s,
    [defaultFilament(s), f],
  );
  expect(code).toContain("M106 P2 S123\nM106 P3 S66\n;STRATUM_PRINT_END");
});
it("validates fan overrides and rejects unsupported auxiliary hardware before slicing", () => {
  for (const patch of [
    { bridgeFan: 101 },
    { auxiliaryFan: NaN },
    { auxiliaryFan: null },
    { auxiliaryFanLayer: 0 },
    { auxiliaryFanRampLayers: 1.5 },
  ])
    expect(validCoolingSettings({ ...f, ...patch } as typeof f, s)).toBe(false);
  const a1 = PRINTERS.find((p) => p.id === "bambu-a1")!;
  expect(
    materialErrors([primitive("cube", 1)], a1, [f], s, multi).join(" "),
  ).toMatch(/no configured auxiliary fan/);
  expect(auxiliaryFanIndex({ ...p, id: "bambu-p1p" })).toBeUndefined();
  expect(
    auxiliaryFanIndex({
      ...p,
      id: "bambu-p1p",
      hardware: { auxiliaryFan: true },
    }),
  ).toBe(2);
  const project = {
    version: 1,
    name: "Fans",
    plates: [1],
    activePlate: 1,
    models: [],
    printer: p,
    settings: s,
    filaments: [f],
  };
  expect(validateProject(project).filaments![0]).toMatchObject(f);
  expect(() =>
    validateProject({ ...project, filaments: [{ ...f, bridgeFan: null }] }),
  ).toThrow(/cooling/);
});

it("keeps auxiliary cooling on during the final layer wait and then shuts it off", () => {
  const s2 = { ...s, minLayerTime: 10 };
  const planned = applyFilamentSettings(
    wrap(";LAYER:0\nG1 X1 Z0.2 E0.1 F600"),
    p,
    s2,
    [
      {
        ...f,
        auxiliaryFanLayer: 1,
        auxiliaryFanRampLayers: 1,
        minLayerTime: 10,
      },
    ],
  );
  const code = finalizeFanShutdown(
    applyLayerCooling(planned, p, s2, [{ ...f, minLayerTime: 10 }]).gcode,
  );
  expect(code.indexOf("M106 P2 S153")).toBeLessThan(
    code.indexOf(";STRATUM_COOLING_WAIT"),
  );
  expect(code.indexOf(";STRATUM_COOLING_RESUME")).toBeLessThan(
    code.indexOf("M106 P2 S0"),
  );
  expect(code).not.toContain("STRATUM_AUX_SHUTDOWN");
});
it("shows bridge deposition separately in preview without recoloring travel or later walls", () => {
  const r = parseGcode(
    wrap(
      ";LAYER:0\n;TYPE:solid fill\nG1 X1 Z0.2 E1 F600\n;STRATUM_BRIDGE:1\nG1 X2 E1\nG1 X3\n;STRATUM_BRIDGE:0\n;TYPE:shells\nG1 X4 E1",
    ),
  );
  expect([...r.layers[0].features]).toEqual([2, 6, 4, 0]);
});
it("uses actual first-layer height and previously printed overlapping slice elevations", () => {
  const layer = Object.assign(
    [
      { point: { x: 0, y: 0 }, emit: 0, type: "solid fill" },
      { point: { x: 10, y: 0 }, emit: 1 },
    ],
    { z: 0.24, height: 0.2, slice: { height: 0.24 } },
  );
  annotateBridges([layer], [], 0.4);
  expect((layer[1] as any).stratumBridge).toBe(false);
  layer.z = 2.2;
  layer.slice.height = 0.2;
  annotateBridges(
    [layer],
    [
      {
        offset: { x: 0, y: 0, z: 0 },
        slices: [
          { z: 1.94, height: 0.2, tops: [{ poly: rect(0, -1, 10, 1) }] },
        ],
      },
    ],
    0.4,
  );
  expect((layer[1] as any).stratumBridge).toBe(false);
});
