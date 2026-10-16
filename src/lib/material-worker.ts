import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { prepareMaterialRegions, type MaterialPart } from "./material-regions";
import {
  editMaterialRegions,
  type MaterialEdit,
} from "./edit-material-regions";
self.onmessage = async (
  event: MessageEvent<
    MaterialPart[] | { parts: MaterialPart[]; operation: MaterialEdit }
  >,
) => {
  try {
    const api = await Module({ locateFile: () => wasmUrl });
    api.setup();
    const progress = (value: number) => self.postMessage({ progress: value });
    const parts = Array.isArray(event.data)
      ? prepareMaterialRegions(api, event.data, progress)
      : editMaterialRegions(
          api,
          event.data.parts,
          event.data.operation,
          progress,
        );
    self.postMessage(
      { parts },
      { transfer: parts.map((p) => p.vertices.buffer as ArrayBuffer) },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
