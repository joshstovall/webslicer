import type { Model, Printer, Settings, SliceResult } from "../types";
import { mergedVertices } from "./geometry";
import { processProfile, deviceProfile } from "./profiles";
import { parseGcode } from "./gcode";
export function slicePlate(
  models: Model[],
  printer: Printer,
  settings: Settings,
  onProgress: (n: number, stage: string) => void,
  signal: AbortSignal,
): Promise<SliceResult> {
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
          const result = parseGcode(gcode!, {
            diameter: printer.filament,
            density: settings.density,
            cost: settings.cost,
          });
          if (!result.layers.length)
            throw new Error("No printable layers were generated.");
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
        const vertices = mergedVertices(models);
        iframe.contentWindow!.postMessage(
          {
            type: "slice",
            vertices,
            device: deviceProfile(printer),
            process: processProfile(settings),
          },
          location.origin,
          [vertices.buffer],
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
