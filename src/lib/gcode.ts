import type { Filament, SliceResult, ToolpathLayer } from "../types";
interface ParseOptions {
  diameter: number;
  density: number;
  cost: number;
  filaments?: Filament[];
}
// Tracks independent extrusion registers, retraction debt, and tool identity.
export function parseGcode(
  gcode: string,
  options: ParseOptions = { diameter: 1.75, density: 1.24, cost: 25 },
): SliceResult {
  let x = 0,
    y = 0,
    z = 0,
    e = 0,
    f = 1800,
    abs = true,
    absE = true,
    feature = 0,
    seconds = 0,
    tool = 0,
    toolChanges = 0;
  const registers = new Map<number, number>(),
    debts = new Map<number, number>(),
    amounts = new Map<number, number>();
  const layers: ToolpathLayer[] = [];
  let pendingLayer = false,
    currentZ = -Infinity;
  let segments: number[] = [],
    features: number[] = [],
    speeds: number[] = [],
    tools: number[] = [];
  const warnings: string[] = [];
  const hasLayerMarkers = /^;(?:LAYER:|; --- layer)/im.test(gcode);
  let inLayers = !hasLayerMarkers,
    machineChange = false;
  const flush = () => {
    if (segments.length) {
      layers.push({
        z: currentZ,
        segments: new Float32Array(segments),
        features: new Uint8Array(features),
        speeds: new Float32Array(speeds),
        tools: new Uint8Array(tools),
      });
      segments = [];
      features = [];
      speeds = [];
      tools = [];
    }
  };
  for (const raw of gcode.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^;(?:LAYER:|; --- layer)/i.test(line)) {
      pendingLayer = true;
      inLayers = true;
    }
    if (line === ";STRATUM_PRINT_END") inLayers = false;
    if (line === ";STRATUM_MACHINE_CHANGE_BEGIN") machineChange = true;
    if (line === ";STRATUM_MACHINE_CHANGE_END") machineChange = false;
    const type = line.match(/;(?:TYPE:| feature )(.+)/i)?.[1]?.toLowerCase();
    if (type)
      feature = /purge|prime tower/.test(type)
        ? 5
        : /support/.test(type)
          ? 3
          : /solid|skin|surface|bridge/.test(type)
            ? 2
            : /sparse|infill|fill/.test(type)
              ? 1
              : 0;
    const code = line.split(";")[0].trim();
    if (!code) continue;
    const rawCmd = code
      .match(/^(?:N\d+\s*)?([GMT]\d+(?:\.\d+)?)/i)?.[1]
      ?.toUpperCase();
    const cmd = rawCmd ? rawCmd[0] + Number(rawCmd.slice(1)) : undefined;
    const args: Record<string, number> = {};
    for (const m of code.matchAll(/([XYZEFSP])\s*(-?(?:\d*\.)?\d+)/gi))
      args[m[1].toUpperCase()] = Number(m[2]);
    if (cmd?.startsWith("T")) {
      const next = Number(cmd.slice(1));
      // Bambu T255/T1000 are unload/special commands, not filament slots.
      if (Number.isInteger(next) && next >= 0 && next < 64 && next !== tool) {
        registers.set(tool, e);
        e = registers.get(next) ?? 0;
        if (amounts.size) toolChanges++;
        tool = next;
      }
      continue;
    }
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
      const message =
        "Arc moves are not displayed by this linear G-code viewer.";
      if (!warnings.includes(message)) warnings.push(message);
      continue;
    }
    if (cmd !== "G0" && cmd !== "G1") continue;
    const nx = args.X === undefined ? x : abs ? args.X : x + args.X,
      ny = args.Y === undefined ? y : abs ? args.Y : y + args.Y,
      nz = args.Z === undefined ? z : abs ? args.Z : z + args.Z,
      ne = args.E === undefined ? e : absE ? args.E : e + args.E;
    f = args.F ?? f;
    const de = ne - e,
      dist = Math.hypot(nx - x, ny - y, nz - z),
      extruding = de > 1e-6 && Math.hypot(nx - x, ny - y) > 1e-6;
    const debt = debts.get(tool) ?? 0;
    if (de < 0) debts.set(tool, debt - de);
    else if (de > 0) {
      const deposited = Math.max(0, de - debt);
      debts.set(tool, Math.max(0, debt - de));
      if (deposited) amounts.set(tool, (amounts.get(tool) ?? 0) + deposited);
    }
    if (
      inLayers &&
      !machineChange &&
      extruding &&
      (pendingLayer ||
        !Number.isFinite(currentZ) ||
        (!hasLayerMarkers && nz > currentZ + 0.04))
    ) {
      flush();
      currentZ = nz;
      pendingLayer = false;
    }
    if (
      inLayers &&
      !machineChange &&
      dist > 1e-6 &&
      Number.isFinite(currentZ)
    ) {
      segments.push(x, y, z, nx, ny, nz);
      features.push(extruding ? feature : 4);
      speeds.push(f / 60);
      tools.push(tool);
    }
    seconds += (dist > 1e-6 ? dist : Math.abs(de)) / Math.max(f / 60, 0.1);
    x = nx;
    y = ny;
    z = nz;
    e = ne;
  }
  flush();
  const usage = [...amounts]
    .sort(([a], [b]) => a - b)
    .map(([tool, filament]) => {
      const material = options.filaments?.[tool];
      const weight =
        ((filament * Math.PI * (options.diameter / 2) ** 2) / 1000) *
        (material?.density ?? options.density);
      return {
        tool,
        color:
          material?.color ??
          ["#91ad87", "#86a5bd", "#d0866e", "#e1bd56"][tool % 4],
        name: material?.name ?? `Filament ${tool + 1}`,
        filament,
        weight,
        cost: (weight / 1000) * (material?.cost ?? options.cost),
      };
    });
  return {
    gcode,
    layers,
    filament: usage.reduce((n, t) => n + t.filament, 0),
    seconds,
    weight: usage.reduce((n, t) => n + t.weight, 0),
    cost: usage.reduce((n, t) => n + t.cost, 0),
    warnings,
    toolChanges,
    tools: usage,
  };
}
export function formatDuration(s: number) {
  const mins = Math.max(1, Math.ceil(s / 60));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
