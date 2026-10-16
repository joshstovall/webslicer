import { it, expect } from "vitest";
import {
  primitive,
  arrangeModels,
  boundsOf,
  validatePlate,
  matrixOf,
} from "../src/lib/geometry";
import {
  assembleModels,
  updateAssembly,
  duplicateAssembly,
} from "../src/lib/assemblies";
import { PRINTERS } from "../src/lib/profiles";
import { Vector3 } from "three";
function assembly() {
  const a = primitive("cube", 1),
    b = primitive("cube", 1);
  a.scale = b.scale = [0.5, 0.5, 0.5];
  b.position = [0, 0, 10];
  a.tool = 0;
  b.tool = 1;
  return assembleModels([a, b]);
}
it("packs and grounds assemblies as one object without moving their parts apart", () => {
  const parts = assembly();
  const placed = arrangeModels(
    [...parts, { ...primitive("cube", 1), position: [100, 0, 0] }],
    PRINTERS[0],
  );
  expect(boundsOf(placed[1]).min.z - boundsOf(placed[0]).min.z).toBeCloseTo(10);
  expect(boundsOf(placed[0]).min.z).toBeCloseTo(0);
  expect(validatePlate(placed, PRINTERS[0])).toEqual([]);
});
it("transforms linked parts together, including nonuniform scales and rotations", () => {
  const parts = assembly();
  const moved = updateAssembly(
    parts,
    parts[0].id,
    { position: [40, 30, 0], rotation: [0, 0, 90], scale: [2, 1, 1] },
    true,
    true,
  );
  expect(moved[0].position).toEqual(moved[1].position);
  expect(moved[1].tool).toBe(1);
  expect(boundsOf(moved[1]).min.z).toBeCloseTo(10);
  expect(boundsOf(moved[1]).getSize(new Vector3()).toArray()).toEqual([
    expect.closeTo(10),
    expect.closeTo(20),
    expect.closeTo(10),
  ]);
});
it("retains relative transforms after editing a part then transforming the assembly", () => {
  let parts = assembly();
  parts = updateAssembly(
    parts,
    parts[1].id,
    { position: [3, 4, 0], rotation: [0, 0, 30] },
    false,
    false,
  );
  const old = new Vector3()
    .fromArray(parts[1].positions)
    .applyMatrix4(matrixOf(parts[1]));
  const moved = updateAssembly(
    parts,
    parts[0].id,
    { position: [7, 8, 0] },
    true,
    false,
  );
  const actual = new Vector3()
    .fromArray(moved[1].positions)
    .applyMatrix4(matrixOf(moved[1]));
  expect(actual.distanceTo(old.add(new Vector3(7, 8, 0)))).toBeLessThan(1e-5);
});
it("duplicates a whole assembly into an independent group and leaves materials intact", () => {
  const parts = assembly(),
    copies = duplicateAssembly(parts, parts[0]);
  expect(copies).toHaveLength(2);
  expect(copies[0].assemblyId).not.toBe(parts[0].assemblyId);
  expect(copies[0].assemblyId).toBe(copies[1].assemblyId);
  expect(copies.map((m) => m.tool)).toEqual([0, 1]);
  expect(validatePlate([...parts, ...copies], PRINTERS[0])).toEqual([]);
});

import { colorAboveHeight } from "../src/lib/height-colors";
import { modelVolume } from "../src/lib/geometry";
it("height colors preserve transformed coordinates, cap volumes, and permit repeated bands", () => {
  const source = primitive("cube", 1);
  source.position = [30, -20, 5];
  source.rotation = [0, 0, 25];
  source.scale = [1, 0.5, 1];
  source.tool = 0;
  const before = boundsOf(source),
    volume = modelVolume(source);
  let bands = colorAboveHeight([source], source.id, 13, 1, "#cc4433");
  expect(bands).toHaveLength(2);
  expect(bands.map((m) => m.tool)).toEqual([0, 1]);
  expect(boundsOf(bands[0]).min.z).toBeCloseTo(5);
  expect(boundsOf(bands[0]).max.z).toBeCloseTo(13);
  expect(boundsOf(bands[1]).min.z).toBeCloseTo(13);
  expect(boundsOf(bands[1]).max.z).toBeCloseTo(before.max.z);
  expect(bands.reduce((v, m) => v + modelVolume(m), 0)).toBeCloseTo(volume, 2);
  const assemblyId = bands[0].assemblyId;
  bands = colorAboveHeight(bands, bands[0].id, 19, 2, "#3366cc");
  expect(bands).toHaveLength(3);
  expect(bands.map((m) => m.tool)).toEqual([0, 1, 2]);
  expect(bands.every((m) => m.assemblyId === assemblyId)).toBe(true);
  expect(boundsOf(bands[2]).min.z).toBeCloseTo(19);
  expect(bands.reduce((v, m) => v + modelVolume(m), 0)).toBeCloseTo(volume, 2);
});
it("moving an assembly to a plate moves all of its parts without changing transforms", () => {
  const parts = assembly();
  const moved = updateAssembly(parts, parts[0].id, { plate: 2 }, true, false);
  expect(moved.map((m) => m.plate)).toEqual([2, 2]);
  expect(moved.map((m) => m.position)).toEqual(parts.map((m) => m.position));
});
