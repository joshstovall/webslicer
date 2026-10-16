export type Point3 = [number, number, number];
export type ArcPlane = 17 | 18 | 19;
export type ArcConvention = "marlin" | "klipper";

export interface ArcPath {
  length: number;
  steps: number;
  coarse: boolean;
  pointAt: (fraction: number) => Point3;
}

const TAU = Math.PI * 2;
const sweepBetween = (start: number, end: number, clockwise: boolean) => {
  const ccw = (((end - start) % TAU) + TAU) % TAU;
  return clockwise ? ccw - TAU : ccw || TAU;
};

// Independent circle geometry. Coordinates are already normalized to millimeters.
// Marlin uses ZX for G18; the pinned U1 Klipper implementation uses XZ.
export function arcPath(
  start: Point3,
  end: Point3,
  args: Record<string, number>,
  clockwise: boolean,
  plane: ArcPlane,
  absoluteCenter: boolean,
  convention: ArcConvention,
): ArcPath {
  const [a, b, h] =
    plane === 17
      ? [0, 1, 2]
      : plane === 19
        ? [1, 2, 0]
        : convention === "klipper"
          ? [0, 2, 1]
          : [2, 0, 1];
  const ca = "IJK"[a],
    cb = "IJK"[b];
  const hasCenter =
    args.I !== undefined || args.J !== undefined || args.K !== undefined;
  const dx = end[a] - start[a],
    dy = end[b] - start[b];
  let cx: number, cy: number, radius: number, sweep: number;
  if (args.P !== undefined && args.P !== 0) {
    // P denotes extra circles in Marlin but total turns in other dialects.
    // Do not invent a trajectory for ambiguous multi-turn commands.
    throw new Error("multi-turn P arcs are not supported");
  }
  if (args.R !== undefined) {
    if (hasCenter) throw new Error("arc mixes R with I/J/K");
    radius = Math.abs(args.R);
    const chord = Math.hypot(dx, dy);
    if (!radius || chord < 1e-8 || chord > radius * 2 + 1e-7)
      throw new Error("arc radius cannot reach its endpoint");
    const offset = Math.sqrt(
      Math.max(0, radius * radius - (chord * chord) / 4),
    );
    const side = (clockwise ? -1 : 1) * (args.R < 0 ? -1 : 1);
    cx = (start[a] + end[a]) / 2 - ((side * dy) / chord) * offset;
    cy = (start[b] + end[b]) / 2 + ((side * dx) / chord) * offset;
    sweep = sweepBetween(
      Math.atan2(start[b] - cy, start[a] - cx),
      Math.atan2(end[b] - cy, end[a] - cx),
      clockwise,
    );
  } else {
    if (args[ca] === undefined && args[cb] === undefined)
      throw new Error("arc has no center in the selected plane");
    cx =
      args[ca] === undefined
        ? start[a]
        : args[ca] + (absoluteCenter ? 0 : start[a]);
    cy =
      args[cb] === undefined
        ? start[b]
        : args[cb] + (absoluteCenter ? 0 : start[b]);
    radius = Math.hypot(start[a] - cx, start[b] - cy);
    const endRadius = Math.hypot(end[a] - cx, end[b] - cy);
    if (
      radius < 1e-8 ||
      Math.abs(radius - endRadius) > Math.max(0.05, radius * 0.001)
    )
      throw new Error("arc center and endpoint radii disagree");
    sweep = sweepBetween(
      Math.atan2(start[b] - cy, start[a] - cx),
      Math.atan2(end[b] - cy, end[a] - cx),
      clockwise,
    );
    if (Math.hypot(dx, dy) < 1e-8) sweep = clockwise ? -TAU : TAU;
  }
  const angle = Math.atan2(start[b] - cy, start[a] - cx);
  const length = Math.hypot(radius * sweep, end[h] - start[h]);
  if (!Number.isFinite(length) || !Number.isFinite(cx) || !Number.isFinite(cy))
    throw new Error("arc geometry exceeds numeric limits");
  // At most 0.02 mm chord error / 1 mm per segment, with a bounded mobile cost.
  const maxAngle = Math.min(
    Math.PI / 12,
    2 * Math.acos(Math.max(-1, 1 - 0.02 / radius)),
  );
  const requested = Math.max(
    1,
    Math.ceil(Math.abs(sweep) / maxAngle),
    Math.ceil(length),
  );
  return {
    length,
    steps: Math.min(4096, requested),
    coarse: requested > 4096,
    pointAt(t) {
      if (t <= 0) return start;
      if (t >= 1) return end;
      const point: Point3 = [...start];
      point[a] = cx + radius * Math.cos(angle + sweep * t);
      point[b] = cy + radius * Math.sin(angle + sweep * t);
      point[h] = start[h] + (end[h] - start[h]) * t;
      return point;
    },
  };
}
