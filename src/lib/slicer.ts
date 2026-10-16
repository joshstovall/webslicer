import type {
  Model,
  Printer,
  Settings,
  SliceResult,
  Filament,
  MultiMaterialSettings,
} from "../types";
import { mergedVertices } from "./geometry";
import { processProfile, deviceProfile } from "./profiles";
import { compileMachineGcode } from "./machine-gcode";
import { applyFilamentSettings } from "./filament-gcode";
import { parseGcode } from "./gcode";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
  materialErrors,
  maximumPurgeVolume,
} from "./multimaterial";
export function slicePlate(
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
          const result = parseGcode(
            compileMachineGcode(
              applyFilamentSettings(gcode!, printer, settings, filaments),
              printer,
              settings,
              filaments,
              multi,
            ),
            {
              diameter: printer.filament,
              density: settings.density,
              cost: settings.cost,
              filaments,
            },
          );
          if (!result.layers.length)
            throw new Error("No printable layers were generated.");
          for (const layer of result.layers) {
            for (let i = 0; i < layer.features.length; i++) {
              if (layer.features[i] === 4) continue;
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
        const parts = models
          .filter((m) => m.visible)
          .map((m) => ({
            name: m.name,
            assemblyId: m.assemblyId,
            tool: m.tool ?? 0,
            vertices: mergedVertices([m]),
          }));
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
