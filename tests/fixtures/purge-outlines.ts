import { ExtrudeGeometry, Shape, Path, BoxGeometry } from "three";
import { createModel } from "../../src/lib/geometry";
import { PRINTERS, DEFAULT_SETTINGS } from "../../src/lib/profiles";
import {
  defaultFilament,
  DEFAULT_MULTI_MATERIAL,
} from "../../src/lib/multimaterial";
export function purgeFrameProject(mode = "automatic") {
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
  const models = [0, 1].map((tool) => ({
    ...createModel(
      `Frame color ${tool + 1}`,
      new ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false }),
    ),
    tool,
    assemblyId: "frame",
    position: [0, 0, tool * 0.6] as [number, number, number],
  }));
  if (mode === "roof")
    models.push({
      ...createModel("Raised roof", new BoxGeometry(50, 50, 0.6)),
      tool: 0,
      assemblyId: "frame",
      position: [0, 0, 1.2],
    });
  const bed = mode === "brim" || mode === "raft" ? 110 : 64;
  const settings = {
    ...DEFAULT_SETTINGS,
    adhesion: mode === "brim" ? "brim" : mode === "raft" ? "raft" : "none",
    brimWidth: 18,
    minLayerTime: 0,
  };
  return {
    version: 1,
    name: "Tower inside frame",
    plates: [1],
    activePlate: 1,
    printer: {
      ...PRINTERS.find((p) => p.id === "generic-multi")!,
      bed: [bed, bed, 64],
    },
    settings,
    models: models.map((m) => ({ ...m, positions: [...m.positions] })),
    filaments: [0, 1].map((i) => defaultFilament(settings, i)),
    multiMaterial: {
      ...DEFAULT_MULTI_MATERIAL,
      purgeVolume: 20,
      ...(mode === "automatic"
        ? {}
        : { towerPositions: { "1": { x: bed / 2, y: bed / 2, axis: "x" } } }),
    },
  };
}
