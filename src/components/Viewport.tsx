import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Model, Printer, SliceResult, Vec3 } from "../types";
import { FEATURE_COLORS } from "../types";
import { geometryOf } from "../lib/geometry";
import { Button, Alert } from "@mantine/core";
export type ViewTool = "select" | "translate" | "rotate" | "scale";
export interface ViewportProps {
  models: Model[];
  printer: Printer;
  selected: string | null;
  onSelect: (id: string | null) => void;
  tool: ViewTool;
  onTransform: (id: string, patch: Partial<Model>) => void;
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
    transform.addEventListener("change", () => {
      const mesh = transform.object;
      if (mesh) selection.box.setFromObject(mesh);
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
    });
    const raycaster = new THREE.Raycaster();
    let down = { x: 0, y: 0 };
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const pointerUp = (e: PointerEvent) => {
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
    const resize = new ResizeObserver(() => {
      const w = node.clientWidth,
        h = node.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
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
      let mesh = s.models.children.find((c) => c.userData.id === m.id) as
        THREE.Mesh | undefined;
      if (!mesh) {
        mesh = new THREE.Mesh(
          geometryOf(m.positions),
          new THREE.MeshStandardMaterial({
            color: m.color,
            roughness: 0.58,
            metalness: 0.03,
            side: THREE.DoubleSide,
          }),
        );
        mesh.userData = { id: m.id, positions: m.positions };
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        s.models.add(mesh);
      } else if (mesh.userData.positions !== m.positions) {
        mesh.geometry.dispose();
        mesh.geometry = geometryOf(m.positions);
        mesh.userData.positions = m.positions;
      }
      mesh.position.set(...m.position);
      mesh.rotation.set(
        ...(m.rotation.map((n) => (n * Math.PI) / 180) as Vec3),
      );
      mesh.scale.set(...m.scale);
      mesh.visible = m.visible;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(m.color);
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
    if (selected) s.selection.box.setFromObject(selected);
    if (selected && props.tool !== "select" && !props.preview) {
      s.transform.setMode(props.tool);
      s.transform.attach(selected);
    } else s.transform.detach();
    s.dirty();
  }, [
    props.models,
    props.selected,
    props.tool,
    props.preview,
    props.wireframe,
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
                ? props.printer.bed[0] / 2
                : k % 3 === 1
                  ? props.printer.bed[1] / 2
                  : 0),
          );
        if (props.colorMode === "speed")
          c.setHSL(
            0.65 - Math.min(layer.speeds[i] / 150, 1) * 0.65,
            0.65,
            0.55,
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
    const v = props.viewCommand.view;
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
