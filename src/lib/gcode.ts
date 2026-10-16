import type { SliceResult, ToolpathLayer } from "../types";
// Interprets absolute/relative axes and extrusion, resets, retractions, and feature markers.
export function parseGcode(
  gcode: string,
  options = { diameter: 1.75, density: 1.24, cost: 25 },
): SliceResult {
  let x = 0,
    y = 0,
    z = 0,
    e = 0,
    f = 1800,
    abs = true,
    absE = true,
    feature = 0,
    filament = 0,
    seconds = 0;
  const layers: ToolpathLayer[] = [];
  let pendingLayer = false;
  let currentZ = -Infinity;
  let segments: number[] = [],
    features: number[] = [],
    speeds: number[] = [];
  const warnings: string[] = [];
  const hasLayerMarkers = /^;(?:LAYER:|; --- layer)/im.test(gcode);
  const flush = () => {
    if (segments.length) {
      layers.push({
        z: currentZ,
        segments: new Float32Array(segments),
        features: new Uint8Array(features),
        speeds: new Float32Array(speeds),
      });
      segments = [];
      features = [];
      speeds = [];
    }
  };
  for (const raw of gcode.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^;(?:LAYER:|; --- layer)/i.test(line)) pendingLayer = true;
    const type = line.match(/;(?:TYPE:| feature )(.+)/i)?.[1]?.toLowerCase();
    if (type)
      feature = /support/.test(type)
        ? 3
        : /solid|skin|surface|bridge/.test(type)
          ? 2
          : /sparse|infill|fill/.test(type)
            ? 1
            : 0;
    const code = line.split(";")[0].trim();
    if (!code) continue;
    const rawCmd = code.match(/^(?:N\d+\s*)?([GMT]\d+)/i)?.[1]?.toUpperCase();
    const cmd = rawCmd ? rawCmd[0] + Number(rawCmd.slice(1)) : undefined;
    const args: Record<string, number> = {};
    for (const m of code.matchAll(/([XYZEFSP])\s*(-?(?:\d*\.)?\d+)/gi))
      args[m[1].toUpperCase()] = Number(m[2]);
    if (cmd === "G90") {
      abs = true;
      continue;
    }
    if (cmd === "G91") {
      abs = false;
      continue;
    }
    if (cmd === "M82") {
      absE = true;
      continue;
    }
    if (cmd === "M83") {
      absE = false;
      continue;
    }
    if (cmd === "G92") {
      x = args.X ?? x;
      y = args.Y ?? y;
      z = args.Z ?? z;
      e = args.E ?? e;
      continue;
    }
    if (cmd === "G4") {
      seconds += (args.S ?? 0) + (args.P ?? 0) / 1000;
      continue;
    }
    if (cmd === "G2" || cmd === "G3") {
      if (!warnings.length)
        warnings.push(
          "Arc moves are not displayed by this linear G-code viewer.",
        );
      continue;
    }
    if (cmd !== "G0" && cmd !== "G1") continue;
    const nx = args.X === undefined ? x : abs ? args.X : x + args.X,
      ny = args.Y === undefined ? y : abs ? args.Y : y + args.Y,
      nz = args.Z === undefined ? z : abs ? args.Z : z + args.Z;
    const ne = args.E === undefined ? e : absE ? args.E : e + args.E;
    f = args.F ?? f;
    const de = ne - e,
      dist = Math.hypot(nx - x, ny - y, nz - z),
      extruding = de > 1e-6 && Math.hypot(nx - x, ny - y) > 1e-6;
    if (extruding) {
      filament += de;
      if (
        pendingLayer ||
        !Number.isFinite(currentZ) ||
        (!hasLayerMarkers && nz > currentZ + 0.04)
      ) {
        flush();
        currentZ = nz;
        pendingLayer = false;
      }
    }
    if (dist > 1e-6 && Number.isFinite(currentZ)) {
      segments.push(x, y, z, nx, ny, nz);
      features.push(extruding ? feature : 4);
      speeds.push(f / 60);
      seconds += dist / Math.max(f / 60, 0.1);
    }
    x = nx;
    y = ny;
    z = nz;
    e = ne;
  }
  flush();
  const weight =
    ((filament * Math.PI * (options.diameter / 2) ** 2) / 1000) *
    options.density;
  return {
    gcode,
    layers,
    filament,
    seconds,
    weight,
    cost: (weight / 1000) * options.cost,
    warnings,
  };
}
export function formatDuration(s: number) {
  const mins = Math.max(1, Math.ceil(s / 60));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
