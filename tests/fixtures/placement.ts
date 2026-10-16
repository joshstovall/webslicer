import { ExtrudeGeometry, Shape, Path, BoxGeometry } from "three";
import { createModel } from "../../src/lib/geometry";
import { DEFAULT_SETTINGS, PRINTERS } from "../../src/lib/profiles";
export function nestedProject() {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(60, 0);
  shape.lineTo(60, 60);
  shape.lineTo(0, 60);
  shape.closePath();
  const hole = new Path();
  hole.moveTo(5, 5);
  hole.lineTo(5, 55);
  hole.lineTo(55, 55);
  hole.lineTo(55, 5);
  hole.closePath();
  shape.holes.push(hole);
  const frame = createModel(
    "Frame",
    new ExtrudeGeometry(shape, { depth: 6, bevelEnabled: false }),
  );
  const insert = createModel("Insert", new BoxGeometry(16, 16, 6));
  insert.position = [25, 0, 0];
  return {
    version: 1,
    name: "Outline placement",
    plates: [1],
    activePlate: 1,
    printer: { ...PRINTERS[0], bed: [80, 80, 80] },
    settings: { ...DEFAULT_SETTINGS, adhesion: "none", minLayerTime: 0 },
    models: [frame, insert].map((m) => ({ ...m, positions: [...m.positions] })),
  };
}
