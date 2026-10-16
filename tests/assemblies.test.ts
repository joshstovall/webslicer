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

import {
  linkAssembly,
  unlinkAssembly,
  changeAssemblyPriority,
  assemblyParts,
} from "../src/lib/assemblies";
function worldVertices(model: ReturnType<typeof primitive>, painted = false) {
  const positions = painted ? model.paintTriangles! : model.positions;
  const result: number[] = [],
    matrix = matrixOf(model);
  for (let i = 0; i < positions.length; i += 3)
    result.push(
      ...new Vector3().fromArray(positions, i).applyMatrix4(matrix).toArray(),
    );
  return result;
}
it("linking transformed painted parts preserves world geometry, paint, filament and source priority", () => {
  const a = primitive("cube", 1),
    b = primitive("cube", 1),
    other = { ...primitive("cube", 2), assemblyId: "untouched-singleton" };
  a.position = [20, -10, 3];
  a.rotation = [10, 20, 30];
  a.scale = [0.7, 1.4, 2];
  b.position = [5, 7, 8];
  b.tool = 2;
  b.visible = false;
  a.paintTriangles = a.positions.slice(0, 18);
  a.faceTools = new Uint8Array([1, 2]);
  a.paintDepth = 1.2;
  const sources = [a, other, b];
  const linked = linkAssembly(sources, [b.id, a.id]);
  expect(linked.map((m) => m.id)).toEqual(sources.map((m) => m.id));
  expect(linked[0].assemblyId).toBe(linked[2].assemblyId);
  expect(linked[1]).toBe(other);
  for (const i of [0, 2]) {
    const before = worldVertices(sources[i]),
      after = worldVertices(linked[i]);
    expect(
      Math.max(...before.map((v, j) => Math.abs(v - after[j]))),
    ).toBeLessThan(0.00002);
  }
  expect(worldVertices(linked[0], true)).toEqual(
    worldVertices(a, true).map((v) => expect.closeTo(v, 4)),
  );
  expect(linked[0].faceTools).toBe(a.faceTools);
  expect(linked[0].paintDepth).toBe(1.2);
  expect(linked[2].tool).toBe(2);
  expect(linked[2].visible).toBe(false);
  expect(linkAssembly(linked, [a.id, b.id])).toBe(linked);
});
it("regrouping and detaching parts clean singleton groups and never move remaining parts", () => {
  const [a, b] = assembly(),
    c = primitive("cube", 1);
  const grouped = linkAssembly([a, b, c], [b.id, c.id]);
  expect(grouped[0].assemblyId).toBeUndefined();
  expect(grouped[0].positions).toBe(a.positions);
  const detached = unlinkAssembly(grouped, b.id);
  expect(detached.every((m) => !m.assemblyId)).toBe(true);
  expect(detached.map((m) => m.position)).toEqual(
    grouped.map((m) => m.position),
  );
  const triple = linkAssembly([a, b, c], [a.id, b.id, c.id]);
  const single = unlinkAssembly(triple, b.id);
  expect(assemblyParts(single, single[0])).toHaveLength(2);
  expect(single[1].assemblyId).toBeUndefined();
  const all = unlinkAssembly(triple, a.id, true);
  expect(all.every((m) => !m.assemblyId)).toBe(true);
  expect(all.map((m) => m.positions)).toEqual(triple.map((m) => m.positions));
});
it("priority changes swap only linked parts, retaining unrelated objects, other plates and bounds", () => {
  const [a, b] = assembly(),
    other = primitive("cube", 1),
    plate2 = { ...primitive("cube", 2), assemblyId: a.assemblyId };
  const source = [a, other, b, plate2];
  const swapped = changeAssemblyPriority(source, a.id, 1);
  expect(swapped).toEqual([b, other, a, plate2]);
  expect(changeAssemblyPriority(swapped, a.id, 1)).toBe(swapped);
  expect(changeAssemblyPriority(swapped, a.id, -1)).toEqual(source);
  expect(() => linkAssembly(source, [a.id, plate2.id])).toThrow("same plate");
  expect(() => linkAssembly(source, [a.id, "missing"])).toThrow(
    "no longer exists",
  );
});
