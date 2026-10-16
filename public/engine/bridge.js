// The engine lives in an isolated frame; removing it cancels all owned workers.
let Engine;
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
    const { vertices, device, process } = e.data;
    self.createWorker = () => {
      const worker = new Worker(new URL("./kiri-work.js", import.meta.url), { type: "module" });
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
    engine.setDevice(device).setProcess(process).setRender(false);
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
    // Vertices already carry all scene transforms in millimetres, Z-up.
    engine.widget.loadVertices(vertices);
    engine.widget.track.grid_id = 0;
    engine.setTopOffset(0);
    await engine.slice();
    send({ type: "progress", progress: 0.8, stage: "Planning toolpaths" });
    await engine.prepare();
    send({ type: "progress", progress: 0.96, stage: "Generating G-code" });
    const gcode = await engine.export();
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
  ({ Engine } = await import("./kiri-eng.js"));
  send({ type: "ready" });
} catch (error) {
  send({
    type: "error",
    message: `Could not load the slicing engine: ${error.message}`,
  });
}
