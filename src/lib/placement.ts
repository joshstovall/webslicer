import { Euler, Quaternion, Vector3 } from "three";
import type { Model, Printer, Vec3 } from "../types";
import { boundsOf, matrixOf } from "./geometry";
import { bedExclusions, rectanglesOverlap } from "./bed-exclusions";
import type {
  PlacementMove,
  PlacementRequest,
  PlacementResult,
} from "./placement-core";
export interface ArrangeOptions {
  gap: number;
  rotate: boolean;
  edge: number;
}
export function placementRequest(
  models: Model[],
  printer: Printer,
  mode: PlacementRequest["mode"],
  options: ArrangeOptions,
): PlacementRequest {
  return {
    mode,
    bed: printer.bed,
    exclusions: bedExclusions(printer),
    ...options,
    parts: models.map((m) => {
      const vertices = m.positions.slice(),
        matrix = matrixOf(m),
        point = new Vector3();
      for (let i = 0; i < vertices.length; i += 3)
        point.fromArray(vertices, i).applyMatrix4(matrix).toArray(vertices, i);
      // Mirror transforms reverse winding; restore outward orientation for solids.
      if (matrix.determinant() < 0)
        for (let i = 0; i < vertices.length; i += 9)
          for (let a = 0; a < 3; a++) {
            const v = vertices[i + 3 + a];
            vertices[i + 3 + a] = vertices[i + 6 + a];
            vertices[i + 6 + a] = v;
          }
      return {
        id: m.id,
        name: m.name,
        plate: m.plate,
        assemblyId: m.assemblyId,
        visible: m.visible,
        vertices,
      };
    }),
  };
}
export function applyPlacement(
  models: Model[],
  moves: PlacementMove[],
): Model[] {
  const map = new Map(moves.map((m) => [m.id, m]));
  return models.map((model) => {
    const move = map.get(model.id);
    if (!move) return model;
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      (move.angle * Math.PI) / 180,
    );
    const position = new Vector3(...model.position)
      .applyQuaternion(rotation)
      .add(new Vector3(...move.translation));
    const orientation = rotation.multiply(
      new Quaternion().setFromEuler(
        new Euler(...(model.rotation.map((v) => (v * Math.PI) / 180) as Vec3)),
      ),
    );
    const euler = new Euler().setFromQuaternion(orientation);
    return {
      ...model,
      position: position.toArray() as Vec3,
      rotation: [euler.x, euler.y, euler.z].map(
        (v) => (v * 180) / Math.PI,
      ) as Vec3,
    };
  });
}
export async function arrangePlate(
  models: Model[],
  printer: Printer,
  options: ArrangeOptions,
  signal: AbortSignal,
  onProgress: (value: number, stage: string) => void,
): Promise<Model[]> {
  if (signal.aborted)
    throw new DOMException("Placement cancelled.", "AbortError");
  const result = await runPlacementWorker(
    placementRequest(models, printer, "arrange", options),
    signal,
    onProgress,
  );
  return applyPlacement(models, result.moves);
}
export async function checkModelGeometry(
  models: Model[],
  printer: Printer,
  margin: number,
  signal: AbortSignal,
  onProgress: (value: number, stage: string) => void,
): Promise<void> {
  if (signal.aborted)
    throw new DOMException("Placement cancelled.", "AbortError");
  const active = models.filter((m) => m.visible),
    bounds = active.map(boundsOf),
    excluded = bedExclusions(printer);
  const needsCheck = active.some(
    (m, i) =>
      excluded.some((r) =>
        rectanglesOverlap(
          {
            minX: bounds[i].min.x,
            minY: bounds[i].min.y,
            maxX: bounds[i].max.x,
            maxY: bounds[i].max.y,
          },
          r,
          margin,
        ),
      ) ||
      active.some(
        (n, j) =>
          j > i &&
          m.plate === n.plate &&
          !(m.assemblyId && m.assemblyId === n.assemblyId) &&
          bounds[i].intersectsBox(bounds[j]),
      ),
  );
  if (!needsCheck) return;
  const result = await runPlacementWorker(
    placementRequest(active, printer, "validate", {
      gap: 0,
      edge: margin,
      rotate: false,
    }),
    signal,
    (value, stage) => onProgress(value * 0.05, stage),
  );
  if (result.errors.length) throw new Error(result.errors.join("\n"));
}
function runPlacementWorker(
  request: PlacementRequest,
  signal: AbortSignal,
  onProgress: (value: number, stage: string) => void,
): Promise<PlacementResult> {
  if (signal.aborted)
    return Promise.reject(
      new DOMException("Placement cancelled.", "AbortError"),
    );
  onProgress(
    0,
    request.mode === "arrange"
      ? "Loading outline arranger"
      : "Loading geometry checks",
  );
  if (signal.aborted)
    return Promise.reject(
      new DOMException("Placement cancelled.", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./placement-worker.ts", import.meta.url),
      { type: "module" },
    );
    let finished = false;
    const finish = (error?: Error, result?: PlacementResult) => {
      if (finished) return;
      finished = true;
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () =>
      finish(new DOMException("Placement cancelled.", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Geometry placement timed out. Try fewer or simpler parts.",
          ),
        ),
      180000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (e) =>
      finish(
        new Error(
          e.message ||
            "Could not load geometry placement. Retry the operation.",
        ),
      );
    worker.onmessageerror = () =>
      finish(new Error("Geometry placement returned an unreadable result."));
    worker.onmessage = (e) => {
      if (e.data.error) finish(new Error(e.data.error));
      else if (e.data.result) finish(undefined, e.data.result);
      else onProgress(e.data.progress, e.data.stage);
    };
    worker.postMessage(
      request,
      request.parts.map((p) => p.vertices.buffer as ArrayBuffer),
    );
  });
}
