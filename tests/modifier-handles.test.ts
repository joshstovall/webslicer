import { expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { matrixOf } from "../src/lib/geometry";
import {
  modifierHandlePose,
  modifierFromHandle,
} from "../src/lib/modifier-handles";
import type { Vec3 } from "../src/types";
const parent = {
  position: [12, -20, 8] as Vec3,
  rotation: [22, 41, 67] as Vec3,
  scale: [2, 0.5, 3] as Vec3,
};
const modifier = {
  position: [3, -7, 9] as Vec3,
  rotation: [18, 39, -24] as Vec3,
  scale: [0.5, 2, 1.3] as Vec3,
};
it("preserves a rotated modifier's full sheared world geometry through a handle round trip", () => {
  const restored = modifierFromHandle(
    parent,
    modifierHandlePose(parent, modifier),
  );
  const expected = matrixOf(parent).multiply(matrixOf(modifier));
  const actual = matrixOf(parent).multiply(matrixOf(restored));
  expected.elements.forEach((v, i) =>
    expect(actual.elements[i]).toBeCloseTo(v, 10),
  );
});
it("moves exactly in world space beneath a rotated nonuniform parent without changing shape", () => {
  const handle = modifierHandlePose(parent, modifier);
  const delta = new Vector3(10, -4, 2);
  handle.position.add(delta);
  const moved = modifierFromHandle(parent, handle);
  for (const vertex of [
    new Vector3(),
    new Vector3(1, 2, 3),
    new Vector3(-4, 2, 8),
  ]) {
    const expected = vertex
      .clone()
      .applyMatrix4(matrixOf(parent).multiply(matrixOf(modifier)))
      .add(delta);
    const actual = vertex
      .clone()
      .applyMatrix4(matrixOf(parent).multiply(matrixOf(moved)));
    expect(actual.distanceTo(expected)).toBeLessThan(1e-10);
  }
});
it("rotates around the modifier origin and scales local axes without altering its parent", () => {
  const handle = modifierHandlePose(parent, modifier);
  handle.quaternion.multiply(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
  );
  handle.scale.x *= 3;
  const changed = modifierFromHandle(parent, handle);
  changed.position.forEach((v, i) =>
    expect(v).toBeCloseTo(modifier.position[i], 10),
  );
  expect(changed.scale).toEqual([1.5, 2, 1.3]);
  const resulting = modifierHandlePose(parent, changed);
  expect(resulting.quaternion.angleTo(handle.quaternion)).toBeLessThan(1e-7);
  handle.scale.set(-1, 0, 2);
  expect(modifierFromHandle(parent, handle).scale).toEqual([0.001, 0.001, 2]);
});
