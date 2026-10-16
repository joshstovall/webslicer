import type { ModelImport } from "./import-3mf";
import type { StepOptions } from "./step-mesh";
export interface StepImportOptions extends StepOptions {
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
}
export async function importStep(
  file: File,
  plate: number,
  options: StepImportOptions = { quality: "balanced", colors: true },
): Promise<ModelImport> {
  const cancelled = () =>
    new DOMException("STEP import cancelled.", "AbortError");
  if (options.signal?.aborted) throw cancelled();
  if (file.size > 100 * 1024 * 1024)
    throw new Error("Please use a STEP file smaller than 100 MB.");
  options.onStage?.("Reading STEP file");
  const bytes = await file.arrayBuffer();
  if (options.signal?.aborted) throw cancelled();
  options.onStage?.("Loading CAD converter");
  if (options.signal?.aborted) throw cancelled();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./step-worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "STEP conversion timed out. Choose Draft quality or export a smaller assembly.",
        ),
      );
    }, 180000);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      cleanup();
      reject(
        new Error(
          event.message || "CAD converter failed to load. Retry the import.",
        ),
      );
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(new Error("CAD converter returned an unreadable result."));
    };
    worker.onmessage = (
      event: MessageEvent<{
        stage?: string;
        error?: string;
        imported?: ModelImport;
      }>,
    ) => {
      if (event.data.error) {
        cleanup();
        reject(new Error(event.data.error));
      } else if (event.data.imported) {
        cleanup();
        resolve(event.data.imported);
      } else if (event.data.stage) options.onStage?.(event.data.stage);
    };
    worker.postMessage(
      {
        bytes,
        name: file.name.replace(/\.[^.]+$/, ""),
        plate,
        options: { quality: options.quality, colors: options.colors },
      },
      [bytes],
    );
  });
}
