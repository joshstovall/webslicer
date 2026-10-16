import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { prepareMaterialRegions, type MaterialPart } from "./material-regions";
import {
  editMaterialRegions,
  type MaterialEdit,
} from "./edit-material-regions";
import { validateModifierVolumes } from "./validate-modifier-volumes";
import type { WorldModifier } from "./modifiers";
self.onmessage = async (
  event: MessageEvent<
    | MaterialPart[]
    | {
        parts: MaterialPart[];
        operation?: MaterialEdit;
        modifiers?: WorldModifier[];
      }
  >,
) => {
  try {
    const api = await Module({ locateFile: () => wasmUrl });
    api.setup();
    const progress = (value: number) => self.postMessage({ progress: value });
    const payload = Array.isArray(event.data)
      ? { parts: event.data }
      : event.data;
    validateModifierVolumes(api, payload.modifiers ?? []);
    const parts = payload.operation
      ? editMaterialRegions(api, payload.parts, payload.operation, progress)
      : prepareMaterialRegions(api, payload.parts, progress);
    self.postMessage(
      { parts },
      {
        transfer: parts.flatMap((p) => [
          p.vertices.buffer as ArrayBuffer,
          ...(p.supportPaint
            ? [
                p.supportPaint.positions.buffer as ArrayBuffer,
                p.supportPaint.states.buffer as ArrayBuffer,
              ]
            : []),
        ]),
      },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
