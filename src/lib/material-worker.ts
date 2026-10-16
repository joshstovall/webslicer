import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { prepareMaterialRegions, type MaterialPart } from "./material-regions";
self.onmessage = async (event: MessageEvent<MaterialPart[]>) => {
  try {
    const api = await Module({ locateFile: () => wasmUrl });
    api.setup();
    const parts = prepareMaterialRegions(api, event.data, (value) =>
      self.postMessage({ progress: value }),
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
