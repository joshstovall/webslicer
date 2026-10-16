import { it, expect } from "vitest";
import { planPurgePaths } from "../public/engine/purge-planner.js";
import {
  DEFAULT_MULTI_MATERIAL,
  independentPurgeBudgets,
  flushVolumeFor,
  purgeVolumeFor,
  materialErrors,
} from "../src/lib/multimaterial";
import { auditPurgeVolumes } from "../src/lib/purge-audit";
import { validateProject } from "../src/lib/project";
import { DEFAULT_SETTINGS, PRINTERS } from "../src/lib/profiles";
import { defaultFilament } from "../src/lib/multimaterial";
import { compileMachineGcode } from "../src/lib/machine-gcode";

const options = {
  bounds: { minx: -15, miny: -15, maxx: 15, maxy: 15 },
  z: 0.4,
  volume: 20,
  first: false,
  layer: 1,
  lineWidth: 0.42,
  height: 0.2,
  flow: 1,
};
const length = (path: { points: number[][] }) =>
  path.points
    .slice(1)
    .reduce(
      (sum, p, i) =>
        sum + Math.hypot(...p.map((v, j) => v - path.points[i][j])),
      0,
    );
const volume = (
  paths: ReturnType<typeof planPurgePaths>,
  kind: string,
  section = (Math.PI * 0.42 * 0.2) / 4,
) =>
  paths
    .filter((p) => p.kind === kind)
    .reduce((v, p) => v + length(p) * section, 0);

