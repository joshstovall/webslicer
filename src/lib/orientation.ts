import { Euler, Quaternion, Vector3 } from "three";
import type { Model, Printer, Vec3 } from "../types";
import { placementRequest } from "./placement";
import type {
  OrientationCandidate,
  OrientationPriority,
  OrientationResult,
} from "./orientation-core";
export function applyOrientation(
  models: Model[],
  candidate: OrientationCandidate,
): Model[] {
  const q = new Quaternion(...candidate.quaternion);
  return models.map((model) => {
    const position = new Vector3(...model.position)
      .applyQuaternion(q)
      .add(new Vector3(...candidate.translation));
    const rotation = new Euler().setFromQuaternion(
      q
        .clone()
        .multiply(
          new Quaternion().setFromEuler(
            new Euler(
              ...(model.rotation.map((v) => (v * Math.PI) / 180) as Vec3),
            ),
          ),
        ),
    );
    return {
      ...model,
      position: position.toArray() as Vec3,
      rotation: [rotation.x, rotation.y, rotation.z].map(
        (v) => (v * 180) / Math.PI,
      ) as Vec3,
    };
  });
}
export function findOrientations(
  models: Model[],
  printer: Printer,
  options: { edge: number; angle: number; priority: OrientationPriority },
  signal: AbortSignal,
  onProgress: (value: number, stage: string) => void,
): Promise<OrientationResult> {
  const cancelled = () =>
    new DOMException("Orientation cancelled.", "AbortError");
  if (signal.aborted) return Promise.reject(cancelled());
  onProgress(0, "Loading orientation search");
  if (signal.aborted) return Promise.reject(cancelled());
  const visible = models.filter((m) => m.visible);
  if (
    !visible.length ||
    visible.length > 200 ||
    visible.reduce((n, m) => n + m.positions.length / 9, 0) > 500_000
  )
    return Promise.reject(
      new Error(
        "Orientation supports 1–200 visible parts and up to 500,000 triangles per selection.",
      ),
    );
  const parts = placementRequest(visible, printer, "arrange", {
    gap: 0,
    edge: options.edge,
    rotate: false,
  }).parts;
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./orientation-worker.ts", import.meta.url),
      { type: "module" },
    );
    let finished = false;
    const finish = (error?: Error, result?: OrientationResult) => {
      if (finished) return;
      finished = true;
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(cancelled());
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Orientation search timed out. Try fewer or simpler parts.",
          ),
        ),
      180000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (e) =>
      finish(
        new Error(e.message || "Could not load the orientation search. Retry."),
      );
    worker.onmessageerror = () =>
      finish(new Error("Orientation search returned an unreadable result."));
    worker.onmessage = (e) => {
      if (e.data.error) finish(new Error(e.data.error));
      else if (e.data.result) finish(undefined, e.data.result);
      else onProgress(e.data.progress, e.data.stage);
    };
    try {
      worker.postMessage(
        { parts, bed: printer.bed, ...options },
        parts.map((p) => p.vertices.buffer as ArrayBuffer),
      );
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
    if (signal.aborted) abort();
  });
}
