/* Original Stratum branching support planner. MIT; see NOTICE.md. */
const TOL = 0.0001;
const MAX_NODES = 2048;
const MAX_STEPS = 250000;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const area = (polys) =>
  polys.reduce((sum, p) => sum + Math.abs(p.areaDeep()), 0);
function contains(poly, x, y) {
  let inside = false;
  const ring = poly.points;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside && !(poly.inner ?? []).some((p) => contains(p, x, y));
}
function rings(poly) {
  return [poly.points, ...(poly.inner ?? []).flatMap(rings)];
}
/** Find a point strictly inside an island, including concave polygons and holes. */
export function treeInterior(poly) {
  const edges = rings(poly);
  const ys = [...new Set(edges.flat().map((p) => p.y))].sort((a, b) => a - b);
  let best;
  for (let row = 1; row < ys.length; row++) {
    const y = (ys[row] + ys[row - 1]) / 2;
    const xs = [];
    for (const ring of edges)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i],
          b = ring[j];
        if (a.y > y !== b.y > y)
          xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 2) {
      const width = xs[i] - xs[i - 1],
        x = (xs[i] + xs[i - 1]) / 2;
      if (width > TOL && contains(poly, x, y) && (!best || width > best.width))
        best = { x, y, width };
    }
  }
  if (!best)
    throw new Error(
      "A tree support contact is too thin to place a branch. Increase support clearance or use normal supports.",
    );
  return { x: best.x, y: best.y };
}

/** Deterministic nearest-neighbor pairing with bounded spatial search. */
export function treePartners(nodes, reach) {
  const buckets = new Map(),
    result = new Map();
  const key = (x, y) => `${x},${y}`;
  for (const node of nodes) {
    const k = key(Math.floor(node.x / reach), Math.floor(node.y / reach));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(node);
  }
  for (const node of nodes) {
    let best,
      nearest = reach;
    const x = Math.floor(node.x / reach),
      y = Math.floor(node.y / reach);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of buckets.get(key(x + dx, y + dy)) ?? []) {
          if (other === node) continue;
          const d = distance(node, other);
          if (
            d < nearest ||
            (d === nearest && other.id < (best?.id ?? Infinity))
          ) {
            nearest = d;
            best = other;
          }
        }
    if (best) result.set(node.id, best);
  }
  return result;
}

export function treeLayerStep(upper, lower, process) {
  const top = (slice) =>
    process.stratumLayerPlan?.[slice.index]?.top ??
    (process.firstSliceHeight || process.sliceHeight) +
      slice.index * process.sliceHeight;
  return top(upper) - top(lower);
}

/** Closest point outside a union of obstacle rings, including hole boundaries. */
export function treeEscape(center, obstacles, margin) {
  return treeBoundaryTarget(center, obstacles, margin, false);
}
export function treeEntrance(center, regions, margin) {
  return treeBoundaryTarget(center, regions, margin, true);
}
function treeBoundaryTarget(center, obstacles, margin, wantInside) {
  const inside = (p) => obstacles.some((poly) => contains(poly, p.x, p.y));
  if (inside(center) === wantInside) return;
  let best,
    nearest = Infinity;
  for (const obstacle of obstacles)
    for (const ring of rings(obstacle))
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j],
          b = ring[i],
          dx = b.x - a.x,
          dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length < TOL) continue;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((center.x - a.x) * dx + (center.y - a.y) * dy) / length ** 2,
          ),
        );
        for (const sign of [-1, 1]) {
          const p = {
            x: a.x + t * dx - ((sign * dy) / length) * margin,
            y: a.y + t * dy + ((sign * dx) / length) * margin,
          };
          const d = distance(center, p);
          if (d < nearest && inside(p) === wantInside) {
            best = p;
            nearest = d;
          }
        }
      }
  return best;
}

/** Combine contacts and obstacles across the plate before growing any branches.
 * Each global section is assigned to one real slice, preventing duplicate
 * support walls or fill when branches from different materials meet.
 */