it("meters asymmetric priming volumes without making sparse structural paths dense", () => {
  const small = planPurgePaths(options),
    large = planPurgePaths({ ...options, volume: 40 }),
    empty = planPurgePaths({ ...options, volume: 0 });
  expect(volume(small, "prime")).toBeCloseTo(20.02, 8);
  expect(volume(large, "prime")).toBeCloseTo(40.02, 8);
  expect(volume(empty, "prime")).toBe(0);
  expect(volume(small, "structure")).toBeCloseTo(volume(large, "structure"), 8);
  expect(volume(empty, "structure")).toBeGreaterThan(5);
  for (const path of small)
    for (const p of path.points) {
      expect(p[0]).toBeGreaterThanOrEqual(-15);
      expect(p[0]).toBeLessThanOrEqual(15);
      expect(p[1]).toBeGreaterThanOrEqual(-15);
      expect(p[1]).toBeLessThanOrEqual(15);
      expect(p[2]).toBe(0.4);
    }
});
it("retains a full first-layer foundation regardless of transition volume", () => {
  const a = planPurgePaths({ ...options, first: true }),
    b = planPurgePaths({ ...options, first: true, volume: 40 }),
    empty = planPurgePaths({ ...options, first: true, volume: 0 });
  const total = (paths: ReturnType<typeof planPurgePaths>) =>
    volume(paths, "prime") + volume(paths, "structure");
  expect(total(a)).toBeCloseTo(total(b), 8);
  expect(total(a)).toBeCloseTo(total(empty), 8);
  expect(total(a)).toBeGreaterThan(50);
});
it("accounts for calibrated flow and thin layers and rejects insufficient capacity", () => {
  const thin = { ...options, height: 0.08, flow: 0.5, volume: 8 };
  expect(
    volume(planPurgePaths(thin), "prime", (Math.PI * 0.42 * 0.08 * 0.5) / 4),
  ).toBeCloseTo(8.02, 8);
  expect(() => planPurgePaths({ ...thin, volume: 200 })).toThrow(
    "cannot deliver",
  );
  for (const flow of [NaN, 0, -1])
    expect(() => planPurgePaths({ ...options, flow })).toThrow();
});
it("alternates structural rows across layers without duplicate dense or sparse tracks", () => {
  for (const layer of [0, 1]) {
    const paths = planPurgePaths({ ...options, layer });
    const rows = paths.slice(1);
    const planarAxis = layer % 2 ? 1 : 0,
      fixedAxis = layer % 2 ? 0 : 1;
    expect(
      rows.every((p) => p.points[0][fixedAxis] === p.points[1][fixedAxis]),
    ).toBe(true);
    const ranges = new Map<number, number[][]>();
    for (const path of rows) {
      const key = path.points[0][fixedAxis];
      const range = path.points.map((p) => p[planarAxis]).sort((a, b) => a - b);
      const same = ranges.get(key) ?? [];
      for (const other of same)
        expect(
          Math.min(range[1], other[1]) - Math.max(range[0], other[0]),
        ).toBeLessThanOrEqual(1e-8);
      same.push(range);
      ranges.set(key, same);
    }
  }
});
it("keeps legacy station budgets independent after migration, including directional values", () => {
  const legacy = {
    ...DEFAULT_MULTI_MATERIAL,
    purgeVolume: 80,
    purgeVolumes: { "0:1": 120, "1:0": 30 },
  };
  const moved = independentPurgeBudgets(legacy);
  const changed = { ...moved, purgeVolume: 10, purgeVolumes: { "0:1": 15 } };
  expect(flushVolumeFor(changed, 0, 1)).toBe(120);
  expect(flushVolumeFor(changed, 1, 0)).toBe(30);
  expect(purgeVolumeFor(changed, 0, 1)).toBe(15);
  expect(flushVolumeFor({ ...changed, flushVolumes: { "0:1": 0 } }, 0, 1)).toBe(
    0,
  );
  expect(flushVolumeFor({ ...changed, flushVolumes: {} }, 0, 1)).toBe(80);
  const file = {
    version: 1,
    name: "Legacy",
    plates: [1],
    activePlate: 1,
    models: [],
    printer: PRINTERS[0],
    settings: DEFAULT_SETTINGS,
    multiMaterial: legacy,
  };
  const restored = validateProject(file);
  expect(restored.multiMaterial).toEqual(moved);
  for (const invalid of [null, NaN, -1, 2001])
    expect(() =>
      validateProject({
        ...file,
        multiMaterial: { ...legacy, flushVolume: invalid },
      }),
    ).toThrow("multi-material");
  expect(() =>
    validateProject({
      ...file,
      multiMaterial: { ...legacy, flushVolumes: { "0:1": 2001 } },
    }),
  ).toThrow("multi-material");
});
it("compiles Bambu station volume independently of the exact tower budget", () => {
  const p = {
    ...PRINTERS.find((p) => p.id === "bambu-p1s")!,
    startGcode: "G90\nM83",
    endGcode: "M104 S0",
    toolChangeGcode: "; station budget {flush_length}\nT{next_extruder}",
  };
  const multi = {
    ...DEFAULT_MULTI_MATERIAL,
    purgeVolume: 12,
    purgeVolumes: { "0:1": 25 },
    flushVolume: 100,
    flushVolumes: { "0:1": 240 },
  };
  const code = compileMachineGcode(
    ";STRATUM_INITIAL_TOOL:0\n;STRATUM_PRINT_BEGIN\n;LAYER:0\nG1 X30 Y30 Z.2 E1\n;STRATUM_TOOL_CHANGE:0:1\nT1\n;STRATUM_TOOL_READY\nG1 X40 E1\n;STRATUM_PRINT_END",
    p,
    DEFAULT_SETTINGS,
    [0, 1].map((i) => defaultFilament(DEFAULT_SETTINGS, i)),
    multi,
  );
  const mm = Number(code.match(/; station budget ([\d.]+)/)?.[1]);
  expect(mm * Math.PI * (1.75 / 2) ** 2).toBeCloseTo(240, 2);
  expect(purgeVolumeFor(multi, 0, 1)).toBe(25);
  expect(
    materialErrors([], p, [], DEFAULT_SETTINGS, {
      ...multi,
      flushVolume: NaN,
    }).join(),
  ).toContain("Station flushing");
});
it("audits prime volume separately from structure and rejects excess as well as missing priming", () => {
  const area = Math.PI * (1.75 / 2) ** 2;
  const code = (prime: number) =>
    `M83\n;STRATUM_PRINT_BEGIN\n;STRATUM_TOOL_CHANGE:0:1\n;STRATUM_TOOL_READY\n;TYPE:purge tower structure\nG1 X1 E100\n;TYPE:purge tower\nG1 X2 E${prime / area}\n;TYPE:purge tower structure\nG1 X3 E100\n;TYPE:outer wall\nG1 X4 E1\n;STRATUM_PRINT_END`;
  const multi = { ...DEFAULT_MULTI_MATERIAL, purgeVolume: 20 };
  expect(
    auditPurgeVolumes(code(20.02), 1.75, multi, true)[0].deposited,
  ).toBeCloseTo(20.02);
  expect(() => auditPurgeVolumes(code(0), 1.75, multi, true)).toThrow(
    "0.0 of 20.0",
  );
  expect(() => auditPurgeVolumes(code(21), 1.75, multi, true)).toThrow(
    "21.0 of 20.0",
  );
});

it("keeps foundation row spacing within the deposited line width", () => {
  const paths = planPurgePaths({ ...options, first: true, layer: 0 });
  const rows = [...new Set(paths.slice(1).map((p) => p.points[0][1]))].sort(
    (a, b) => a - b,
  );
  for (let i = 1; i < rows.length; i++)
    expect(rows[i] - rows[i - 1]).toBeLessThanOrEqual(
      options.lineWidth + 1e-10,
    );
});
