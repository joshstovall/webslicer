import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { newId } from "./id";
import type { Model, Vec3 } from "../types";
import type { ModelImport } from "./import-3mf";

const COLORS = ["#91ad87", "#86a5bd", "#c6a272", "#b995b2", "#d0866e"];
const LIMIT = 18_000_000;
const fileKey = (name: string) =>
  name.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
interface Material {
  color?: string;
  texture?: boolean;
}
interface Part {
  name: string;
  positions: Float32Array;
  paint: number[];
  tools: number[];
  areas: Map<number, number>;
}

/** OBJ usemtl groups describe surfaces; keep the closed source mesh separate from those colors. */
export async function importObj(
  file: File,
  plate: number,
  companions: File[] = [],
): Promise<ModelImport> {
  const text = await file.text(),
    warnings = new Set<string>(),
    materials = new Map<string, Material>();
  const available = companions.filter((f) => /\.mtl$/i.test(f.name));
  const usedNames = new Set(
    [...text.matchAll(/^\s*usemtl\s+(.+?)\s*$/gm)].map((m) => m[1].trim()),
  );
  const libraries = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) =>
    m[1].replace(/\s+#.*$/, "").trim(),
  );
  const findLibrary = (name: string) => {
    const key = fileKey(name.replace(/^['"]|['"]$/g, ""));
    const exact = available.filter(
      (f) => fileKey(f.webkitRelativePath || f.name) === key,
    );
    const matches = exact.length
      ? exact
      : available.filter((f) => fileKey(f.name) === key.split("/").pop());
    if (matches.length > 1)
      throw new Error(
        `More than one supplied MTL matches ${name}. Use uniquely named material libraries.`,
      );
    return matches[0];
  };
  const selected = new Set<File>();
  if (!libraries.length) available.forEach((f) => selected.add(f));
  for (const library of libraries) {
    const whole = findLibrary(library);
    if (whole) {
      selected.add(whole);
      continue;
    }
    for (const token of library.match(/"[^"]+"|'[^']+'|\S+/g) ?? []) {
      const match = findLibrary(token);
      if (match) selected.add(match);
      else
        warnings.add(
          `Missing OBJ material library ${token}. Select the OBJ and its MTL files together to restore its colors.`,
        );
    }
  }
  if (selected.size > 64)
    throw new Error("An OBJ import is limited to 64 material libraries.");
  for (const library of selected) {
    if (library.size > 10 * 1024 * 1024)
      throw new Error(`${library.name}: material library exceeds 10 MB.`);
    let current: Material | undefined;
    for (const raw of (await library.text()).split(/\r?\n/)) {
      const line = raw.replace(/(?:^|\s+)#.*$/, "").trim();
      const match = line.match(/^(\S+)\s+(.+)$/);
      if (!match) continue;
      const [, directive, value] = match;
      const key = directive.toLowerCase();
      if (key === "newmtl") {
        if (!usedNames.has(value)) {
          current = undefined;
          continue;
        }
        if (materials.has(value))
          warnings.add(
            `Duplicate MTL material ${value}; the last supplied definition is used.`,
          );
        current = {};
        materials.set(value, current);
      } else if (current && key === "kd") {
        const rgb = value.split(/\s+/).map(Number);
        if (
          rgb.length === 3 &&
          rgb.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
        )
          current.color = `#${rgb
            .map((v) =>
              Math.round(v * 255)
                .toString(16)
                .padStart(2, "0"),
            )
            .join("")}`;
        else
          warnings.add(
            "An MTL diffuse color is not an RGB value between 0 and 1; a placeholder color is used.",
          );
      } else if (current && key === "map_kd") {
        current.texture = true;
        warnings.add(
          "OBJ diffuse textures are not converted to filament regions; the MTL diffuse color is retained. No texture files are fetched.",
        );
      } else if (
        current &&
        ((key === "d" && Number(value) < 1) ||
          (key === "tr" && Number(value) > 0))
      ) {
        warnings.add("MTL transparency is displayed as opaque filament color.");
      }
    }
  }
  const palette: ModelImport["palette"] = [],
    paletteKeys = new Map<string, number>();
  const slot = (key: string, name: string, color?: string) => {
    const known = paletteKeys.get(key);
    if (known !== undefined) return known;
    if (palette.length >= 64)
      throw new Error(
        "This OBJ has more than 64 material colors. Reduce its palette before importing.",
      );
    const tool = palette.length;
    palette.push({
      name: name.slice(0, 250),
      color: color ?? COLORS[tool % COLORS.length],
    });
    paletteKeys.set(key, tool);
    return tool;
  };
  const object = new OBJLoader().parse(text);
  const parts: Part[] = [];
  let coordinates = 0,
    paintCoordinates = 0;
  const resources = new Set<THREE.Material>();
  try {
    object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const geometry = node.geometry;
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(
        (m) => resources.add(m),
      );
      const attribute = geometry.getAttribute("position");
      if (!attribute || attribute.count % 3 || !attribute.count)
        throw new Error("OBJ contains empty or invalid triangles.");
      const positions = new Float32Array(attribute.array);
      coordinates += positions.length;
      if (coordinates > LIMIT || positions.some((v) => !Number.isFinite(v)))
        throw new Error(
          "OBJ geometry is invalid or exceeds the mesh size limit.",
        );
      const colors = geometry.getAttribute("color");
      const sourceMaterials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      const groups = geometry.groups.length
        ? geometry.groups
        : [{ start: 0, count: attribute.count, materialIndex: 0 }];
      const part: Part = {
        name: node.name || file.name.replace(/\.obj$/i, ""),
        positions,
        paint: [],
        tools: [],
        areas: new Map(),
      };
      const append = (points: number[][], tool: number) => {
        paintCoordinates += 9;
        if (paintCoordinates > LIMIT)
          throw new Error(
            "OBJ colored surface exceeds the mesh size limit. Reduce its detail before importing.",
          );
        for (const point of points) part.paint.push(...point);
        part.tools.push(tool);
        const a = new THREE.Vector3().fromArray(points[0]),
          b = new THREE.Vector3().fromArray(points[1]),
          c = new THREE.Vector3().fromArray(points[2]);
        const area = b.sub(a).cross(c.sub(a)).length() / 2;
        part.areas.set(tool, (part.areas.get(tool) ?? 0) + area);
      };
      for (const group of groups) {
        const name =
          sourceMaterials[group.materialIndex ?? 0]?.name || "Default";
        const material = materials.get(name);
        if (name !== "Default" && !material)
          warnings.add(
            `OBJ material ${name} has no supplied MTL definition; its group is retained with a placeholder color.`,
          );
        let base: number | undefined;
        const baseTool = () =>
          (base ??= slot(`material:${name}`, name, material?.color));
        const tint = new THREE.Color(material?.color ?? "#ffffff");
        for (
          let vertex = group.start;
          vertex < group.start + group.count;
          vertex += 3
        ) {
          const points = [0, 1, 2].map((i) =>
            Array.from(
              positions.subarray((vertex + i) * 3, (vertex + i + 1) * 3),
            ),
          );
          const tools = points.map((_, i) => {
            if (!colors) return baseTool();
            const rgb = [
              colors.getX(vertex + i),
              colors.getY(vertex + i),
              colors.getZ(vertex + i),
            ];
            if (!rgb.every(Number.isFinite)) {
              warnings.add(
                "Some OBJ vertex colors are invalid; those vertices use their material color.",
              );
              return baseTool();
            }
            const color = `#${new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]).multiply(tint).getHexString()}`;
            if (color.toLowerCase() === material?.color?.toLowerCase())
              return baseTool();
            return slot(`color:${color}`, `${name} ${color}`, color);
          });
          if (tools.every((t) => t === tools[0])) append(points, tools[0]);
          else {
            warnings.add(
              "Interpolated OBJ vertex colors were divided into discrete filament regions.",
            );
            const center = [0, 1, 2].map(
              (axis) => points.reduce((n, p) => n + p[axis], 0) / 3,
            );
            points.forEach((a, i) => {
              const b = points[(i + 1) % 3],
                c = points[(i + 2) % 3];
              append(
                [a, a.map((v, axis) => (v + b[axis]) / 2), center],
                tools[i],
              );
              append(
                [a, center, a.map((v, axis) => (v + c[axis]) / 2)],
                tools[i],
              );
            });
          }
        }
      }
      parts.push(part);
    });
  } finally {
    object.traverse((node) => {
      if (
        node instanceof THREE.Mesh ||
        node instanceof THREE.Line ||
        node instanceof THREE.Points
      ) {
        node.geometry.dispose();
        (Array.isArray(node.material)
          ? node.material
          : [node.material]
        ).forEach((m) => resources.add(m));
      }
    });
    resources.forEach((m) => m.dispose());
  }
  if (!parts.length)
    throw new Error("No printable mesh was found in this OBJ.");

  // OBJ g/o statements can separate individual faces of one shell. Join parts
  // only along unmatched edges; already closed neighboring solids remain distinct.
  const parents = parts.map((_, i) => i);
  const root = (i: number): number => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  const edges = new Map<string, number>();
  parts.forEach((part, index) => {
    const boundary = new Set<string>();
    const key = (offset: number) =>
      `${part.positions[offset]},${part.positions[offset + 1]},${part.positions[offset + 2]}`;
    for (let offset = 0; offset < part.positions.length; offset += 9) {
      const vertices = [key(offset), key(offset + 3), key(offset + 6)];
      for (let i = 0; i < 3; i++) {
        const a = vertices[i],
          b = vertices[(i + 1) % 3],
          edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (boundary.has(edge)) boundary.delete(edge);
        else boundary.add(edge);
      }
    }
    for (const edge of boundary) {
      const other = edges.get(edge);
      if (other !== undefined) parents[root(index)] = root(other);
      else edges.set(edge, index);
    }
  });
  const groups = new Map<number, Part[]>();
  parts.forEach((p, i) => {
    const key = root(i);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  });
  if (groups.size > 200) throw new Error("OBJ exceeds 200 parts.");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts)
    for (let i = 0; i < part.positions.length; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis], part.positions[i]);
      max[axis] = Math.max(max[axis], part.positions[i]);
    }
  const origin = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  const assemblyId = groups.size > 1 ? newId() : undefined;
  const models = [...groups.values()].map((group) => {
    const positions = new Float32Array(
      group.reduce((n, p) => n + p.positions.length, 0),
    );
    const painted = new Float32Array(
      group.reduce((n, p) => n + p.paint.length, 0),
    );
    const tools = new Uint8Array(group.reduce((n, p) => n + p.tools.length, 0));
    const areas = new Map<number, number>();
    let pi = 0,
      ti = 0,
      vi = 0;
    for (const part of group) {
      positions.set(part.positions, vi);
      vi += part.positions.length;
      painted.set(part.paint, pi);
      pi += part.paint.length;
      tools.set(part.tools, ti);
      ti += part.tools.length;
      for (const [tool, area] of part.areas)
        areas.set(tool, (areas.get(tool) ?? 0) + area);
    }
    for (let i = 0; i < positions.length; i++) positions[i] -= origin[i % 3];
    for (let i = 0; i < painted.length; i++) painted[i] -= origin[i % 3];
    const tool = [...areas].sort((a, b) => b[1] - a[1])[0][0];
    const multicolor = tools.some((t) => t !== tool);
    return {
      id: newId(),
      name: [...new Set(group.map((p) => p.name))].join(" + ").slice(0, 250),
      positions,
      position: [0, 0, 0] as Vec3,
      rotation: [0, 0, 0] as Vec3,
      scale: [1, 1, 1] as Vec3,
      tool,
      color: palette[tool].color,
      faceTools: multicolor ? tools : undefined,
      paintTriangles: multicolor ? painted : undefined,
      assemblyId,
      plate,
      visible: true,
    } satisfies Model;
  });
  // Avoid creating unused filament slots for default materials or vertex-color bases.
  const used = new Set(models.flatMap((m) => [m.tool, ...(m.faceTools ?? [])]));
  const mapping = new Map(
    [...used].sort((a, b) => a - b).map((tool, i) => [tool, i]),
  );
  return {
    models: models.map((m) => ({
      ...m,
      tool: mapping.get(m.tool)!,
      faceTools: m.faceTools?.map((t) => mapping.get(t)!),
    })),
    palette: [...mapping.keys()].map((i) => palette[i]),
    warnings: [...warnings],
  };
}
