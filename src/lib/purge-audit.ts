import type { MultiMaterialSettings } from "../types";
import { purgeVolumeFor } from "./multimaterial";

/** Check planned, relative-E tower extrusion after material flow adjustments.
 * Run before vendor macros are expanded, so off-bed flushing isn't counted as tower priming.
 */
export function auditPurgeVolumes(
  gcode: string,
  diameter: number,
  multi: MultiMaterialSettings,
  exact = false,
) {
  if (!multi.purgeTower) return [];
  const area = Math.PI * (diameter / 2) ** 2;
  const changes: {
    from: number;
    to: number;
    required: number;
    deposited: number;
  }[] = [];
  let feature = "",
    pending: (typeof changes)[number] | undefined;
  let printing = false,
    changing = false,
    relative = false;
  const finish = () => {
    if (!pending) return;
    if (
      pending.deposited + 0.05 < pending.required ||
      (exact && pending.deposited > pending.required + 0.05)
    )
      throw new Error(
        `Purge tower delivered ${pending.deposited.toFixed(1)} of ${pending.required.toFixed(1)} mm³ before filament ${pending.to + 1}. No G-code was exported.`,
      );
    changes.push(pending);
    pending = undefined;
  };
  for (const raw of gcode.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === ";STRATUM_PRINT_BEGIN") printing = true;
    if (line === ";STRATUM_PRINT_END") {
      finish();
      break;
    }
    if (line === "M83") relative = true;
    if (line === "M82") relative = false;
    if (!printing) continue;
    const change = line.match(/^;STRATUM_TOOL_CHANGE:(\d+):(\d+)/);
    if (change) {
      finish();
      const from = Number(change[1]),
        to = Number(change[2]);
      pending = {
        from,
        to,
        required: purgeVolumeFor(multi, from, to),
        deposited: 0,
      };
      changing = true;
    }
    if (line === ";STRATUM_TOOL_READY") changing = false;
    if (line.startsWith(";TYPE:")) feature = line.slice(6).trim();
    if (!pending || changing) continue;
    const code = line.split(";")[0];
    const amount = Number(code.match(/\bE(-?[\d.]+)/)?.[1] ?? 0);
    if (/^G[01]\s/.test(code) && /\b[XY]-?[\d.]+/.test(code) && amount > 0) {
      if (!relative)
        throw new Error(
          "Purge verification requires relative extrusion in the generated print region.",
        );
      if (feature === "purge tower") pending.deposited += amount * area;
      else if (feature !== "purge tower structure") finish();
    }
  }
  finish();
  return changes;
}
