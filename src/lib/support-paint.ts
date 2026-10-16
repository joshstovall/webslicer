import { Matrix4, Vector3 } from "three";
import type { Model, SupportPaint } from "../types";
import { matrixOf } from "./geometry";
import { paintSurface, type PaintStroke } from "./surface-paint";
import type { PreparedPart } from "./material-regions";

export function validateSupportPaint(value: unknown): SupportPaint | undefined {
  if (value === undefined) return undefined;
  const p = value as SupportPaint;
  if (
    !p ||
    !(Array.isArray(p.positions) || p.positions instanceof Float32Array) ||
    !p.positions.length ||
    p.positions.length % 9 ||
    p.positions.length > 18_000_000 ||
    !(Array.isArray(p.states) || p.states instanceof Uint8Array) ||
    p.states.length !== p.positions.length / 9 ||
    p.positions.some((v) => typeof v !== "number" || !Number.isFinite(v)) ||
    p.states.some((v) => !Number.isInteger(v) || v < 0 || v > 2)
  )
    throw new Error("Invalid support-painted surface geometry or states.");
  const positions =
    p.positions instanceof Float32Array
      ? p.positions
      : new Float32Array(p.positions);
  if (positions.some((v) => !Number.isFinite(v)))
    throw new Error("Support-paint coordinates exceed supported precision.");
  return {
    positions,
    states:
      p.states instanceof Uint8Array ? p.states : new Uint8Array(p.states),
  };
}

export function paintSupportSurface(
  model: Model,
  stroke: PaintStroke,
): Partial<Model> {
  if (![0, 1, 2].includes(stroke.tool))
    throw new Error("Choose automatic, enforce or block support paint.");
  const result = paintSurface(
    {
      ...model,
      tool: 0,
      faceTools: model.supportPaint?.states,
      paintTriangles: model.supportPaint?.positions,
    },
    { ...stroke, detail: 0.15 },
  );
  return {
    supportPaint: result.faceTools!.some((v) => v !== 0)
      ? {
          positions: result.paintTriangles!,
          states: result.faceTools!,
        }
      : undefined,
  };
}

export function transformSupportPaint(
  paint: SupportPaint | undefined,
  matrix: Matrix4,
): SupportPaint | undefined {
  if (!paint) return undefined;
  const positions = paint.positions.slice(),
    p = new Vector3();
  for (let i = 0; i < positions.length; i += 3)
    p.fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i);
  return { positions, states: paint.states.slice() };
}

/** Compact world-space triangles [state, ax,ay,az, bx,by,bz, cx,cy,cz]. */
export function worldSupportPaint(model: Model): number[] {
  const paint = model.supportPaint,
    matrix = matrixOf(model),
    point = new Vector3();
  const out: number[] = [];
  if (paint)
    for (let i = 0; i < paint.states.length; i++)
      if (paint.states[i]) {
        out.push(paint.states[i]);
        for (let vertex = 0; vertex < 3; vertex++)
          out.push(
            ...point
              .fromArray(paint.positions, i * 9 + vertex * 3)
              .applyMatrix4(matrix)
              .toArray(),
          );
      }
  return out;
}

export function attachSupportPaint<T extends PreparedPart>(
  models: Model[],
  parts: T[],
) {
  const groups = new Map<string, number[]>();
  for (const m of models.filter((m) => m.visible)) {
    const id = m.assemblyId ?? m.id;
    groups.set(id, [...(groups.get(id) ?? []), ...worldSupportPaint(m)]);
  }
  return parts.map((part) => {
    const { supportPaint: _surface, ...rest } = part;
    const ids = new Set(
      models
        .filter((m) => part.sourceIds?.includes(m.id))
        .map((m) => m.assemblyId ?? m.id),
    );
    return {
      ...rest,
      supportPaintTriangles: [...ids].flatMap((id) => groups.get(id) ?? []),
    };
  });
}
