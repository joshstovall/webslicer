import { checkModelGeometry } from "./placement";
import { supportInterfaceErrors } from "./support-interface-settings";
import { treeSettingErrors } from "./tree-settings";
import {
  engineEntry,
  ENGINE_REVISION,
  ENGINE_STARTUP_TIMEOUT,
} from "./engine-runtime";
import { attachModifiers, modifierErrors } from "./modifiers";
import { attachSupportPaint, validateSupportPaint } from "./support-paint";
import { materialCompatibility } from "./material-compatibility";
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
import { applyLayerCooling } from "./cooling";
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
  for (const model of models) validateSupportPaint(model.supportPaint);
  const errors = [
    ...materialErrors(models, printer, filaments, settings, multi),
    ...modifierErrors(models, settings),
    ...supportInterfaceErrors(settings),
    ...(settings.supports.startsWith("tree")
      ? treeSettingErrors(settings)
      : []),
  ];
  if (
    models.some(
      (m) => m.visible && m.supportPaint?.states.some((v) => v === 1),
    ) &&
    settings.supports === "disabled"
  )
    errors.push(
      "Enable Automatic or Enforced only supports to use painted enforcers.",
    );
  if (
    settings.vase &&
    models.some((m) => m.visible && m.supportPaint?.states.some((v) => v !== 0))
  )
    errors.push("Clear support paint before using spiral vase mode.");
  if (new Set(models.map((m) => m.plate)).size > 1)
    errors.push("Slice one build plate at a time.");
  if (errors.length) return Promise.reject(new Error(errors.join("\n")));
  const adhesionMargin =
    settings.adhesion === "brim"
      ? settings.brimWidth
      : settings.adhesion === "skirt"
        ? settings.skirtDistance + settings.skirtLoops * settings.lineWidth
        : 0;
  await checkModelGeometry(models, printer, adhesionMargin, signal, onProgress);
  const prepared = await prepareMaterials(
    models,
    Math.max(settings.lineWidth * 2, settings.layerHeight * 3),
    signal,
    onProgress,
  );
  const parts = attachSupportPaint(models, attachModifiers(models, prepared));
  if (!parts.length) throw new Error("No printable material regions remain.");
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.title = "Local slicing engine";
    let finished = false;
    let started = false;
    const startupTimer = setTimeout(
      () =>
        finish(
          new Error(
            "Could not load this app's slicing engine. Check your connection, then reload the app and try again.",
          ),
        ),
      ENGINE_STARTUP_TIMEOUT,
    );
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
      clearTimeout(startupTimer);
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
          auditPurgeVolumes(planned, printer.filament, multi, true);
          const cooled = applyLayerCooling(
            planned,
            printer,
            settings,
            filaments,
          );
          const compiled = compileMachineGcode(
            cooled.gcode,
            printer,
            settings,
            filaments,
            multi,
          );
          auditThermalCommands(compiled, printer);
          const result = parseGcode(compiled, {
            arcConvention:
              printer.firmware === "snapmaker-u1" ? "klipper" : "marlin",
            diameter: printer.filament,
            density: settings.density,
            cost: settings.cost,
            filaments,
          });
          result.warnings.push(
            ...cooled.warnings,
            ...materialCompatibility(
              models,
              printer,
              filaments,
              settings,
              multi,
            ).warnings,
          );
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
        if (started) return;
        if (msg.revision !== ENGINE_REVISION) {
          finish(
            new Error(
              "The app and slicing engine versions do not match. Reload the app and try again.",
            ),
          );
          return;
        }
        started = true;
        clearTimeout(startupTimer);
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
              stratumExactPurge: true,
              stratumBridgeCooling: true,
              stratumAlignedLayers: true,
              stratumPurgeVolumes: multi.purgeVolumes,
              stratumFilamentFlows: filaments.map((f) => f.flow),
              stratumTowerPosition:
                multi.towerPositions?.[String(models[0].plate)],
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
    iframe.src = engineEntry(import.meta.env.BASE_URL);
    document.body.appendChild(iframe);
    if (signal.aborted) abort();
  });
}
