import Module from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import { convertStep, STEP_QUALITY, type StepOptions } from "./step-mesh";

self.onmessage = async (
  event: MessageEvent<{
    bytes: ArrayBuffer;
    name: string;
    plate: number;
    options: StepOptions;
  }>,
) => {
  try {
    self.postMessage({ stage: "Loading CAD converter" });
    const api = await Module({ locateFile: () => wasmUrl });
    self.postMessage({ stage: "Reading and tessellating STEP surfaces" });
    const { bytes, name, plate, options } = event.data;
    if (!Object.hasOwn(STEP_QUALITY, options.quality))
      throw new Error("Unknown STEP quality.");
    const result = api.ReadStepFile(new Uint8Array(bytes), {
      linearUnit: "millimeter",
      linearDeflectionType: "absolute_value",
      ...STEP_QUALITY[options.quality],
    });
    self.postMessage({ stage: "Preparing parts and colors" });
    const imported = convertStep(result, name, plate, options);
    self.postMessage(
      { imported },
      {
        transfer: imported.models.flatMap((m) => [
          m.positions.buffer as ArrayBuffer,
          ...(m.faceTools ? [m.faceTools.buffer as ArrayBuffer] : []),
        ]),
      },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
