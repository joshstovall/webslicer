import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import {
  calculateOrientation,
  type OrientationRequest,
} from "./orientation-core";
self.onmessage = async (event: MessageEvent<OrientationRequest>) => {
  try {
    const api = await Module({ locateFile: () => wasmUrl });
    api.setup();
    const result = calculateOrientation(api, event.data, (progress, stage) =>
      self.postMessage({ progress, stage }),
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
