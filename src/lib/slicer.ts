import { createU1Job } from "./u1-job";
import { printThumbnails } from "./print-package";
import type {
  Model,
  Printer,
  Settings,
  SliceResult,
  Filament,
  MultiMaterialSettings,
} from "../types";
import { prepareMaterials } from "./prepare-materials";
import { processProfile, deviceProfile } from "./profiles";
import { compileMachineGcode } from "./machine-gcode";
import { applyFilamentSettings } from "./filament-gcode";
import { parseGcode } from "./gcode";
import { auditPurgeVolumes } from "./purge-audit";
import { auditThermalCommands } from "./thermal-limits";
import { bedExclusions, segmentHitsRectangle } from "./bed-exclusions";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
  materialErrors,
  maximumPurgeVolume,
} from "./multimaterial";
export async function slicePlate(
  models: Model[],
  printer: Printer,
  settings: Settings,
  onProgress: (n: number, stage: string) => void,
  signal: AbortSignal,
  filaments: Filament[] = [defaultFilament(settings)],
  multi: MultiMaterialSettings = DEFAULT_MULTI_MATERIAL,
): Promise<SliceResult> {
  const errors = materialErrors(models, printer, filaments, settings, multi);
  if (errors.length) return Promise.reject(new Error(errors.join("\n")));
  const parts = await prepareMaterials(
    models,
    Math.max(settings.lineWidth * 2, settings.layerHeight * 3),
    signal,
    onProgress,
  );
  if (!parts.length) throw new Error("No printable material regions remain.");
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.title = "Local slicing engine";
    let finished = false;
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Slicing timed out after 10 minutes. Try a lower-resolution model.",
          ),
        ),
      600000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      iframe.remove();
    };
    const finish = (error?: Error, gcode?: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else {
        try {
          const planned = applyFilamentSettings(
            gcode!,
            printer,
            settings,
            filaments,
          );
          auditPurgeVolumes(planned, printer.filament, multi);
          const compiled = compileMachineGcode(
            planned,
            printer,
            settings,
            filaments,
            multi,
          );
          auditThermalCommands(compiled, printer);
          const result = parseGcode(compiled, {
            diameter: printer.filament,
            density: settings.density,
            cost: settings.cost,
            filaments,
          });
          if (!result.layers.length)
            throw new Error("No printable layers were generated.");
          const excluded = bedExclusions(printer, false);
          for (const layer of result.layers) {
            for (let i = 0; i < layer.features.length; i++) {
              if (layer.features[i] === 4) continue;
              const n = i * 6;
              if (
                excluded.some((r) =>
                  segmentHitsRectangle(
                    layer.segments[n],
                    layer.segments[n + 1],
                    layer.segments[n + 3],
                    layer.segments[n + 4],
                    r,
                    settings.lineWidth / 2,
                  ),
                )
              )
                throw new Error(
                  "Generated extrusion enters a reserved bed area. Move models and their adhesion away from the marked corner.",
                );
              for (const endpoint of [0, 3]) {
                const offset = i * 6 + endpoint;
                if (
                  layer.segments[offset] <
                    (printer.bedOrigin?.[0] ?? 0) - 0.1 ||
                  layer.segments[offset] >
                    printer.bed[0] + (printer.bedOrigin?.[0] ?? 0) + 0.1 ||
                  layer.segments[offset + 1] <
                    (printer.bedOrigin?.[1] ?? 0) - 0.1 ||
                  layer.segments[offset + 1] >
                    printer.bed[1] + (printer.bedOrigin?.[1] ?? 0) + 0.1 ||
                  layer.segments[offset + 2] > printer.bed[2] + 0.1
                ) {
                  throw new Error(
                    "Generated extrusion exceeds the build volume. Move the models inward to leave room for the purge tower and adhesion.",
                  );
                }
              }
            }
          }
          if (printer.firmware === "snapmaker-u1") {
            result.gcode = createU1Job(
              result,
              printer,
              settings,
              filaments,
              printThumbnails(result, printer, 300, 48),
            );
          }
          resolve(result);
        } catch (e) {
          reject(e);
        }
      }
    };
    const abort = () =>
      finish(new DOMException("Slicing cancelled", "AbortError"));
    const receive = (e: MessageEvent) => {
      if (
        e.origin !== location.origin ||
        e.source !== iframe.contentWindow ||
        !e.data?.stratumEngine
      )
        return;
      const msg = e.data;
      if (msg.type === "ready") {
        iframe.contentWindow!.postMessage(
          {
            type: "slice",
            parts,
            device: deviceProfile(printer, filaments),
            process: {
              ...processProfile(settings, {
                ...multi,
                purgeVolume: maximumPurgeVolume(multi, [
                  ...new Set([
                    ...parts.map((p) => p.tool),
                    ...(settings.supports === "disabled"
                      ? []
                      : [multi.supportTool]),
                  ]),
                ]),
                purgeVolumes: undefined,
                supportTool:
                  settings.supports === "disabled"
                    ? parts[0].tool
                    : multi.supportTool,
              }),
              outputMaxFlowrate: Math.max(...filaments.map((f) => f.maxFlow)),
              stratumPurgeVolume: multi.purgeVolume,
              stratumPurgeVolumes: multi.purgeVolumes,
              stratumFilamentFlows: filaments.map((f) => f.flow),
            },
          },
          location.origin,
          parts.map((part) => part.vertices.buffer),
        );
      } else if (msg.type === "progress")
        onProgress(
          Number.isFinite(msg.progress) ? msg.progress : 0.8,
          msg.stage,
        );
      else if (msg.type === "error") finish(new Error(msg.message));
      else if (msg.type === "complete") finish(undefined, msg.gcode);
    };
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    iframe.src = `${import.meta.env.BASE_URL}engine/bridge.html`;
    document.body.appendChild(iframe);
    if (signal.aborted) abort();
  });
}
