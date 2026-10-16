import type { Filament, Printer, Settings } from "../types";

export function validCoolingSettings(f: Filament, s: Settings): boolean {
  const ramp =
    f.fanRampLayers === undefined
      ? s.fanRampLayers === undefined
        ? 1
        : s.fanRampLayers
      : f.fanRampLayers;
  const seconds =
    f.minLayerTime === undefined ? s.minLayerTime : f.minLayerTime;
  const speed =
    f.minPrintSpeed === undefined
      ? s.minPrintSpeed === undefined
        ? 10
        : s.minPrintSpeed
      : f.minPrintSpeed;
  return (
    Number.isInteger(ramp) &&
    ramp >= 1 &&
    ramp <= 20 &&
    Number.isFinite(seconds) &&
    seconds >= 0 &&
    seconds <= 120 &&
    Number.isFinite(speed) &&
    speed >= 1 &&
    speed <= 100
  );
}
export function fanSpeedAtLayer(
  f: Filament,
  s: Settings,
  layer: number,
): number {
  const elapsed = layer - (f.fanLayer ?? s.fanLayer) + 1;
  const fraction = Math.min(
    1,
    Math.max(0, elapsed / (f.fanRampLayers ?? s.fanRampLayers ?? 1)),
  );
  return Math.round((f.fan * fraction * 255) / 100);
}
interface Move {
  feed: number;
  distance: number;
  floor: number;
  deposit: boolean;
  active: boolean;
}
interface Row {
  raw: string;
  move?: Move;
  resetFeed?: number;
  ready?: boolean;
}

/** Cool a complete planned layer after physical flow limiting, before machine
 * macros are expanded. Unknown macro/temperature-wait time is excluded. */
