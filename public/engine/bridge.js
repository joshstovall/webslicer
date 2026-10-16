import { planAdaptiveLayers, planManualLayers } from "./layer-plan.js";
// The engine lives in an isolated frame; removing it cancels all owned workers.
let Engine, engineClient;
let running = false;
const send = (message) =>
  parent.postMessage({ stratumEngine: true, ...message }, location.origin);
window.addEventListener("error", (e) =>
  send({ type: "error", message: e.message }),
);
window.addEventListener("unhandledrejection", (e) =>
  send({ type: "error", message: String(e.reason?.message || e.reason) }),
);
window.addEventListener("message", async (e) => {
  if (
    e.origin !== location.origin ||
    e.source !== parent ||
    e.data?.type !== "slice" ||
    running
  )
    return;
  running = true;
  try {
    const { parts, device, process } = e.data;
    self.createWorker = () => {
      const worker = new Worker(new URL("./kiri-work.js", import.meta.url), {
        type: "module",
      });
      worker.addEventListener("error", (e) =>
        send({
          type: "error",
          message: e.message || "The slicing worker could not load.",
        }),
      );
      worker.addEventListener("messageerror", () =>
        send({
          type: "error",
          message: "The slicing worker returned unreadable data.",
        }),
      );
      return worker;
    };
    const engine = new Engine({
      workURL: new URL("./kiri-work.js", import.meta.url).href,
      poolURL: new URL("./kiri-pool.js", import.meta.url).href,
    });
    engine.setMode("FDM");
    engine.setController({ threaded: true, healMesh: true });
    engine
      .setDevice(device)
      .setProcess({
        ...process,
        stratumLayerPlan:
          planManualLayers(parts, process) ??
          planAdaptiveLayers(parts, process),
      })
      .setRender(false);
    engine.setListener((msg) => {
      if (msg.slice?.error)
        send({ type: "error", message: String(msg.slice.error) });
      if (msg.slice?.update !== undefined)
        send({
          type: "progress",
          progress: Math.min(0.8, msg.slice.update * 0.8),
          stage: msg.slice.updateStatus || "Slicing geometry",
        });
      if (msg.prepare?.update !== undefined)
        send({
          type: "progress",
          progress: 0.8 + Number(msg.prepare.update || 0) * 0.15,
          stage: "Planning toolpaths",
        });
    });
    // Preserve each part's tool assignment in a shared coordinate system.
    const groups = new Map();
    engine.settings.widget = {};
    const widgets = parts.map((part, index) => {
      const id = part.assemblyId ?? `part-${index}`;
      if (!groups.has(id)) groups.set(id, []);
      const widget = new engine.widget.constructor(undefined, groups.get(id));
      widget.loadVertices(part.vertices);
      widget.track.grid_id = index;
      widget.meta.file = part.name;
      widget.anno.extruder = part.tool;
      widget.anno.stratumModifiers = part.modifiers?.map((m) => ({
        ...m,
        vertices: Array.from(m.vertices),
      }));
      widget.setTopZ(widget.getBoundingBox().max.z);
      engine.settings.widget[widget.id] = { extruder: part.tool };
      return widget;
    });
    engineClient.clear();
    engineClient.sync(widgets);
    await new Promise((resolve) =>
      engineClient.rotate(engine.settings, resolve),
    );
    await new Promise((resolve) =>
      engineClient.slicePre(engine.settings, resolve),
    );
    // Sequential dispatch keeps peak memory bounded on phones. The engine's
    // worker pool still parallelizes expensive polygon operations internally.
    for (const [index, widget] of widgets.entries()) {
      await new Promise((resolve, reject) => {
        engineClient.slice(engine.settings, widget, (msg) => {
          if (msg.error) reject(new Error(msg.error));
          if (msg.update !== undefined)
            send({
              type: "progress",
              progress: (0.8 * (index + msg.update)) / widgets.length,
              stage: `Slicing part ${index + 1} of ${widgets.length}`,
            });
          if (msg.done) resolve();
        });
      });
    }
    await new Promise((resolve) =>
      engineClient.slicePost(engine.settings, resolve),
    );
    send({ type: "progress", progress: 0.8, stage: "Planning toolpaths" });
    await new Promise((resolve, reject) =>
      engineClient.prepare(
        engine.settings,
        (progress) =>
          send({
            type: "progress",
            progress: 0.8 + progress * 0.15,
            stage: "Planning toolpaths",
          }),
        (result) =>
          result?.error ? reject(new Error(result.error)) : resolve(),
      ),
    );
    send({ type: "progress", progress: 0.96, stage: "Generating G-code" });
    const gcode = await new Promise((resolve, reject) => {
      const lines = [];
      engineClient.export(
        engine.settings,
        (line) => {
          if (typeof line === "string") lines.push(line);
        },
        (_, error) =>
          error ? reject(new Error(error)) : resolve(lines.join("\r\n")),
      );
    });
    if (!gcode || !/G1 .*E/.test(gcode))
      throw new Error(
        "The engine produced no extrusion paths. Check the model and settings.",
      );
    send({ type: "complete", gcode });
  } catch (error) {
    send({ type: "error", message: String(error?.message || error) });
  }
});
try {
  ({ Engine, engineClient } = await import("./kiri-eng.js"));
  send({ type: "ready" });
} catch (error) {
  send({
    type: "error",
    message: `Could not load the slicing engine: ${error.message}`,
  });
}
