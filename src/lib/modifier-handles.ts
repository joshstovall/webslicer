import { Euler, Quaternion, Vector3 } from "three";
import type { Model, ModifierMesh, Vec3 } from "../types";
import { matrixOf } from "./geometry";

type Transform = Pick<ModifierMesh, "position" | "rotation" | "scale">;
const rotationOf = (rotation: Vec3) =>
  new Quaternion().setFromEuler(
    new Euler(...(rotation.map((v) => (v * Math.PI) / 180) as Vec3)),
  );

// A root-level handle avoids decomposing the shear produced by a rotated
// modifier beneath a nonuniformly scaled parent. The actual volume always
// renders with the complete parent × local matrix.
export function modifierHandlePose(parent: Transform, modifier: Transform) {
  return {
    position: new Vector3(...modifier.position).applyMatrix4(matrixOf(parent)),
    quaternion: rotationOf(parent.rotation).multiply(
      rotationOf(modifier.rotation),
    ),
    scale: new Vector3(...modifier.scale),
  };
}

export function modifierFromHandle(
  parent: Pick<Model, "position" | "rotation" | "scale">,
  handle: { position: Vector3; quaternion: Quaternion; scale: Vector3 },
): Transform {
  const rotation = new Euler().setFromQuaternion(
    rotationOf(parent.rotation).invert().multiply(handle.quaternion),
  );
  return {
    position: handle.position
      .clone()
      .applyMatrix4(matrixOf(parent).invert())
      .toArray() as Vec3,
    rotation: [rotation.x, rotation.y, rotation.z].map(
      (v) => (v * 180) / Math.PI,
    ) as Vec3,
    scale: handle.scale.toArray().map((v) => Math.max(0.001, v)) as Vec3,
  };
}
