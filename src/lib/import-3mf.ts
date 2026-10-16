import { unzipSync, strFromU8 } from "fflate";
import * as THREE from "three";
import { newId } from "./id";
import type { Model, Vec3 } from "../types";
import { decodePaintTriangle, type PaintedTriangle } from "./paint-codec";

export interface ImportedMaterial {
  name: string;
  color: string;
  material?: string;
}
export interface ModelImport {
  models: Model[];
  palette: ImportedMaterial[];
  warnings: string[];
}
const children = (node: Element, name: string) =>
  Array.from(node.children).filter((n) => n.localName === name);
const child = (node: Element, name: string) => children(node, name)[0];
const attr = (node: Element, name: string) =>
  Array.from(node.attributes).find((a) => a.localName === name)?.value;
function documentOf(bytes: Uint8Array) {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error(
      "3MF documents with entity declarations are not supported.",
    );
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("The 3MF contains malformed XML.");
  return doc;
}
function pathOf(path: string, parent = "") {
  const parts: string[] = [];
  const source = path.startsWith("/")
    ? path.slice(1)
    : parent.slice(0, parent.lastIndexOf("/") + 1) + path;
  for (const part of decodeURIComponent(source)
    .replaceAll("\\", "/")
    .split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("Invalid 3MF component path.");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
function matrixOf(text: string | null, unit: number) {
  if (!text) return new THREE.Matrix4();
  const n = text.trim().split(/\s+/).map(Number);
  if (n.length !== 12 || !n.every(Number.isFinite))
    throw new Error("Invalid 3MF transform.");
  return new THREE.Matrix4().set(
    n[0],
    n[3],
    n[6],
    n[9] * unit,
    n[1],
    n[4],
    n[7],
    n[10] * unit,
    n[2],
    n[5],
    n[8],
    n[11] * unit,
    0,
    0,
    0,
    1,
  );
}
function metadata(node?: Element) {
  return Object.fromEntries(
    node
      ? children(node, "metadata").map((n) => [
          n.getAttribute("key") ?? n.getAttribute("name"),
          n.getAttribute("value") ?? n.textContent ?? "",
        ])
      : [],
  );
}
export function import3mf(
  bytes: Uint8Array,
  name: string,
  plate: number,
): ModelImport {
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (e) => {
      if (!/\.(model|rels|config)$/i.test(e.name)) return false;
      total += e.originalSize;
      if (total > 200 * 1024 * 1024)
        throw new Error("Expanded 3MF geometry exceeds 200 MB.");
      return true;
    },
  });
  const paths = Object.keys(files).filter((p) => p.endsWith(".model"));
  const rels = files["_rels/.rels"] ? documentOf(files["_rels/.rels"]) : null;
  const link = Array.from(
    rels?.getElementsByTagNameNS("*", "Relationship") ?? [],
  )
    .find((r) => r.getAttribute("Type")?.endsWith("/3dmodel"))
    ?.getAttribute("Target");
  const rootPath = link
    ? pathOf(link)
    : (paths.find((p) => /3dmodel\.model$/i.test(p)) ?? paths[0]);
  if (!rootPath || !files[rootPath])
    throw new Error("The 3MF is missing its root model.");
  const docs = new Map<
    string,
    { root: Element; objects: Map<string, Element>; unit: number }
  >();
  function modelFile(path: string) {
    if (docs.has(path)) return docs.get(path)!;
    if (!files[path]) throw new Error(`Missing 3MF component: ${path}`);
    const root = documentOf(files[path]).documentElement;
    const unitName = root.getAttribute("unit") ?? "millimeter";
    const unit = (
      {
        micron: 0.001,
        millimeter: 1,
        centimeter: 10,
        inch: 25.4,
        foot: 304.8,
        meter: 1000,
      } as Record<string, number>
    )[unitName];
    if (!unit) throw new Error(`Unsupported 3MF unit: ${unitName}`);
    const resources = child(root, "resources");
    if (!resources) throw new Error("The 3MF has no object resources.");
    const objects = new Map(
      children(resources, "object").map((n) => [n.getAttribute("id")!, n]),
    );
    const doc = { root, objects, unit };
    docs.set(path, doc);
    return doc;
  }
  const palette: ImportedMaterial[] = [];
  const warnings: string[] = [];
  let hasMaterials = false;
  if (files["Metadata/project_settings.config"]) {
    try {
      const p = JSON.parse(
        strFromU8(files["Metadata/project_settings.config"]),
      );
      if (Array.isArray(p.filament_colour) && p.filament_colour.length <= 64)
        for (const [i, c] of p.filament_colour.entries()) {
          hasMaterials = true;
          palette.push({
            color: /^#[\da-f]{6}$/i.test(c) ? c : "#91ad87",
            name:
              typeof p.filament_settings_id?.[i] === "string"
                ? p.filament_settings_id[i]
                : `Filament ${i + 1}`,
            material:
              typeof p.filament_type?.[i] === "string"
                ? p.filament_type[i]
                : undefined,
          });
        }
    } catch {
      warnings.push(
        "The 3MF filament settings could not be read; geometry and explicit part assignments were retained.",
      );
    }
  }
  const ensureTool = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= 64)
      throw new Error("3MF filament slots must be between 1 and 64.");
    while (palette.length <= index)
      palette.push({
        name: `Filament ${palette.length + 1}`,
        color: ["#91ad87", "#86a5bd", "#d0866e", "#e1bd56"][palette.length % 4],
      });
    return index;
  };
  const colorTool = (color: string, title: string) => {
    hasMaterials = true;
    color = /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color)
      ? color.slice(0, 7).toLowerCase()
      : "#91ad87";
    let index = palette.findIndex((f) => f.color.toLowerCase() === color);
    if (index < 0) {
      index = palette.length;
      ensureTool(index);
      palette[index] = { color, name: title || `Filament ${index + 1}` };
    }
    return index;
  };
  const settingsObjects = new Map<string, Element>();
  if (files["Metadata/model_settings.config"]) {
    const config = documentOf(files["Metadata/model_settings.config"]);
    for (const object of Array.from(config.getElementsByTagName("object")))
      settingsObjects.set(object.getAttribute("id")!, object);
  }
  const models: Model[] = [];
  let triangleCount = 0;
  function visit(
    path: string,
    id: string,
    transform: THREE.Matrix4,
    assemblyId: string,
    rootId: string,
    inheritedTool: number | undefined,
    stack: Set<string>,
    depth: number,
  ) {
    const key = `${path}#${id}`;
    if (depth > 64 || stack.has(key))
      throw new Error(
        "The 3MF contains cyclic or excessively nested components.",
      );
    const doc = modelFile(path),
      object = doc.objects.get(id);
    if (!object) throw new Error(`The 3MF references missing object ${id}.`);
    if (object.getAttribute("type") && object.getAttribute("type") !== "model")
      return;
    const rootSettings = settingsObjects.get(rootId);
    const part = rootSettings
      ? children(rootSettings, "part").find((p) => p.getAttribute("id") === id)
      : undefined;
    if (
      part &&
      /modifier|support|negative/.test(part.getAttribute("subtype") ?? "")
    ) {
      warnings.push(
        `Skipped non-printable modifier ${metadata(part).name || id}.`,
      );
      return;
    }
    const meta = {
      ...metadata(rootSettings),
      ...metadata(object),
      ...metadata(part),
    };
    const explicit = Number(meta.extruder);
    if (Number.isInteger(explicit) && explicit > 1) hasMaterials = true;
    const tool =
      Number.isInteger(explicit) && explicit > 0
        ? ensureTool(explicit - 1)
        : inheritedTool;
    const mesh = child(object, "mesh");
    if (mesh) {
      const vertices = child(mesh, "vertices"),
        triangles = child(mesh, "triangles");
      if (!vertices || !triangles)
        throw new Error("The 3MF mesh is missing vertices or triangles.");
      const points = children(vertices, "vertex").map((v) => {
        const p = new THREE.Vector3(
          Number(v.getAttribute("x")),
          Number(v.getAttribute("y")),
          Number(v.getAttribute("z")),
        );
        if (!p.toArray().every(Number.isFinite))
          throw new Error("The 3MF has invalid coordinates.");
        return p.multiplyScalar(doc.unit).applyMatrix4(transform);
      });
      const faces = children(triangles, "triangle");
      triangleCount += faces.length;
      if (triangleCount > 2_000_000 || models.length >= 200)
        throw new Error("The 3MF exceeds two million triangles or 200 parts.");
      const positions = new Float32Array(faces.length * 9),
        faceTools = new Uint8Array(faces.length);
      let painted = false;
      let surfaceTriangles: number[] | undefined,
        surfaceTools: number[] = [];
      const resources = child(doc.root, "resources")!;
      for (const [index, face] of faces.entries()) {
        const ids = ["v1", "v2", "v3"].map((k) => Number(face.getAttribute(k)));
        if (
          !ids.every((i) => Number.isInteger(i) && i >= 0 && i < points.length)
        )
          throw new Error("Invalid 3MF triangle index.");
        const originalPoints = ids.map(
          (id) => points[id].toArray() as Vec3,
        ) as [Vec3, Vec3, Vec3];
        if (transform.determinant() < 0) [ids[1], ids[2]] = [ids[2], ids[1]];
        ids.forEach((id, j) =>
          points[id].toArray(positions, index * 9 + j * 3),
        );
        let faceTool = tool ?? 0;
        let vertexTools: number[] | undefined;
        const pid = face.getAttribute("pid") ?? object.getAttribute("pid");
        if (pid) {
          const resource = Array.from(resources.children).find(
            (r) => r.getAttribute("id") === pid,
          );
          const properties = resource
            ? children(
                resource,
                resource.localName === "basematerials" ? "base" : "color",
              )
            : [];
          const p1 = Number(
              face.getAttribute("p1") ?? object.getAttribute("pindex") ?? 0,
            ),
            property = properties[p1];
          if (property)
            faceTool = colorTool(
              property.getAttribute("displaycolor") ??
                property.getAttribute("color") ??
                "#91ad87",
              property.getAttribute("name") ?? "",
            );
          const indices = [
            p1,
            Number(face.getAttribute("p2") ?? p1),
            Number(face.getAttribute("p3") ?? p1),
          ];
          if (indices.some((p) => p !== p1))
            vertexTools = indices.map((p) => {
              const prop = properties[p];
              if (!prop) throw new Error("Invalid 3MF vertex material index.");
              return colorTool(
                prop.getAttribute("displaycolor") ??
                  prop.getAttribute("color") ??
                  "#91ad87",
                prop.getAttribute("name") ?? "",
              );
            });
        }
        const paint =
          attr(face, "paint_color") ?? attr(face, "mmu_segmentation");
        let patches: PaintedTriangle[] | undefined;
        if (paint) {
          hasMaterials = true;
          patches = decodePaintTriangle(paint, originalPoints, faceTool);
        } else if (vertexTools) {
          // A physical filament cannot interpolate RGB: partition by the nearest vertex in barycentric space.
          const center = [0, 1, 2].map(
            (axis) => originalPoints.reduce((n, p) => n + p[axis], 0) / 3,
          ) as Vec3;
          patches = originalPoints.flatMap((a, i) => {
            const b = originalPoints[(i + 1) % 3],
              c = originalPoints[(i + 2) % 3];
            const ab = a.map((v, j) => (v + b[j]) / 2) as Vec3,
              ac = a.map((v, j) => (v + c[j]) / 2) as Vec3;
            return [
              {
                points: [a, ab, center] as [Vec3, Vec3, Vec3],
                tool: vertexTools![i],
              },
              {
                points: [a, center, ac] as [Vec3, Vec3, Vec3],
                tool: vertexTools![i],
              },
            ];
          });
          warnings.push(
            "Interpolated vertex colors were divided into discrete filament regions.",
          );
        }
        if (patches && !surfaceTriangles) {
          surfaceTriangles = Array.from(positions.subarray(0, index * 9));
          surfaceTools = Array.from(faceTools.subarray(0, index));
        }
        if (surfaceTriangles) {
          for (const patch of patches ?? [
            { points: originalPoints, tool: faceTool },
          ]) {
            const points = [...patch.points];
            if (transform.determinant() < 0)
              [points[1], points[2]] = [points[2], points[1]];
            if (surfaceTools.length >= 2_000_000)
              throw new Error(
                "Painted 3MF exceeds two million surface triangles.",
              );
            surfaceTriangles.push(...points.flat());
            surfaceTools.push(ensureTool(patch.tool));
          }
        }
        faceTools[index] = ensureTool(faceTool);
        if (index && faceTools[index] !== faceTools[0]) painted = true;
      }
      const selectedTool = faces.length ? faceTools[0] : ensureTool(tool ?? 0);
      if (positions.length)
        models.push({
          id: newId(),
          name:
            meta.name ||
            object.getAttribute("name") ||
            `${name} · part ${models.length + 1}`,
          positions,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          color: palette[selectedTool].color,
          tool: selectedTool,
          faceTools: surfaceTriangles
            ? new Uint8Array(surfaceTools)
            : painted
              ? faceTools
              : undefined,
          paintTriangles: surfaceTriangles
            ? new Float32Array(surfaceTriangles)
            : undefined,
          assemblyId,
          visible: true,
          plate,
        });
    }
    const components = child(object, "components");
    if (components) {
      const nextStack = new Set(stack).add(key);
      for (const component of children(components, "component")) {
        const target = attr(component, "path");
        visit(
          target ? pathOf(target, path) : path,
          component.getAttribute("objectid")!,
          transform
            .clone()
            .multiply(matrixOf(component.getAttribute("transform"), doc.unit)),
          assemblyId,
          rootId,
          tool,
          nextStack,
          depth + 1,
        );
      }
    }
  }
  const root = modelFile(rootPath),
    build = child(root.root, "build");
  if (!build) throw new Error("The 3MF has no build items.");
  for (const item of children(build, "item")) {
    if (
      item.getAttribute("printable") === "0" ||
      item.getAttribute("printable") === "false"
    )
      continue;
    const id = item.getAttribute("objectid")!,
      assembly = newId(),
      before = models.length;
    visit(
      rootPath,
      id,
      matrixOf(item.getAttribute("transform"), root.unit),
      assembly,
      id,
      undefined,
      new Set(),
      0,
    );
    const parts = models.slice(before),
      bounds = new THREE.Box3(),
      point = new THREE.Vector3();
    for (const m of parts)
      for (let i = 0; i < m.positions.length; i += 3)
        bounds.expandByPoint(point.fromArray(m.positions, i));
    const center = bounds.getCenter(new THREE.Vector3());
    for (const m of parts) {
      for (let i = 0; i < m.positions.length; i += 3) {
        m.positions[i] -= center.x;
        m.positions[i + 1] -= center.y;
        m.positions[i + 2] -= bounds.min.z;
      }
      if (m.paintTriangles)
        for (let i = 0; i < m.paintTriangles.length; i += 3) {
          m.paintTriangles[i] -= center.x;
          m.paintTriangles[i + 1] -= center.y;
          m.paintTriangles[i + 2] -= bounds.min.z;
        }
      m.position = [center.x, center.y, bounds.min.z] as Vec3;
      if (parts.length === 1) m.assemblyId = undefined;
    }
  }
  if (!models.length)
    throw new Error("No printable mesh was found in this 3MF.");
  return {
    models,
    palette: hasMaterials ? palette : [],
    warnings: [...new Set(warnings)],
  };
}
