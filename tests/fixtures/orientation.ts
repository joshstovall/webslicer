import { BoxGeometry } from "three";
import { createModel } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
export function orientationProject() {
  const stem = createModel("Stem", new BoxGeometry(4, 4, 20));
  const cap = createModel("Cap", new BoxGeometry(30, 16, 4));
  cap.position = [0, 0, 20];
  for (const m of [stem, cap]) {
    m.assemblyId = "tee";
    m.faceTools = new Uint8Array(m.positions.length / 9);
    m.paintTriangles = m.positions.slice();
    m.supportPaint = {
      positions: m.positions.slice(),
      states: new Uint8Array(m.positions.length / 9),
    };
  }
  return {
    version: 1,
    name: "Orientation test",
    plates: [1],
    activePlate: 1,
    printer: PRINTERS[0],
    settings: {
      ...DEFAULT_SETTINGS,
      minLayerTime: 0,
      adhesion: "none",
      supports: "auto",
    },
    models: [stem, cap].map((m) => ({
      ...m,
      positions: [...m.positions],
      faceTools: [...m.faceTools!],
      paintTriangles: [...m.paintTriangles!],
      supportPaint: {
        positions: [...m.supportPaint!.positions],
        states: [...m.supportPaint!.states],
      },
    })),
  };
}
