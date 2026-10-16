import type { Filament, Printer, Settings } from "../types";

/** Apply material settings only to the planned print region, preserving machine macros. */
export function applyFilamentSettings(
  gcode: string,
  printer: Printer,
  settings: Settings,
  filaments: Filament[],
): string {
  if (filaments.length < 2 && !printer.firmware) return gcode;
  let tool = 0,
    layer = -1,
    printing = false,
    changing = false;
  let x = 0,
    y = 0,
    feed = settings.speed * 60,
    outputFeed = feed;
  const area = Math.PI * (printer.filament / 2) ** 2;
  const lines: string[] = [];
  const temperature = () => {
    const f = filaments[tool];
    const target =
      printer.multiMaterialMode === "toolchanger" ? ` T${tool}` : "";
    return `M109 S${layer <= 0 ? f.firstNozzleTemp : f.nozzleTemp}${target}`;
  };
  const fan = () =>
    `M106 S${layer + 1 >= settings.fanLayer ? Math.round(filaments[tool].fan * 2.55) : 0}`;
  for (const raw of gcode.split(/\r?\n/)) {
    let line = raw;
    const initial = line.match(/^;STRATUM_INITIAL_TOOL:(\d+)/);
    if (initial) tool = Number(initial[1]);
    if (line === ";STRATUM_PRINT_BEGIN") printing = true;
    if (line === ";STRATUM_PRINT_END") printing = false;
    const change = line.match(/^;STRATUM_TOOL_CHANGE:\d+:(\d+)/);
    if (change) {
      tool = Number(change[1]);
      changing = true;
    }
    if (line === ";STRATUM_TOOL_READY") {
      changing = false;
      lines.push(line, "G90", "M83", temperature(), fan());
      continue;
    }
    if (/^;LAYER:/.test(line)) {
      layer++;
      lines.push(line, temperature(), fan());
      continue;
    }
    const code = line.split(";")[0].trim();
    // Engine temperature/fan updates are global; the markers above replace them
    // with the active filament's values. Never alter machine-specific sequences.
    if (printing && !changing && /^(?:M104|M109|M106)\s/.test(code)) continue;
    const args: Record<string, number> = {};
    for (const m of code.matchAll(/([XYEF])\s*(-?(?:\d*\.)?\d+)/gi))
      args[m[1].toUpperCase()] = Number(m[2]);
    if (/^G[01]\s/.test(code)) {
      const nx = args.X ?? x,
        ny = args.Y ?? y;
      feed = args.F ?? feed;
      const distance = Math.hypot(nx - x, ny - y);
      if (
        printing &&
        !changing &&
        args.E !== undefined &&
        args.E > 0 &&
        distance > 1e-6
      ) {
        const amount = (args.E * filaments[tool].flow) / settings.flow;
        line = line.replace(/\bE-?(?:\d*\.)?\d+/, `E${amount.toFixed(5)}`);
        const limitedFeed = Math.min(
          feed,
          (filaments[tool].maxFlow * 60 * distance) / (amount * area),
        );
        if (args.F !== undefined)
          line = line.replace(/\bF[\d.]+/, `F${limitedFeed.toFixed(1)}`);
        else if (Math.abs(outputFeed - limitedFeed) > 0.05)
          line = line
            .replace(/(;.*)?$/, ` F${limitedFeed.toFixed(1)} $1`)
            .trim();
        outputFeed = limitedFeed;
      } else if (args.F !== undefined) outputFeed = args.F;
      x = nx;
      y = ny;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