export function collectSupportLayers(widgets, process, api, device) {
  const byIndex = new Map();
  for (const widget of widgets)
    for (const slice of widget.slices) {
      if (!(slice.height > 0) || slice.index < 0) continue;
      let layer = byIndex.get(slice.index);
      if (!layer) {
        layer = {
          z: slice.z,
          index: slice.index,
          height: slice.height,
          supports: [],
          clips: [],
          tops: [],
          refs: [],
        };
        byIndex.set(slice.index, layer);
      }
      if (Math.abs(layer.z - slice.z) > 0.001)
        throw new Error(
          "Support planning requires a shared layer grid across parts.",
        );
      const pos = widget.track.pos;
      const shifted = (polys) =>
        polys.map((p) => p.clone(true).move({ x: pos.x, y: pos.y, z: 0 }));
      layer.tops.push(...shifted(slice.topPolys()));
      layer.clips.push(...shifted(slice.clips ?? []));
      layer.supports.push(...shifted(slice.supports ?? []));
      layer.refs.push({ slice, pos });
    }
  const layers = [...byIndex.values()].sort((a, b) => a.index - b.index);
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    // Machine exclusions are physical keep-out areas in centered plate space.
    // Include half a line width so emitted branch edges retain that clearance.
    for (const r of device.stratumBedExclusions ?? []) {
      const line = process.sliceLineWidth || device.extruders[0].extNozzle;
      layer.clips.push(
        api
          .polygon()
          .centerRectangle(
            api.point((r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2, layer.z),
            r.maxX - r.minX + line,
            r.maxY - r.minY + line,
          ),
      );
    }
    layer.tops = api.polygons.union(layer.tops, 0, true);
    layer.clips = api.polygons.union(layer.clips, 0, true);
    layer.supports = api.polygons.union(layer.supports, 0, true);
    layer.topPolys = () => layer.tops;
    layer.up = layers[i + 1];
    layer.down = layers[i - 1];
  }
  return layers;
}

export async function planPlateTrees(widgets, process, api, device, progress) {
  if (!process.sliceSupportTree) return;
  if (device.bedBelt)
    throw new Error("Tree supports are not available for belt printers.");
  const layers = collectSupportLayers(widgets, process, api, device);
  const stats = await applyTreeSupports(
    layers,
    { ...process, stratumTreeBed: [device.bedWidth, device.bedDepth] },
    api,
    progress,
  );
  for (const layer of layers) {
    for (const ref of layer.refs) ref.slice.supports = [];
    const { slice, pos } = layer.refs[0];
    slice.supports = layer.supports.map((p) =>
      p.clone(true).move({ x: -pos.x, y: -pos.y, z: 0 }),
    );
    api.fill({
      polys: slice.supports,
      lineWidth: process.sliceLineWidth || device.extruders[0].extNozzle,
      density: process.sliceSupportDensity,
      z: slice.z,
      isBelt: false,
      angle: process.sliceSupportFill,
      outline: process.sliceSupportOutline !== false,
    });
  }
  return stats;
}

/** Replace already clipped normal supports with real merging branch sections.
 * Normal sections supply contact roofs only; they are never a tree fallback.
 * Each emitted upper section is audited against a bounded dilation of the next
 * section plus an actual model landing. Bed roots terminate at the first layer.
 */