export function applyLayerCooling(
  gcode: string,
  printer: Printer,
  settings: Settings,
  filaments: Filament[],
) {
  const output: string[] = [],
    warnings = new Set<string>();
  let rows: Row[] = [],
    moves: Move[] = [],
    fixed = 0,
    target = 0;
  let tool = 0,
    layer = -1,
    printing = false,
    changing = false;
  let x = 0,
    y = 0,
    z = 0,
    zOffset = 0,
    absolute = true,
    relativeE = false,
    units = 1;
  let feed = settings.speed * 60,
    outputFeed = -1;
  const debts = new Map<number, number>();
  const setFeed = (line: string, value: number) =>
    /\bF\s*[+-]?(?:\d*\.)?\d+/i.test(line)
      ? line.replace(/\bF\s*[+-]?(?:\d*\.)?\d+/i, `F${value}`)
      : line.replace(/(;.*)?$/, ` F${value} $1`).trim();
  const speed = (move: Move, factor: number) =>
    move.deposit && factor !== 1
      ? Math.max(move.floor, Math.floor(move.feed * factor * 10) / 10)
      : move.feed;
  const duration = (factor: number) =>
    fixed +
    moves.reduce(
      (sum, move) => sum + (move.distance * 60) / speed(move, factor),
      0,
    );
  const finish = () => {
    let factor = 1;
    if (target > 0 && duration(1) < target) {
      if (duration(0) < target) factor = 0;
      else {
        let low = 0,
          high = 1;
        for (let i = 0; i < 24; i++) {
          const mid = (low + high) / 2;
          if (duration(mid) >= target) low = mid;
          else high = mid;
        }
        factor = low;
      }
    }
    for (const row of rows) {
      if (row.resetFeed !== undefined && outputFeed !== row.resetFeed) {
        output.push(`G1 F${row.resetFeed}`);
        outputFeed = row.resetFeed;
      }
      const move = row.move;
      if (move?.active) {
        const desired = speed(move, factor);
        output.push(
          desired !== outputFeed || desired !== move.feed
            ? setFeed(row.raw, desired)
            : row.raw,
        );
        outputFeed = desired;
      } else {
        output.push(row.raw);
        if (move) outputFeed = move.feed;
      }
      if (row.ready) outputFeed = -1;
    }
    const remaining = target - duration(factor);
    if (remaining > 0.001) {
      // Preserve existing retraction debt. Only recover the extra retraction
      // added here; the next original move still owns its original recovery.
      const lift = Math.min(2, printer.bed[2] - (z + zOffset));
      if (settings.vase || lift < 0.5 || !relativeE) {
        warnings.add(
          settings.vase
            ? "Some layers cannot reach their cooling time at the minimum speed without interrupting spiral vase extrusion. Reduce the cooling speed floor or layer-time target."
            : "Some layers cannot reach their cooling time at the minimum speed because a safe cooling lift is unavailable. Leave at least 0.5 mm of Z clearance and use relative extrusion.",
        );
      } else {
        const retract = Math.max(
          0,
          settings.retraction - (debts.get(tool) ?? 0),
        );
        const retractFeed = settings.retractSpeed * 60;
        if (
          ![retract, retractFeed, feed, z, lift].every(Number.isFinite) ||
          retractFeed <= 0 ||
          feed <= 0
        )
          throw new Error("Invalid motion settings for a cooling lift.");
        output.push(";STRATUM_COOLING_WAIT", "G90", "M83");
        if (retract > 1e-6)
          output.push(`G1 E-${retract.toFixed(5)} F${retractFeed}`);
        output.push(
          `G1 Z${(z + lift).toFixed(5)} F600`,
          `G4 P${Math.ceil(remaining * 1000)}`,
          `G1 Z${z.toFixed(5)} F600`,
        );
        if (retract > 1e-6)
          output.push(`G1 E${retract.toFixed(5)} F${retractFeed}`);
        if (!absolute) output.push("G91");
        output.push(`G1 F${feed}`, ";STRATUM_COOLING_RESUME");
        outputFeed = feed;
      }
    }
    rows = [];
    moves = [];
    fixed = target = 0;
  };
  for (const raw of gcode.split(/\r?\n/)) {
    if (
      (printing && !changing && /^;LAYER:/.test(raw)) ||
      raw === ";STRATUM_PRINT_END"
    ) {
      finish();
      if (/^;LAYER:/.test(raw)) layer++;
    }
    const row: Row = { raw };
    const initial = raw.match(/^;STRATUM_INITIAL_TOOL:(\d+)/);
    if (initial) tool = Number(initial[1]);
    if (raw === ";STRATUM_PRINT_BEGIN") printing = true;
    if (raw === ";STRATUM_PRINT_END") printing = false;
    const change = raw.match(/^;STRATUM_TOOL_CHANGE:\d+:(\d+)/);
    if (change) {
      row.resetFeed = feed;
      tool = Number(change[1]);
      changing = true;
    }
    if (raw === ";STRATUM_TOOL_READY") {
      changing = false;
      row.ready = true;
    }
    const code = raw.split(";")[0].trim();
    const cmd = code.match(/^([GMT]\d+)(?=\s|$)/i)?.[1].toUpperCase();
    const args: Record<string, number> = {};
    for (const match of code.matchAll(/\b([XYZEFPS])\s*([+-]?(?:\d*\.)?\d+)/gi))
      args[match[1].toUpperCase()] = Number(match[2]);
    const active = printing && !changing && layer >= 0;
    if (cmd === "G20") units = 25.4;
    if (cmd === "G21") units = 1;
    if (cmd === "G90") absolute = true;
    if (cmd === "G91") absolute = false;
    if (cmd === "M83") relativeE = true;
    if (cmd === "M82") relativeE = false;
    if (cmd === "G92") {
      x = args.X ?? x;
      y = args.Y ?? y;
      if (args.Z !== undefined) {
        zOffset += z - args.Z;
        z = args.Z;
      }
    }
    if (active && cmd === "G4") fixed += args.S ?? (args.P ?? 0) / 1000;
    if (active && (cmd === "G2" || cmd === "G3"))
      throw new Error(
        "Layer cooling requires linear planned paths. Arc imports are previewed separately.",
      );
    if (cmd === "G0" || cmd === "G1") {
      if (active && units !== 1)
        throw new Error("Planned layer paths require millimeters (G21).");
      const nx = absolute ? (args.X ?? x) : x + (args.X ?? 0);
      const ny = absolute ? (args.Y ?? y) : y + (args.Y ?? 0);
      const nz = absolute ? (args.Z ?? z) : z + (args.Z ?? 0);
      feed = args.F ?? feed;
      const distance = Math.hypot(nx - x, ny - y, nz - z);
      const e = relativeE ? (args.E ?? 0) : 0;
      if (active && ![nx, ny, nz, distance, e].every(Number.isFinite))
        throw new Error(
          "Layer cooling requires finite planned coordinates and extrusion.",
        );
      const debt = debts.get(tool) ?? 0;
      const deposit = active && e > debt + 1e-6 && distance > 1e-6;
      if (active && relativeE) debts.set(tool, Math.max(0, debt - e));
      if (active && (!Number.isFinite(feed) || feed <= 0))
        throw new Error("Layer cooling requires positive motion feed rates.");
      const f = filaments[tool];
      if (deposit) {
        if (!f || !validCoolingSettings(f, settings))
          throw new Error(
            `Filament ${tool + 1} has invalid layer cooling settings.`,
          );
        target = Math.max(target, f.minLayerTime ?? settings.minLayerTime);
      }
      row.move = {
        feed,
        distance: distance || Math.abs(e),
        active,
        deposit,
        floor: Math.min(
          feed,
          (f?.minPrintSpeed ?? settings.minPrintSpeed ?? 10) * 60,
        ),
      };
      if (active) moves.push(row.move);
      x = nx;
      y = ny;
      z = nz;
    }
    rows.push(row);
  }
  finish();
  return { gcode: output.join("\n"), warnings: [...warnings] };
}
