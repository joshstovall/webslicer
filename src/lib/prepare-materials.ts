import type { Model } from "../types";
import { mergedVertices, matrixOf } from "./geometry";
import { Vector3 } from "three";
import {
  needsMaterialPreparation,
  type MaterialPart,
  type PreparedPart,
} from "./material-regions";
import type { MaterialEdit, EditedPart } from "./edit-material-regions";
export function worldMaterialParts(
  models: Model[],
  defaultDepth = 0.8,
  includeHidden = false,
): MaterialPart[] {
  return models
    .filter((m) => includeHidden || m.visible)
    .map((m) => {
      let paintVertices: Float32Array | undefined;
      if (m.paintTriangles) {
        paintVertices = m.paintTriangles.slice();
        const matrix = matrixOf(m),
          point = new Vector3();
        for (let i = 0; i < paintVertices.length; i += 3)
          point
            .fromArray(paintVertices, i)
            .applyMatrix4(matrix)
            .toArray(paintVertices, i);
      }
      return {
        name: m.name,
        visible: m.visible,
        assemblyId: m.assemblyId,
        tool: m.tool ?? 0,
        vertices: mergedVertices([m.visible ? m : { ...m, visible: true }]),
        paintVertices,
        faceTools: m.faceTools?.slice(),
        paintDepth: m.paintDepth ?? defaultDepth,
      };
    });
}
export async function prepareMaterials(
  models: Model[],
  depth: number,
  signal: AbortSignal,
  onProgress: (value: number, stage: string) => void,
): Promise<PreparedPart[]> {
  if (signal.aborted)
    throw new DOMException("Slicing cancelled.", "AbortError");
  const parts = worldMaterialParts(models, depth);
  if (!needsMaterialPreparation(parts)) return parts;
  return runMaterialWorker(parts, signal, onProgress);
}
export async function editMaterials(
  models: Model[],
  depth: number,
  operation: MaterialEdit,
  signal: AbortSignal,
  onProgress: (value: number, stage: string) => void,
): Promise<EditedPart[]> {
  return runMaterialWorker(
    worldMaterialParts(models, depth, true),
    signal,
    onProgress,
    operation,
  ) as Promise<EditedPart[]>;
}
async function runMaterialWorker(
  parts: MaterialPart[],
  signal: AbortSignal,
  onProgress: (value: number, stage: string) => void,
  operation?: MaterialEdit,
): Promise<PreparedPart[]> {
  onProgress(0, "Preparing material regions");
  if (signal.aborted)
    throw new DOMException("Slicing cancelled.", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./material-worker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
      clearTimeout(timer);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Slicing cancelled.", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Material preparation timed out. Reduce the mesh detail or painted surface detail.",
        ),
      );
    }, 300000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (e) => {
      cleanup();
      reject(new Error(e.message || "Material worker failed to load."));
    };
    worker.onmessage = (e) => {
      if (e.data.error) {
        cleanup();
        reject(new Error(e.data.error));
      } else if (e.data.parts) {
        cleanup();
        resolve(e.data.parts);
      } else
        onProgress(
          e.data.progress * (operation ? 1 : 0.15),
          operation ? "Editing material regions" : "Preparing material regions",
        );
    };
    worker.postMessage(
      operation ? { parts, operation } : parts,
      parts.flatMap((p) => [
        p.vertices.buffer,
        ...(p.paintVertices ? [p.paintVertices.buffer] : []),
        ...(p.faceTools ? [p.faceTools.buffer] : []),
      ]) as ArrayBuffer[],
    );
  });
}
