import type { ManifoldToplevel } from "manifold-3d";
import type { WorldModifier } from "./modifiers";

/** Runs in the geometry worker, outside the UI thread. */
export function validateModifierVolumes(
  api: ManifoldToplevel,
  modifiers: WorldModifier[],
) {
  for (const modifier of modifiers) {
    try {
      const mesh = new api.Mesh({
        numProp: 3,
        vertProperties: modifier.vertices,
        triVerts: Uint32Array.from(
          { length: modifier.vertices.length / 3 },
          (_, i) => i,
        ),
      });
      mesh.merge();
      const solid = new api.Manifold(mesh);
      try {
        if (
          solid.status() !== "NoError" ||
          solid.isEmpty() ||
          solid.volume() <= 0
        )
          throw new Error("Invalid volume");
      } finally {
        solid.delete();
      }
    } catch {
      throw new Error(
        `${modifier.name}: modifier volumes require a closed, consistently oriented mesh.`,
      );
    }
  }
}
