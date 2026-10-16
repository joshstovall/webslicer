import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { calculatePlacement, type PlacementRequest } from "./placement-core";
self.onmessage = async (event: MessageEvent<PlacementRequest>) => {
  try {
    const api = await Module({ locateFile: () => wasmUrl });
    api.setup();
    const result = calculatePlacement(api, event.data, (progress, stage) =>
      self.postMessage({ progress, stage }),
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
