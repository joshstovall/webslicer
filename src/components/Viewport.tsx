import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Model, Printer, SliceResult, Vec3 } from "../types";
import { FEATURE_COLORS } from "../types";
import { geometryOf } from "../lib/geometry";
import { Button, Alert } from "@mantine/core";
import type { PaintStroke } from "../lib/surface-paint";
import type { PaintSettings } from "./PaintPanel";
export type ViewTool = "select" | "translate" | "rotate" | "scale" | "paint";
export interface ViewportProps {
  models: Model[];
  printer: Printer;
  selected: string | null;
  onSelect: (id: string | null) => void;
  tool: ViewTool;
  transformWholeAssembly?: boolean;
  onTransform: (id: string, patch: Partial<Model>) => void;
  paint?: PaintSettings;
  filamentColors?: string[];
  onPaint?: (id: string, stroke: PaintStroke, first: boolean) => void;
  viewCommand: { view: string; tick: number };
  result: SliceResult | null;
  preview: boolean;
  layer: number;
  singleLayer: boolean;
  showTravel: boolean;
  hiddenFeatures: number[];
  colorMode: string;
  wireframe: boolean;
  onReady?: () => void;
}
export function Viewport(props: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState("");
  const state = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    orbit: OrbitControls;
    transform: TransformControls;
    models: THREE.Group;
    bed: THREE.Group;
    paths: THREE.Group;
    selection: THREE.Box3Helper;
    dirty: () => void;
  } | null>(null);
  useEffect(() => {
    const node = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      setError(
        "WebGL is unavailable. Enable hardware acceleration or use a browser with WebGL support.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0xeff0eb, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    node.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(36, 1, 0.1, 4000);
    camera.up.set(0, 0, 1);
    camera.position.set(240, -310, 270);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x65715e, 2.4));
    const sun = new THREE.DirectionalLight(0xfffaf0, 3);
    sun.position.set(-100, -100, 300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -200;
    sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200;
    sun.shadow.camera.bottom = -200;
    sun.shadow.bias = -0.0003;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 1.3);
    fill.position.set(130, 100, 120);
    scene.add(fill);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, 25);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.12;
    orbit.maxPolarAngle = Math.PI * 0.49;
    orbit.minDistance = 20;
    orbit.maxDistance = 1800;
    orbit.touches.ONE = THREE.TOUCH.ROTATE;
    orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    orbit.update();
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.75);
    scene.add(transform.getHelper());
    const models = new THREE.Group(),
      bed = new THREE.Group(),
      paths = new THREE.Group();
    scene.add(models, bed, paths);
    const selection = new THREE.Box3Helper(new THREE.Box3(), 0x71976b);
    scene.add(selection);
    selection.visible = false;
    let needsRender = true;
    const dirty = () => {
      needsRender = true;
    };
    orbit.addEventListener("change", dirty);
    const dragMatrices = new Map<THREE.Object3D, THREE.Matrix4>();
    let dragInverse = new THREE.Matrix4();
    const updateSelection = (mesh: THREE.Object3D) => {
      selection.box.setFromObject(mesh);
      if (latest.current.transformWholeAssembly && mesh.userData.assemblyId)
        for (const part of models.children)
          if (part.userData.assemblyId === mesh.userData.assemblyId)
            selection.box.union(new THREE.Box3().setFromObject(part));
    };
    transform.addEventListener("change", () => {
      const mesh = transform.object;
      if (mesh) updateSelection(mesh);
      dirty();
    });
    transform.addEventListener("mouseDown", () => {
      dragMatrices.clear();
      const mesh = transform.object;
      if (
        !mesh ||
        !latest.current.transformWholeAssembly ||
        !mesh.userData.assemblyId
      )
        return;
      mesh.updateMatrix();
      dragInverse = mesh.matrix.clone().invert();
      for (const part of models.children) {
        if (
          part !== mesh &&
          part.userData.assemblyId === mesh.userData.assemblyId
        ) {
          part.updateMatrix();
          dragMatrices.set(part, part.matrix.clone());
        }
      }
    });
    transform.addEventListener("objectChange", () => {
      const mesh = transform.object;
      if (!mesh) return;
      mesh.updateMatrix();
      const delta = mesh.matrix.clone().multiply(dragInverse);
      for (const [part, original] of dragMatrices) {
        part.matrixAutoUpdate = false;
        part.matrix.copy(delta).multiply(original);
        part.updateMatrixWorld(true);
      }
      updateSelection(mesh);
      dirty();
    });
    transform.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !e.value;
    });
    transform.addEventListener("mouseUp", () => {
      const o = transform.object;
      if (!o) return;
      latest.current.onTransform(o.userData.id, {
        position: o.position.toArray() as Vec3,
        rotation: [o.rotation.x, o.rotation.y, o.rotation.z].map(
          (n) => (n * 180) / Math.PI,
        ) as Vec3,
        scale: o.scale.toArray() as Vec3,
      });
      dragMatrices.clear();
    });
    const raycaster = new THREE.Raycaster();
    const pointers = new Set<number>();
    let painting = false,
      firstDab = true,
      multiTouch = false,
      lastDab = 0;
    const brushRing = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 48),
      new THREE.MeshBasicMaterial({
        color: "#293e24",
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    brushRing.name = "paint-brush";
    brushRing.visible = false;
    brushRing.renderOrder = 10;
    scene.add(brushRing);
    function pick(e: PointerEvent) {
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      return raycaster
        .intersectObjects(models.children)
        .find((h) => h.object.visible);
    }
    function dab(e: PointerEvent, apply: boolean) {
      const p = latest.current;
      if (p.tool !== "paint" || p.preview || !p.paint) {
        brushRing.visible = false;
        return;
      }
      const hit = pick(e);
      if (!hit?.face) {
        brushRing.visible = false;
        dirty();
        return;
      }
      const normal = hit.face.normal
        .clone()
        .applyMatrix3(
          new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld),
        )
        .normalize();
      brushRing.position.copy(hit.point).addScaledVector(normal, 0.02);
      brushRing.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        normal,
      );
      brushRing.scale.setScalar(p.paint.radius);
      brushRing.visible = p.paint.mode === "brush";
      dirty();
      if (!apply) return;
      const model = p.models.find((m) => m.id === hit.object.userData.id);
      if (!model) return;
      p.onPaint?.(
        model.id,
        {
          point: hit.point.toArray() as Vec3,
          normal: normal.toArray() as Vec3,
          ...p.paint,
          sourceTool: model.faceTools?.[hit.faceIndex ?? 0] ?? model.tool ?? 0,
        },
        firstDab,
      );
      firstDab = false;
      lastDab = performance.now();
    }
    let down = { x: 0, y: 0 };
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      pointers.add(e.pointerId);
      if (pointers.size > 1) {
        multiTouch = true;
        painting = false;
        return;
      }
      multiTouch = false;
      firstDab = true;
      painting = latest.current.tool === "paint" && e.button === 0;
      if (painting) {
        renderer.domElement.setPointerCapture(e.pointerId);
        if (e.pointerType !== "touch") dab(e, true);
      }
    };
    const pointerMove = (e: PointerEvent) => {
      if (pointers.size > 1 || multiTouch) return;
      dab(e, painting && performance.now() - lastDab > 80);
    };
    const pointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (latest.current.tool === "paint") {
        if (painting && !multiTouch) dab(e, firstDab);
        painting = false;
        if (!pointers.size) multiTouch = false;
        return;
      }
      if (
        latest.current.preview ||
        transform.dragging ||
        transform.axis ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5
      )
        return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster
        .intersectObjects(models.children)
        .find((h) => h.object.visible);
      latest.current.onSelect(hit ? hit.object.userData.id : null);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointercancel", (e) => {
      pointers.delete(e.pointerId);
      painting = false;
      brushRing.visible = false;
      dirty();
    });
    renderer.domElement.addEventListener("pointerleave", () => {
      brushRing.visible = false;
      dirty();
    });
    const resize = new ResizeObserver(() => {
      const w = node.clientWidth,
        h = node.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      if (latest.current.tool === "paint" && w < 761)
        camera.setViewOffset(w, h, 0, -h * 0.18, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      dirty();
    });
    resize.observe(node);
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      orbit.update();
      if (needsRender) {
        renderer.render(scene, camera);
        needsRender = false;
      }
    };
    render();
    state.current = {
      scene,
      camera,
      renderer,
      orbit,
      transform,
      models,
      bed,
      paths,
      selection,
      dirty,
    };
    props.onReady?.();
    const lost = (e: Event) => {
      e.preventDefault();
      setError(
        "The graphics context was lost. Your project is saved locally. Reload to restore the workspace.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      orbit.dispose();
      transform.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      state.current = null;
    };
  }, []);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    clearGroup(s.bed);
    const [w, d] = props.printer.bed;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(w, d, 3),
      new THREE.MeshStandardMaterial({
        color: "#535d53",
        roughness: 0.85,
        metalness: 0.12,
      }),
    );
    plate.position.z = -1.65;
    plate.receiveShadow = true;
    s.bed.add(plate);
    const lines: number[] = [];
    for (let x = -w / 2; x <= w / 2; x += 10)
      lines.push(x, -d / 2, 0.03, x, d / 2, 0.03);
    for (let y = -d / 2; y <= d / 2; y += 10)
      lines.push(-w / 2, y, 0.03, w / 2, y, 0.03);
    const grid = new THREE.BufferGeometry();
    grid.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    s.bed.add(
      new THREE.LineSegments(
        grid,
        new THREE.LineBasicMaterial({
          color: "#98a38f",
          transparent: true,
          opacity: 0.27,
        }),
      ),
    );
    const border = new THREE.EdgesGeometry(plate.geometry);
    const outline = new THREE.LineSegments(
      border,
      new THREE.LineBasicMaterial({ color: "#88967f" }),
    );
    outline.position.copy(plate.position);
    s.bed.add(outline);
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c2ccba";
    ctx.font = "500 44px monospace";
    ctx.textAlign = "center";
    ctx.fillText("S T R A T U M   /   BUILD PLATE", 512, 78);
    const texture = new THREE.CanvasTexture(canvas);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.7, (w * 0.7) / 8),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    label.position.set(0, -d / 2 + 10, 0.05);
    s.bed.add(label);
    const axes = new THREE.AxesHelper(18);
    axes.position.set(-w / 2, -d / 2, 0);
    s.bed.add(axes);
    s.dirty();
  }, [props.printer.bed]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const ids = new Set(props.models.map((m) => m.id));
    for (const child of [...s.models.children])
      if (!ids.has(child.userData.id)) {
        s.models.remove(child);
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    for (const m of props.models) {
      const surface = m.paintTriangles ?? m.positions;
      let mesh = s.models.children.find((c) => c.userData.id === m.id) as
        THREE.Mesh | undefined;
      if (!mesh) {
        mesh = new THREE.Mesh(
          geometryOf(surface),
          new THREE.MeshStandardMaterial({
            color: m.color,
            roughness: 0.58,
            metalness: 0.03,
            side: THREE.DoubleSide,
          }),
        );
        mesh.userData = { id: m.id, positions: surface };
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        s.models.add(mesh);
      } else if (mesh.userData.positions !== surface) {
        mesh.geometry.dispose();
        mesh.geometry = geometryOf(surface);
        mesh.userData.positions = surface;
      }
      mesh.userData.assemblyId = m.assemblyId;
      mesh.matrixAutoUpdate = true;
      mesh.position.set(...m.position);
      mesh.rotation.set(
        ...(m.rotation.map((n) => (n * Math.PI) / 180) as Vec3),
      );
      mesh.scale.set(...m.scale);
      mesh.visible = m.visible;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (m.faceTools) {
        const paletteKey = props.filamentColors?.join(",");
        if (
          mesh.userData.faceTools !== m.faceTools ||
          mesh.userData.palette !== paletteKey ||
          !mesh.geometry.hasAttribute("color")
        ) {
          const colors = new Float32Array(surface.length),
            color = new THREE.Color();
          for (let face = 0; face < m.faceTools.length; face++) {
            color.set(props.filamentColors?.[m.faceTools[face]] ?? m.color);
            for (let v = 0; v < 3; v++) color.toArray(colors, face * 9 + v * 3);
          }
          mesh.geometry.setAttribute(
            "color",
            new THREE.BufferAttribute(colors, 3),
          );
          mesh.userData.faceTools = m.faceTools;
          mesh.userData.palette = paletteKey;
        }
        mat.color.set("#ffffff");
        mat.vertexColors = true;
      } else {
        mat.color.set(m.color);
        mat.vertexColors = false;
      }
      mat.needsUpdate = true;
      mat.wireframe = props.wireframe;
      mat.emissive.set(m.id === props.selected ? "#172315" : "#000000");
      mat.emissiveIntensity = 0.15;
      mesh.updateMatrixWorld();
    }
    s.models.visible = !props.preview;
    const selected = s.models.children.find(
      (m) => m.userData.id === props.selected && m.visible,
    );
    s.selection.visible = !!selected && !props.preview;
    if (selected) {
      s.selection.box.setFromObject(selected);
      if (props.transformWholeAssembly && selected.userData.assemblyId)
        for (const part of s.models.children)
          if (part.userData.assemblyId === selected.userData.assemblyId)
            s.selection.box.union(new THREE.Box3().setFromObject(part));
    }
    if (
      selected &&
      props.tool !== "select" &&
      props.tool !== "paint" &&
      !props.preview
    ) {
      s.transform.setMode(props.tool);
      s.transform.attach(selected);
    } else s.transform.detach();
    s.orbit.mouseButtons.LEFT =
      props.tool === "paint" ? null : THREE.MOUSE.ROTATE;
    s.orbit.mouseButtons.RIGHT =
      props.tool === "paint" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    s.orbit.touches.ONE = props.tool === "paint" ? null : THREE.TOUCH.ROTATE;
    s.orbit.touches.TWO =
      props.tool === "paint" ? THREE.TOUCH.DOLLY_ROTATE : THREE.TOUCH.DOLLY_PAN;
    s.renderer.domElement.style.cursor =
      props.tool === "paint" ? "crosshair" : "";
    const width = host.current!.clientWidth,
      height = host.current!.clientHeight;
    if (props.tool === "paint" && width < 761)
      s.camera.setViewOffset(width, height, 0, -height * 0.18, width, height);
    else s.camera.clearViewOffset();
    if (props.tool !== "paint")
      s.scene.getObjectByName("paint-brush")!.visible = false;
    s.dirty();
  }, [
    props.models,
    props.selected,
    props.tool,
    props.preview,
    props.wireframe,
    props.transformWholeAssembly,
  ]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    clearGroup(s.paths);
    if (!props.preview || !props.result) {
      s.dirty();
      return;
    }
    const layers = props.result.layers;
    const end = Math.min(props.layer, layers.length - 1),
      start = props.singleLayer ? end : 0;
    const positions: number[] = [],
      colors: number[] = [];
    const c = new THREE.Color();
    for (let l = start; l <= end; l++) {
      const layer = layers[l];
      if (!layer) continue;
      for (let i = 0; i < layer.features.length; i++) {
        const feature = layer.features[i];
        if (
          (feature === 4 && !props.showTravel) ||
          props.hiddenFeatures.includes(feature)
        )
          continue;
        const a = i * 6;
        for (let k = 0; k < 6; k++)
          positions.push(
            layer.segments[a + k] -
              (k % 3 === 0
                ? props.printer.bed[0] / 2 + (props.printer.bedOrigin?.[0] ?? 0)
                : k % 3 === 1
                  ? props.printer.bed[1] / 2 +
                    (props.printer.bedOrigin?.[1] ?? 0)
                  : 0),
          );
        if (props.colorMode === "speed")
          c.setHSL(
            0.65 - Math.min(layer.speeds[i] / 150, 1) * 0.65,
            0.65,
            0.55,
          );
        else if (props.colorMode === "filament" && feature !== 4)
          c.set(
            props.result.tools.find((t) => t.tool === layer.tools[i])?.color ??
              "#91ad87",
          );
        else c.set(FEATURE_COLORS[feature]);
        if (!props.singleLayer && l !== end) c.multiplyScalar(0.9);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    s.paths.add(
      new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ vertexColors: true }),
      ),
    );
    s.dirty();
  }, [
    props.result,
    props.preview,
    props.layer,
    props.singleLayer,
    props.showTravel,
    props.hiddenFeatures,
    props.colorMode,
    props.printer.bed,
  ]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const radius = Math.max(...props.printer.bed) * 1.8;
    const paintView = props.viewCommand.view.startsWith("paint-");
    const v = props.viewCommand.view.replace(/^paint-/, "");
    if (paintView) {
      const selected = s.models.children.find(
        (m) => m.userData.id === props.selected,
      );
      const box = new THREE.Box3().setFromObject(selected ?? s.models);
      const center = box.getCenter(new THREE.Vector3()),
        distance = Math.max(
          box.getSize(new THREE.Vector3()).length() * 2.5,
          45,
        );
      const direction =
        v === "top"
          ? new THREE.Vector3(0, -0.001, 1)
          : v === "front"
            ? new THREE.Vector3(0, -1, 0.001)
            : v === "right"
              ? new THREE.Vector3(1, 0, 0.001)
              : new THREE.Vector3(1, -1.3, 1);
      s.orbit.target.copy(center);
      s.camera.position
        .copy(center)
        .add(direction.normalize().multiplyScalar(distance));
      s.orbit.update();
      s.dirty();
      return;
    }
    s.orbit.target.set(0, 0, 25);
    if (v === "top") s.camera.position.set(0, -0.01, radius);
    else if (v === "front") s.camera.position.set(0, -radius, 26);
    else if (v === "right") s.camera.position.set(radius, 0, 26);
    else if (v === "fit") {
      const box = new THREE.Box3().setFromObject(s.models);
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3()),
          size = box.getSize(new THREE.Vector3()).length();
        s.orbit.target.copy(center);
        s.camera.position
          .copy(center)
          .add(
            new THREE.Vector3(1, -1.3, 1)
              .normalize()
              .multiplyScalar(Math.max(size * 2, 60)),
          );
      }
    } else s.camera.position.set(radius * 0.6, -radius * 0.8, radius * 0.65);
    s.orbit.update();
    s.dirty();
  }, [props.viewCommand]);
  return (
    <div className="viewport-host" ref={host} data-testid="viewport">
      {error && (
        <div className="webgl-error">
          <Alert color="red" title="3D view unavailable">
            {error}
            <Button mt="md" onClick={() => location.reload()}>
              Reload workspace
            </Button>
          </Alert>
        </div>
      )}
    </div>
  );
}
function clearGroup(group: THREE.Group) {
  for (const c of [...group.children]) {
    group.remove(c);
    c.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const m = Array.isArray(o.material) ? o.material : [o.material];
        m.forEach((mat) => {
          if ("map" in mat) (mat.map as THREE.Texture | null)?.dispose();
          mat.dispose();
        });
      }
    });
  }
}
