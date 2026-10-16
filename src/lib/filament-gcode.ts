import { auxiliaryFanIndex, auxiliarySpeedAtLayer } from "./fan-control";
import type { Filament, Printer, Settings } from "../types";
import { fanSpeedAtLayer } from "./cooling";

/** Apply spool settings to planned paths; leave startup, shutdown and change macros intact. */
export function applyFilamentSettings(
  gcode: string,
  printer: Printer,
  settings: Settings,
  filaments: Filament[],
): string {
  let tool = 0,
    layer = -1,
    printing = false,
    changing = false,
    bridge = false;
  let x = 0,
    y = 0,
    z = 0,
    absoluteXYZ = true,
    relativeE = false;
  let feed = settings.speed * 60,
    outputFeed = feed;
  let lastTemperature = "",
    lastFan = "",
    lastAuxiliary = "";
  const auxiliary = auxiliaryFanIndex(printer);
  const used = new Set<number>([
    Number(gcode.match(/^;STRATUM_INITIAL_TOOL:(\d+)/m)?.[1] ?? 0),
  ]);
  for (const m of gcode.matchAll(/^;STRATUM_TOOL_CHANGE:\d+:(\d+)/gm))
    used.add(Number(m[1]));
  const manageAuxiliary =
    auxiliary !== undefined &&
    [...used].some((t) => filaments[t]?.auxiliaryFan !== undefined);
  const area = Math.PI * (printer.filament / 2) ** 2;
  const lines: string[] = [];
  const materialCommands = (force = false) => {
    const f = filaments[tool];
    if (!f) throw new Error(`Filament ${tool + 1} is not configured.`);
    const target =
      printer.multiMaterialMode === "toolchanger" ? ` T${tool}` : "";
    const temperature = `M109 S${layer <= 0 ? f.firstNozzleTemp : f.nozzleTemp}${target}`;
    // Bambu P1 is the part fan. U1 binds its unindexed fan to the active head.
    const fanIndex = printer.firmware === "bambu" ? " P1" : "";
    const partSpeed =
      bridge &&
      f.bridgeFan !== undefined &&
      layer + 1 >= (f.fanLayer ?? settings.fanLayer)
        ? Math.round((f.bridgeFan * 255) / 100)
        : fanSpeedAtLayer(f, settings, layer + 1);
    const fan = `M106${fanIndex} S${partSpeed}`;
    if (force || lastTemperature !== temperature) lines.push(temperature);
    if (force || lastFan !== fan) lines.push(fan);
    lastTemperature = temperature;
    lastFan = fan;
    if (manageAuxiliary) {
      const command = `M106 P${auxiliary} S${auxiliarySpeedAtLayer(f, settings, layer + 1)}`;
      if (force || lastAuxiliary !== command) lines.push(command);
      lastAuxiliary = command;
    }
  };
  for (const raw of gcode.split(/\r?\n/)) {
    let line = raw;
    const initial = line.match(/^;STRATUM_INITIAL_TOOL:(\d+)/);
    if (initial) tool = Number(initial[1]);
    if (line === ";STRATUM_PRINT_BEGIN") printing = true;
    if (line === ";STRATUM_PRINT_END") {
      printing = false;
      lines.push(line);
      if (manageAuxiliary) lines.push(`;STRATUM_AUX_SHUTDOWN:${auxiliary}`);
      continue;
    }
    const change = line.match(/^;STRATUM_TOOL_CHANGE:\d+:(\d+)/);
    if (change) {
      tool = Number(change[1]);
      changing = true;
    }
    if (line === ";STRATUM_TOOL_READY") {
      changing = false;
      bridge = false;
      absoluteXYZ = relativeE = true;
      lines.push(line, "G90", "M83");
      materialCommands(true);
      // A custom change sequence may alter modal feed. Explicitly set it next move.
      outputFeed = -1;
      continue;
    }
    if (printing && !changing && /^;LAYER:/.test(line)) {
      layer++;
      bridge = false;
      lines.push(line);
      materialCommands();
      continue;
    }
    const bridgeMarker = line.match(/^;STRATUM_BRIDGE:([01])$/);
    if (printing && !changing && bridgeMarker) {
      bridge = bridgeMarker[1] === "1";
      lines.push(line);
      materialCommands();
      continue;
    }
    const code = line.split(";")[0].trim();
    const command = code
      .match(/^([GMT]\d+(?:\.\d+)?)(?=\s|$)/i)?.[1]
      .toUpperCase();
    const args: Record<string, number> = {};
    for (const m of code.matchAll(/\b([XYZEFPS])\s*(-?(?:\d*\.)?\d+)/gi))
      args[m[1].toUpperCase()] = Number(m[2]);
    const active = printing && !changing;
    // Engine updates are global; material markers replace only the primary fan.
    // An enabled auxiliary override owns its configured index; chamber fans and
    // unconfigured auxiliary fans retain their explicit machine commands.
    if (
      active &&
      (command === "M104" ||
        command === "M109" ||
        ((command === "M106" || command === "M107") &&
          (args.P === undefined ||
            (printer.firmware === "bambu" && args.P === 1) ||
            (manageAuxiliary && args.P === auxiliary))))
    )
      continue;
    if (command === "G90") absoluteXYZ = true;
    if (command === "G91") absoluteXYZ = false;
    if (command === "M83") relativeE = true;
    if (command === "M82") relativeE = false;
    if (command === "G92") {
      x = args.X ?? x;
      y = args.Y ?? y;
      z = args.Z ?? z;
    }
    if (command === "G0" || command === "G1") {
      const nx = absoluteXYZ ? (args.X ?? x) : x + (args.X ?? 0);
      const ny = absoluteXYZ ? (args.Y ?? y) : y + (args.Y ?? 0);
      const nz = absoluteXYZ ? (args.Z ?? z) : z + (args.Z ?? 0);
      feed = args.F ?? feed;
      const distance = Math.hypot(nx - x, ny - y, nz - z);
      let desiredFeed = feed;
      if (active && args.E !== undefined && args.E > 0 && distance > 1e-6) {
        if (!relativeE)
          throw new Error(
            "Planned filament paths require relative extrusion (M83).",
          );
        const amount = Number(
          ((args.E * filaments[tool].flow) / settings.flow).toFixed(5),
        );
        line = line.replace(/\bE\s*-?(?:\d*\.)?\d+/i, `E${amount.toFixed(5)}`);
        if (amount > 0)
          desiredFeed = Math.min(
            feed,
            (filaments[tool].maxFlow * 60 * distance) / (amount * area),
          );
        desiredFeed = Math.floor(desiredFeed * 10) / 10;
        if (desiredFeed <= 0)
          throw new Error(
            "Filament flow limit produces a non-positive print speed.",
          );
      }
      // Restore the requested modal feed on travel/retraction too, after a limited extrusion.
      if (
        active &&
        (args.F !== undefined || Math.abs(outputFeed - desiredFeed) > 0.0001)
      ) {
        if (args.F !== undefined)
          line = line.replace(/\bF\s*-?(?:\d*\.)?\d+/i, `F${desiredFeed}`);
        else line = line.replace(/(;.*)?$/, ` F${desiredFeed} $1`).trim();
        outputFeed = desiredFeed;
      } else if (args.F !== undefined) outputFeed = args.F;
      x = nx;
      y = ny;
      z = nz;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