export async function applyTreeSupports(
  slices,
  process,
  api,
  progress = () => {},
) {
  if (!process.sliceSupportTree) return;
  const { polygons: poly, polygon, point } = api;
  const line = process.sliceLineWidth || 0.4;
  const angle = process.stratumTreeAngle ?? 40;
  const spacing = process.stratumTreeSpacing ?? 3;
  const tip = Math.max(line, (process.stratumTreeTipDiameter ?? 1.6) / 2);
  const maxRadius = Math.max(tip, (process.stratumTreeBranchDiameter ?? 8) / 2);
  if (
    ![angle, spacing, tip, maxRadius].every(Number.isFinite) ||
    angle < 5 ||
    angle > 60 ||
    spacing < 1 ||
    spacing > 10 ||
    tip <= 0 ||
    maxRadius > 15
  )
    throw new Error("Invalid tree support dimensions or angle.");
  const stack = slices
    .filter((s) => s.height > 0 && s.index >= 0)
    .sort((a, b) => a.z - b.z);
  const normal = stack.map((s) => (s.supports ?? []).map((p) => p.clone(true)));
  const minArea = (line * line) / 4;
  const subtract = (a, b, z) =>
    poly.subtract(a, b, [], null, z, 0.00001, { wasm: false });
  const union = (a) => poly.union(a, 0.00001, true);
  let nodes = [],
    nextId = 1,
    steps = 0,
    seedCount = 0,
    merges = 0,
    landings = 0;
  const targetRadius = (n) => Math.min(maxRadius, tip * Math.sqrt(n.weight));
  const physical = (s) =>
    s ? [...s.topPolys(), ...(s.stratumSupportOccluders ?? [])] : [];
  const slope = Math.tan((angle * Math.PI) / 180);
  const obstacleCache = new Map();
  let routeChecks = 0;
  // Look below the immediate next section before allowing branches to converge.
  // Inflating physical clearances by the branch radius gives a center-space
  // route. Full-footprint model landings remain legal; partial edge landings
  // must steer around the model while there is still sufficient vertical room.
  const route = (node, index) => {
    let target,
      urgency = 0;
    for (let j = index; j >= 0; j--) {
      if (++routeChecks > 2_000_000)
        throw new Error(
          "Tree obstacle routing exceeds this browser job limit. Increase branch spacing or split the plate.",
        );
      const descent = treeLayerStep(stack[index], stack[j], process);
      if (descent * slope > 2 * (node.r + line + spacing)) break;
      const futureRadius = Math.max(
        targetRadius(node),
        node.r - descent * slope * 0.45,
      );
      const radius = Math.ceil(futureRadius * 4) / 4 + line / 2;
      const s = stack[j];
      const solids = physical(s);
      if (!solids.length) continue;
      if (
        !solids.some((p) => {
          const b = p.bounds,
            pad = radius + (process.sliceSupportOffset || 0) + line;
          return (
            node.x + pad >= b.minx &&
            node.x - pad <= b.maxx &&
            node.y + pad >= b.miny &&
            node.y - pad <= b.maxy
          );
        })
      )
        continue;
      if (area(subtract(node.polys, solids, s.z)) <= TOL) continue;
      const key = `${j}:${radius}`;
      let regions = obstacleCache.get(key);
      if (!regions) {
        regions = {
          obstacles: poly.offset(s.clips ?? [], radius, { z: s.z }),
          landings: poly.offset(solids, -radius, { z: s.z }),
        };
        if (obstacleCache.size >= 2048)
          obstacleCache.delete(obstacleCache.keys().next().value);
        obstacleCache.set(key, regions);
      }
      let escape = treeEscape(node, regions.obstacles, line / 4);
      if (!escape) continue;
      const entrance = treeEntrance(node, regions.landings, line / 4);
      if (entrance && distance(node, entrance) < distance(node, escape))
        escape = entrance;
      const risk = distance(node, escape) / Math.max(line, descent * slope);
      if (risk > urgency) {
        urgency = risk;
        target = escape;
      }
    }
    return urgency > 0.3 ? target : undefined;
  };
  for (let index = stack.length - 1; index >= 0; index--) {
    const slice = stack[index],
      z = slice.z;
    const gap = process.sliceSupportGap;
    const clips = union([
      ...(slice.clips ?? []),
      ...(slice.stratumSupportClips ?? []),
      ...(gap ? (slice.up?.clips ?? []) : []),
      ...(gap ? (slice.down?.clips ?? []) : []),
      ...(gap ? (slice.up?.stratumSupportClips ?? []) : []),
      ...(gap ? (slice.down?.stratumSupportClips ?? []) : []),
    ]);
    const landing = union([
      ...physical(slice),
      ...(gap ? physical(slice.down) : []),
    ]);
    const dz =
      index + 1 < stack.length
        ? treeLayerStep(stack[index + 1], slice, process)
        : slice.height;
    const reach = Math.max(0, dz * Math.tan((angle * Math.PI) / 180));
    const disk = (node) => {
      const disk = polygon().centerCircle(point(node.x, node.y, z), node.r, 32);
      const bed = process.stratumTreeBed;
      const bounded = bed
        ? poly.trimTo(
            [disk],
            [
              polygon().centerRectangle(
                point(0, 0, z),
                bed[0] - line,
                bed[1] - line,
              ),
            ],
            { minArea: 0.00001 },
          )
        : [disk];
      const free = subtract(bounded, clips, z).filter((p) =>
        contains(p, node.x, node.y),
      );
      return free.length && area(free) > minArea ? free : [];
    };
    const covers = (upper, lower) =>
      area(
        subtract(
          upper,
          union([...poly.offset(lower, reach, { z }), ...landing]),
          z,
        ),
      ) <= TOL;
    const candidates = treePartners(nodes, maxRadius * 4 + spacing);
    const next = [];
    for (const node of nodes) {
      if (++steps > MAX_STEPS)
        throw new Error(
          "Tree support planning exceeds this browser job limit. Increase branch spacing or split the plate.",
        );
      if (landing.length && area(subtract(node.polys, landing, z)) <= TOL) {
        landings++;
        continue;
      }
      const partner = candidates.get(node.id);
      const target = route(node, index) ?? partner ?? node;
      const d = distance(node, target);
      const shrink = Math.min(
        Math.max(0, node.r - targetRadius(node)),
        reach * 0.45,
      );
      const r = Math.max(targetRadius(node), node.r - shrink);
      const move = Math.min(d / 2, reach - shrink);
      const desired = Math.atan2(target.y - node.y, target.x - node.x);
      let chosen;
      // The exact straight continuation is retained as a candidate. A local
      // detour is accepted only if the entire upper footprint remains supported.
      for (const turn of [
        0,
        Math.PI / 4,
        -Math.PI / 4,
        Math.PI / 2,
        -Math.PI / 2,
        Math.PI,
      ]) {
        const trial = {
          ...node,
          x: node.x + Math.cos(desired + turn) * move,
          y: node.y + Math.sin(desired + turn) * move,
          r,
        };
        trial.polys = disk(trial);
        if (trial.polys.length && covers(node.polys, trial.polys)) {
          chosen = trial;
          break;
        }
      }
      if (!chosen) {
        const trial = { ...node };
        trial.polys = disk(trial);
        if (trial.polys.length && covers(node.polys, trial.polys))
          chosen = trial;
      }
      if (!chosen)
        throw new Error(
          `A tree branch cannot reach a supported lower section near Z ${z.toFixed(2)} mm. Adjust branch spacing/angle or use normal supports.`,
        );
      next.push(chosen);
    }
    // Pair only tips that have tapered, and limit the merged trunk diameter.
    const paired = treePartners(next, maxRadius * 2),
      used = new Set(),
      merged = [];
    for (const a of next) {
      if (used.has(a.id)) continue;
      const b = paired.get(a.id);
      if (
        b &&
        !used.has(b.id) &&
        a.r <= targetRadius(a) + TOL &&
        b.r <= targetRadius(b) + TOL &&
        distance(a, b) <= a.r + b.r + reach
      ) {
        const weight = a.weight + b.weight;
        const trial = {
          id: a.id,
          x: (a.x * a.weight + b.x * b.weight) / weight,
          y: (a.y * a.weight + b.y * b.weight) / weight,
          weight,
        };
        trial.r = Math.max(
          targetRadius(trial),
          distance(trial, a) + a.r,
          distance(trial, b) + b.r,
        );
        if (trial.r <= maxRadius) {
          trial.polys = disk(trial);
          if (
            trial.polys.length &&
            !route(trial, index) &&
            area(subtract([...a.polys, ...b.polys], trial.polys, z)) <= TOL
          ) {
            merged.push(trial);
            used.add(a.id);
            used.add(b.id);
            merges++;
            continue;
          }
        }
      }
      used.add(a.id);
      merged.push(a);
    }
    nodes = merged;
    const roof = subtract(normal[index], normal[index + 1] ?? [], z);
    for (const contact of roof) {
      const bounds = contact.bounds;
      for (
        let x = Math.floor(bounds.minx / spacing) * spacing;
        x < bounds.maxx;
        x += spacing
      )
        for (
          let y = Math.floor(bounds.miny / spacing) * spacing;
          y < bounds.maxy;
          y += spacing
        ) {
          if (++seedCount > 50000)
            throw new Error(
              "Too many tree contact cells for this job. Increase branch spacing or split the plate.",
            );
          const cell = polygon().centerRectangle(
            point(x + spacing / 2, y + spacing / 2, z),
            spacing,
            spacing,
          );
          for (const island of poly.trimTo([contact], [cell], { minArea })) {
            const center = treeInterior(island);
            const node = { id: nextId++, ...center, weight: 1 };
            node.r =
              Math.max(tip, ...island.points.map((p) => distance(p, node))) +
              line / 4;
            node.polys = disk(node);
            if (
              !node.polys.length ||
              area(subtract([island], node.polys, z)) > TOL
            )
              throw new Error(
                "A tree support contact cannot form a connected tip. Adjust support spacing or clearance.",
              );
            nodes.push(node);
          }
        }
    }
    if (nodes.length > MAX_NODES)
      throw new Error(
        "Too many active tree branches for this browser job. Increase branch spacing or split the plate.",
      );
    slice.supports = union(nodes.flatMap((n) => n.polys));
    slice.stratumTreeStats = { nodes: nodes.length, merges, landings };
    progress((stack.length - index) / stack.length);
    if (index % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { tips: nextId - 1, merges, landings, bedRoots: nodes.length, steps };
}
