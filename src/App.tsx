import { ModifierPanel } from "./components/ModifierPanel";
import type { ModifierMesh } from "./types";
import { validManualLayerSettings } from "./lib/layer-height";
import { applyPrinter, VENDOR_NOZZLES } from "./lib/nozzle-profiles";
import { PrinterHardware } from "./components/PrinterHardware";
import { readGcodeMetadata } from "./lib/gcode-metadata";
import {
  assemblyParts,
  duplicateAssembly,
  updateAssembly,
  partsBounds,
} from "./lib/assemblies";
import { bindImportedMaterials } from "./lib/import-materials";
import { editModelSelection } from "./lib/material-edits";
import type { MaterialEdit } from "./lib/edit-material-regions";
import { paintSurface, type PaintStroke } from "./lib/surface-paint";
import { paintSupportSurface } from "./lib/support-paint";
import { PaintPanel, type PaintSettings } from "./components/PaintPanel";
import { AssemblyPanel } from "./components/AssemblyPanel";
import { newId } from "./lib/id";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  Menu,
  Modal,
  NumberInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  Grip,
  GitBranch,
  HelpCircle,
  Layers3,
  LayoutGrid,
  Link,
  Lock,
  Maximize,
  MoreHorizontal,
  MousePointer2,
  Move3D,
  PanelLeft,
  Paintbrush,
  Play,
  Plus,
  Printer,
  Redo2,
  Rotate3D,
  RotateCcw,
  Save,
  Scaling,
  Scissors,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Undo2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import type {
  Model,
  Printer as PrinterType,
  Project,
  Settings,
  SliceResult,
  Vec3,
} from "./types";
import { FEATURE_COLORS, FEATURE_NAMES } from "./types";
import { DEFAULT_SETTINGS, PRINTERS } from "./lib/profiles";
import {
  arrangeModels,
  boundsOf,
  COLORS,
  dimensions,
  exportSTL,
  groundModel,
  importModelFile,
  modelVolume,
  primitive,
  validatePlate,
} from "./lib/geometry";
import {
  download,
  loadLocal,
  readProject,
  saveLocal,
  saveProject,
} from "./lib/project";
import { formatDuration, parseGcode } from "./lib/gcode";
import { slicePlate } from "./lib/slicer";
import { Viewport } from "./components/Viewport";
import type { ViewTool } from "./components/Viewport";
import {
  createPrintPackage,
  printThumbnails,
  readPrintPackage,
} from "./lib/print-package";
import { loadVendorPrinter } from "./lib/vendor-printers";
import { FilamentPanel } from "./components/FilamentPanel";
import { defaultFilament, DEFAULT_MULTI_MATERIAL } from "./lib/multimaterial";
import {
  applySettingsPatch,
  settingsForFilament,
} from "./lib/material-settings";
import { SettingsPanel } from "./components/SettingsPanel";
const initialProject = (): Project => ({
  version: 1,
  name: "Helix planter",
  models: [primitive("vase", 1)],
  printer: structuredClone(PRINTERS[0]),
  settings: { ...DEFAULT_SETTINGS },
  plates: [1],
  activePlate: 1,
});
function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <ActionIcon
        aria-label={label}
        onClick={onClick}
        variant={active ? "light" : "subtle"}
        color={active ? "forest" : "gray"}
        size={38}
        disabled={disabled}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  );
}
function App() {
  const [project, setProject] = useState<Project>(initialProject),
    [selected, setSelected] = useState<string | null>(null),
    [hydrated, setHydrated] = useState(false),
    [saveStatus, setSaveStatus] = useState("Loading project");
  const projectRef = useRef(project);
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  projectRef.current = project;
  const history = useRef<Project[]>([]),
    future = useRef<Project[]>([]);
  const [, setHistoryVersion] = useState(0);
  const [transformWholeAssembly, setTransformWholeAssembly] = useState(true);
  const [tool, setTool] = useState<ViewTool>("select"),
    [preview, setPreview] = useState(false),
    [result, setResult] = useState<SliceResult | null>(null),
    [layer, setLayer] = useState(0),
    [singleLayer, setSingleLayer] = useState(false),
    [showTravel, setShowTravel] = useState(false),
    [hiddenFeatures, setHiddenFeatures] = useState<number[]>([]),
    [colorMode, setColorMode] = useState("feature");
  const [paint, setPaint] = useState<PaintSettings>({
    tool: 1,
    radius: 3,
    mode: "brush",
  });
  const [viewCommand, setViewCommand] = useState({ view: "home", tick: 0 }),
    [wireframe, setWireframe] = useState(false),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [progress, setProgress] = useState(0),
    [stage, setStage] = useState(""),
    [playing, setPlaying] = useState(false);
  const [modifierDraft, setModifierDraft] = useState<ModifierMesh[]>([]);
  const [modifierSelected, setModifierSelected] = useState("");
  const [modifierTool, setModifierTool] = useState<
    "translate" | "rotate" | "scale"
  >("translate");
  const [modifierCollapsed, setModifierCollapsed] = useState(false);
  const [modal, setModal] = useState<string | null>(null),
    [mobilePanel, setMobilePanel] = useState<"settings" | "objects" | null>(
      null,
    ),
    [locked, setLocked] = useState(true),
    [dragging, setDragging] = useState(false),
    [errors, setErrors] = useState<string[]>([]),
    [importing, setImporting] = useState(false),
    [loadingPrinter, setLoadingPrinter] = useState(false);
  const [loadingPackage, setLoadingPackage] = useState(false);
  const previewRequest = useRef(0);
  const [printerDraft, setPrinterDraft] = useState<PrinterType>(
      project.printer,
    ),
    [presetName, setPresetName] = useState("My print preset"),
    [presets, setPresets] = useState<{ name: string; settings: Settings }[]>(
      () => {
        try {
          const saved = JSON.parse(
            localStorage.getItem("stratum-presets") || "[]",
          );
          return Array.isArray(saved)
            ? saved.filter(
                (p) =>
                  p &&
                  typeof p.name === "string" &&
                  p.settings &&
                  typeof p.settings === "object" &&
                  validManualLayerSettings(p.settings),
              )
            : [];
        } catch {
          return [];
        }
      },
    );
  const [cutHeight, setCutHeight] = useState(20),
    [heightTool, setHeightTool] = useState("1"),
    [cutKeep, setCutKeep] = useState("both"),
    [cutFlip, setCutFlip] = useState(true);
  const [connection, setConnection] = useState({
      url: "",
      key: "",
      type: "octoprint",
      status: "",
      connected: false,
    }),
    [networkBusy, setNetworkBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    presetInput = useRef<HTMLInputElement>(null),
    abortRef = useRef<AbortController | null>(null);
  const filaments = useMemo(
    () => project.filaments ?? [defaultFilament(project.settings)],
    [project.filaments, project.settings],
  );
  const filamentColors = useMemo(
    () => filaments.map((f) => f.color),
    [filaments],
  );
  const multiMaterial = project.multiMaterial ?? DEFAULT_MULTI_MATERIAL;
  const viewportPrinter =
    preview && result?.source?.printer
      ? result.source.printer
      : project.printer;
  const archivePlate = preview
    ? result?.source?.plates?.find((p) => p.path === result.source?.platePath)
    : undefined;
  const usedTools = useMemo(() => {
    const tools = new Set<number>();
    for (const model of project.models) {
      tools.add(model.tool ?? 0);
      if (model.faceTools) for (const tool of model.faceTools) tools.add(tool);
    }
    return [...tools];
  }, [project.models]);
  const activeModels = useMemo(
      () => project.models.filter((m) => m.plate === project.activePlate),
      [project.models, project.activePlate],
    ),
    model = activeModels.find((m) => m.id === selected),
    size = model ? dimensions(model) : [0, 0, 0];
  const viewportModels = useMemo(
    () =>
      activeModels.map((m) =>
        filaments.length > 1
          ? { ...m, color: filaments[m.tool ?? 0]?.color ?? m.color }
          : m,
      ),
    [activeModels, filaments],
  );
  const viewportModifiers = useMemo(
    () =>
      modal === "modifiers" && model
        ? {
            modelId: model.id,
            modifiers: modifierDraft,
            selected: modifierSelected,
            tool: modifierTool,
            collapsed: modifierCollapsed,
          }
        : undefined,
    [
      modal,
      model,
      modifierDraft,
      modifierSelected,
      modifierTool,
      modifierCollapsed,
    ],
  );
  const notify = (message: string, color = "forest") =>
    notifications.show({ message, color, autoClose: 4500 });
  const commit = useCallback(
    (next: Project | ((p: Project) => Project), record = true) => {
      if (abortRef.current) return;
      previewRequest.current++;
      setLoadingPackage(false);
      const old = projectRef.current;
      const p = typeof next === "function" ? next(old) : next;
      if (record) history.current = [...history.current.slice(-39), old];
      future.current = [];
      projectRef.current = p;
      setProject(p);
      setHistoryVersion((v) => v + 1);
      setResult(null);
      setPreview(false);
      setErrors([]);
      setPlaying(false);
    },
    [],
  );
  const undo = useCallback(() => {
    if (abortRef.current || !history.current.length) return;
    previewRequest.current++;
    setLoadingPackage(false);
    const old = history.current.pop()!;
    future.current.push(projectRef.current);
    projectRef.current = old;
    setProject(old);
    setResult(null);
    setPreview(false);
    setHistoryVersion((v) => v + 1);
    setErrors([]);
  }, []);
  const redo = useCallback(() => {
    if (abortRef.current || !future.current.length) return;
    previewRequest.current++;
    setLoadingPackage(false);
    const p = future.current.pop()!;
    history.current.push(projectRef.current);
    projectRef.current = p;
    setProject(p);
    setResult(null);
    setPreview(false);
    setHistoryVersion((v) => v + 1);
    setErrors([]);
  }, []);
  useEffect(() => {
    let mounted = true;
    loadLocal()
      .then((p) => {
        if (!mounted) return;
        if (p) {
          setProject(p);
          projectRef.current = p;
          setSelected(
            p.models.find((m) => m.plate === p.activePlate)?.id || null,
          );
        } else setSelected(projectRef.current.models[0]?.id || null);
      })
      .catch(() => {
        if (mounted)
          notify(
            "The previous project could not be restored. You can open a saved project file.",
            "orange",
          );
      })
      .finally(() => {
        if (mounted) setHydrated(true);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    let current = true;
    setSaveStatus("Saving…");
    const t = setTimeout(
      () =>
        saveLocal(project)
          .then(() => {
            if (!current || projectRef.current !== project) return;
            setSavedProject(project);
            setSaveStatus("Saved on this device");
          })
          .catch(() => {
            if (current && projectRef.current === project)
              setSaveStatus("Storage full · download project");
          }),
      800,
    );
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [project, hydrated]);
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (!playing || !result) return;
    const t = setInterval(
      () =>
        setLayer((l) => {
          if (l >= result.layers.length - 1) {
            setPlaying(false);
            return l;
          }
          return l + 1;
        }),
      100,
    );
    return () => clearInterval(t);
  }, [playing, result]);
  function updateModel(patch: Partial<Model>, ground = false, id = selected) {
    if (!id) return;
    commit((p) => ({
      ...p,
      models: updateAssembly(
        p.models,
        id,
        patch,
        transformWholeAssembly,
        ground,
      ),
    }));
  }
  function paintModel(id: string, stroke: PaintStroke, first: boolean) {
    const source = projectRef.current.models.find((m) => m.id === id);
    if (!source || (paint.target !== "support" && !filaments[stroke.tool]))
      return;
    try {
      const patch =
        paint.target === "support"
          ? paintSupportSurface(source, stroke)
          : paintSurface(source, stroke);
      commit(
        (p) => ({
          ...p,
          models: p.models.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        }),
        first,
      );
      setSelected(id);
    } catch (error) {
      notify((error as Error).message, "red");
    }
  }
  function beginPainting() {
    setPaint((p) => ({
      ...p,
      target: "material",
      tool: Math.min(p.tool, filaments.length - 1),
    }));
    setTool("paint");
    setMobilePanel(null);
    view("paint-fit");
  }
  function beginSupportPainting() {
    setPaint((p) => ({ ...p, target: "support", tool: 1 }));
    setTool("paint");
    setMobilePanel(null);
    view("paint-bottom");
  }
  function removeModel(id = selected) {
    const selectedModel = project.models.find((m) => m.id === id);
    if (!selectedModel) return;
    const ids = new Set(
      (transformWholeAssembly
        ? assemblyParts(project.models, selectedModel)
        : [selectedModel]
      ).map((m) => m.id),
    );
    commit((p) => ({ ...p, models: p.models.filter((m) => !ids.has(m.id)) }));
    setSelected(null);
  }
  function duplicate() {
    if (!model) return;
    const copies = duplicateAssembly(
      project.models,
      model,
      transformWholeAssembly,
    );
    commit((p) => ({ ...p, models: [...p.models, ...copies] }));
    setSelected(
      copies.find((m) => m.name === `${model.name} copy`)?.id ?? copies[0].id,
    );
  }
  function arrange() {
    try {
      const arranged = arrangeModels(
        activeModels.filter(
          (m) =>
            m.visible ||
            (m.assemblyId &&
              activeModels.some(
                (n) => n.visible && n.assemblyId === m.assemblyId,
              )),
        ),
        project.printer,
      );
      commit((p) => ({
        ...p,
        models: p.models.map((m) => arranged.find((n) => n.id === m.id) || m),
      }));
      notify("Models arranged on the build plate.");
    } catch (e) {
      notify((e as Error).message, "orange");
    }
  }
  function addPrimitive(kind: string) {
    const m = primitive(kind, project.activePlate);
    m.color = COLORS[project.models.length % COLORS.length];
    let models = [...activeModels, m];
    try {
      models = arrangeModels(models, project.printer);
    } catch {
      m.position = [0, 0, 0];
    }
    commit((p) => ({
      ...p,
      models: [...p.models.filter((n) => n.plate !== p.activePlate), ...models],
    }));
    setSelected(m.id);
    setModal(null);
  }
  async function importFiles(files: FileList | File[]) {
    previewRequest.current++;
    setLoadingPackage(false);
    setImporting(true);
    try {
      const selectedFiles = Array.from(files);
      const materials = selectedFiles.filter((file) =>
        /\.mtl$/i.test(file.name),
      );
      if (
        materials.length &&
        !selectedFiles.some((file) => /\.obj$/i.test(file.name))
      )
        notify(
          "Select the OBJ and its companion MTL files together to import material colors.",
          "orange",
        );
      for (const file of selectedFiles.filter(
        (file) => !/\.mtl$/i.test(file.name),
      )) {
        if (/\.webslicer$/i.test(file.name)) {
          const p = await readProject(file);
          commit(p);
          setSelected(p.models[0]?.id || null);
          notify("Project opened.");
          continue;
        }
        const printPackage =
          /\.3mf$/i.test(file.name) && file.size <= 100 * 1024 * 1024
            ? readPrintPackage(new Uint8Array(await file.arrayBuffer()))
            : null;
        if (printPackage || /\.(gcode|gco|g)$/i.test(file.name)) {
          if (file.size > 100 * 1024 * 1024)
            throw new Error("G-code exceeds 100 MB.");
          const text = printPackage?.gcode ?? (await file.text());
          const metadata = printPackage ?? readGcodeMetadata(text);
          const parsed = parseGcode(text, {
            previewSegmentLimit: 1_000_000,
            arcConvention:
              metadata.printer?.firmware === "snapmaker-u1"
                ? "klipper"
                : "marlin",
            filaments: metadata.filaments,
            diameter:
              metadata.filamentDiameter ??
              metadata.printer?.filament ??
              project.printer.filament,
            density: project.settings.density,
            cost: project.settings.cost,
          });
          if (!parsed.layers.length)
            throw new Error("No extrusion paths found in this G-code.");
          setResult({
            ...parsed,
            warnings: [...parsed.warnings, ...metadata.warnings],
            source: {
              file,
              printer: metadata.printer,
              estimates: metadata.estimates,
              plates: printPackage?.plates,
              platePath: printPackage?.path,
            },
          });
          setLayer(parsed.layers.length - 1);
          setPreview(true);
          continue;
        }
        const targetPlate = projectRef.current.activePlate;
        const imported = await importModelFile(file, targetPlate, materials);
        const p = projectRef.current;
        const { models: added, filaments: importedFilaments } =
          bindImportedMaterials(p, imported);
        if (!p.plates.includes(targetPlate)) {
          throw new Error(
            "The destination plate was removed while the model was loading.",
          );
        }
        for (const warning of imported.warnings) notify(warning, "orange");
        const all = [
          ...p.models.filter((m) => m.plate === targetPlate),
          ...added,
        ];
        let arranged = all;
        try {
          arranged = arrangeModels(all, p.printer);
        } catch {
          notify(
            "Model imported. Check its size and position before slicing.",
            "orange",
          );
        }
        commit({
          ...p,
          filaments: importedFilaments,
          models: [
            ...p.models.filter((m) => m.plate !== targetPlate),
            ...arranged,
          ],
        });
        setSelected(added[0]?.id || null);
        notify(`Imported ${file.name}`);
      }
    } catch (e) {
      notify((e as Error).message, "red");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function selectPackagePlate(path: string) {
    const file = result?.source?.file;
    if (!file) return;
    const request = ++previewRequest.current;
    setLoadingPackage(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (request !== previewRequest.current) return;
      const job = readPrintPackage(bytes, path);
      if (!job) throw new Error("This file contains no print plates.");
      const parsed = parseGcode(job.gcode, {
        previewSegmentLimit: 1_000_000,
        arcConvention:
          job.printer?.firmware === "snapmaker-u1" ? "klipper" : "marlin",
        filaments: job.filaments,
        diameter:
          job.filamentDiameter ??
          job.printer?.filament ??
          project.printer.filament,
        density: project.settings.density,
        cost: project.settings.cost,
      });
      if (!parsed.layers.length)
        throw new Error("No extrusion paths found on this plate.");
      if (request !== previewRequest.current) return;
      setResult({
        ...parsed,
        warnings: [...parsed.warnings, ...job.warnings],
        source: {
          file,
          printer: job.printer,
          estimates: job.estimates,
          plates: job.plates,
          platePath: job.path,
        },
      });
      setLayer(parsed.layers.length - 1);
      setPlaying(false);
      setPreview(true);
    } catch (error) {
      if (request === previewRequest.current)
        notify((error as Error).message, "red");
    } finally {
      if (request === previewRequest.current) setLoadingPackage(false);
    }
  }
  async function runSlice() {
    previewRequest.current++;
    setLoadingPackage(false);
    const s = project.settings;
    const margin =
      s.adhesion === "brim"
        ? s.brimWidth
        : s.adhesion === "skirt"
          ? s.skirtDistance + s.skirtLoops * s.lineWidth
          : 0;
    const warnings = validatePlate(
      activeModels,
      project.printer,
      margin,
      s.supports !== "disabled" && !s.vase,
    );
    if (s.layerHeight > project.printer.nozzle * 0.8)
      warnings.push(
        "Layer height should not exceed 80% of the nozzle diameter.",
      );
    if (
      s.lineWidth < project.printer.nozzle * 0.6 ||
      s.lineWidth > project.printer.nozzle * 2
    )
      warnings.push(
        "Line width must be between 60% and 200% of the nozzle diameter.",
      );
    if (s.firstLayerHeight > project.printer.nozzle)
      warnings.push("First layer height exceeds nozzle diameter.");
    if (s.vase && activeModels.filter((m) => m.visible).length > 1)
      warnings.push("Spiral vase mode requires one model on the plate.");
    if (warnings.length) {
      setErrors(warnings);
      notify("Check the plate before slicing.", "orange");
      return;
    }
    setErrors([]);
    setBusy(true);
    setProgress(0);
    setStage("Starting local slicing engine");
    setResult(null);
    setPreview(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const sliced = await slicePlate(
        activeModels,
        project.printer,
        s,
        (n, label) => {
          setProgress(Math.max(0, Math.min(n, 1)) * 100);
          setStage(label);
        },
        controller.signal,
        filaments,
        multiMaterial,
      );
      setResult(sliced);
      setLayer(sliced.layers.length - 1);
      setPreview(true);
      setTool("select");
      setMobilePanel(null);
      notify(`Slicing complete · ${sliced.layers.length} layers`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setErrors([(e as Error).message]);
        notify("Slicing failed. See the workspace message for details.", "red");
      } else notify("Slicing cancelled.");
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }
  function exportGcode() {
    if (!result) return;
    if (result.source) {
      download(
        result.source.file,
        result.source.file.name,
        result.source.file.type,
      );
      return;
    }
    const name = `${project.name.replace(/[^a-z0-9-_ ]/gi, "")}_plate-${project.activePlate}`;
    if (project.printer.firmware === "bambu") {
      const images = printThumbnails(result, project.printer);
      download(
        createPrintPackage(project, result, images) as Uint8Array<ArrayBuffer>,
        `${name}.gcode.3mf`,
      );
    } else download(result.gcode, `${name}.gcode`, "text/plain");
  }
  function view(v: string) {
    setViewCommand({ view: v, tick: Date.now() });
  }
  function transformField(axis: number, value: number) {
    if (!model) return;
    if (tool === "rotate") {
      const r = [...model.rotation] as Vec3;
      r[axis] = value;
      updateModel({ rotation: r }, true);
    } else if (tool === "scale") {
      const scale = [...model.scale] as Vec3;
      const factor = value / 100 / scale[axis];
      if (locked) scale.forEach((_, i) => (scale[i] *= factor));
      else scale[axis] = value / 100;
      updateModel({ scale }, true);
    } else {
      const pos = [...model.position] as Vec3;
      pos[axis] = value;
      updateModel({ position: pos });
    }
  }
  function addPlate() {
    const id = Math.max(...project.plates) + 1;
    commit((p) => ({ ...p, plates: [...p.plates, id], activePlate: id }));
    setSelected(null);
  }
  function removePlate(plate: number) {
    if (project.plates.length < 2) return;
    commit((old) => {
      const towerPositions = { ...old.multiMaterial?.towerPositions };
      delete towerPositions[String(plate)];
      return {
        ...old,
        plates: old.plates.filter((id) => id !== plate),
        models: old.models.filter((m) => m.plate !== plate),
        activePlate: old.plates.find((id) => id !== plate)!,
        multiMaterial: {
          ...DEFAULT_MULTI_MATERIAL,
          ...old.multiMaterial,
          towerPositions,
        },
      };
    });
    setSelected(null);
  }
  function fitToBed() {
    if (!model) return;
    const parts = transformWholeAssembly
      ? assemblyParts(activeModels, model)
      : [model];
    const bounds = partsBounds(parts);
    const extent = [
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
    ];
    const factor = Math.min(
      (project.printer.bed[0] - 20) / extent[0],
      (project.printer.bed[1] - 20) / extent[1],
      (project.printer.bed[2] - 5) / extent[2],
    );
    updateModel(
      {
        scale: model.scale.map((n) => n * factor) as Vec3,
        position: [
          -((bounds.min.x + bounds.max.x) / 2 - model.position[0]) * factor,
          -((bounds.min.y + bounds.max.y) / 2 - model.position[1]) * factor,
          0,
        ],
      },
      true,
    );
  }
  async function editObject(operation: MaterialEdit) {
    if (!model || abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress(0);
    setStage("Editing material regions");
    setEditing(true);
    setModal(null);
    try {
      const result = await editModelSelection(
        project.models,
        model.id,
        operation,
        filaments.map((f) => f.color),
        Math.max(
          project.settings.lineWidth * 2,
          project.settings.layerHeight * 3,
        ),
        transformWholeAssembly,
        controller.signal,
        (value, label) => {
          setProgress(value * 100);
          setStage(label);
        },
      );
      if (controller.signal.aborted)
        throw new DOMException("Editing cancelled.", "AbortError");
      let models = result.models;
      if (operation.kind === "cut") {
        try {
          const arranged = arrangeModels(
            models.filter((m) => m.plate === project.activePlate),
            project.printer,
          );
          models = [
            ...models.filter((m) => m.plate !== project.activePlate),
            ...arranged,
          ];
        } catch {
          notify(
            "The cut succeeded, but the pieces need manual arrangement.",
            "orange",
          );
        }
      }
      abortRef.current = null;
      if (
        !models.every((m, i) => m === project.models[i]) ||
        models.length !== project.models.length
      )
        commit((p) => ({ ...p, models }));
      setSelected(result.selectedId);
      notify(
        operation.kind === "height"
          ? "Height color applied. Existing colors below the boundary are preserved."
          : operation.kind === "cut"
            ? "Model cut with capped surfaces and preserved materials."
            : result.pieces < 2
              ? "This object is one connected piece."
              : `Split into ${result.pieces} pieces with preserved materials.`,
      );
    } catch (error) {
      notify(
        (error as Error).name === "AbortError"
          ? "Editing cancelled."
          : (error as Error).message,
        (error as Error).name === "AbortError" ? "forest" : "red",
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setEditing(false);
      setBusy(false);
    }
  }
  function applyHeightColor() {
    const slot = Number(heightTool);
    if (!filaments[slot]) {
      notify("Choose a configured filament.", "red");
      return;
    }
    void editObject({ kind: "height", height: cutHeight, tool: slot });
  }
  function cut() {
    void editObject({
      kind: "cut",
      height: cutHeight,
      keep: cutKeep as "both" | "lower" | "upper",
      flipUpper: !cutFlip,
    });
  }
  function split() {
    void editObject({ kind: "split" });
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.defaultPrevented ||
        e
          .composedPath()
          .some(
            (node) =>
              node instanceof HTMLElement &&
              node.getAttribute("role") === "dialog",
          ) ||
        el.matches("input,textarea,select") ||
        el.isContentEditable ||
        modal ||
        mobilePanel ||
        busy
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveProject(projectRef.current);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        fileInput.current?.click();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selected) removeModel();
      } else if (e.key === "Escape") {
        setSelected(null);
        setTool("select");
      } else if (e.key.toLowerCase() === "f") view("fit");
      else if (e.key.toLowerCase() === "m") setTool("translate");
      else if (e.key.toLowerCase() === "r") setTool("rotate");
      else if (e.key.toLowerCase() === "s" && !mod) setTool("scale");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, model, modal, mobilePanel, busy, undo, redo]);
  async function connectPrinter(send = false) {
    setNetworkBusy(true);
    try {
      const url = new URL(connection.url);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Use an HTTP or HTTPS printer address.");
      const base = url.toString().replace(/\/$/, "");
      const headers: Record<string, string> = connection.key
        ? { "X-Api-Key": connection.key }
        : {};
      let response: Response;
      if (send) {
        if (!result) throw new Error("Slice the plate first.");
        const form = new FormData();
        form.append(
          "file",
          new Blob([result.gcode], { type: "text/plain" }),
          `${project.name}.gcode`,
        );
        if (connection.type === "octoprint") {
          form.append("select", "false");
          form.append("print", "false");
          response = await fetch(`${base}/api/files/local`, {
            method: "POST",
            headers,
            body: form,
            signal: AbortSignal.timeout(30000),
          });
        } else
          response = await fetch(`${base}/server/files/upload`, {
            method: "POST",
            headers,
            body: form,
            signal: AbortSignal.timeout(30000),
          });
      } else
        response = await fetch(
          `${base}${connection.type === "octoprint" ? "/api/version" : "/server/info"}`,
          { headers, signal: AbortSignal.timeout(10000) },
        );
      if (!response.ok)
        throw new Error(
          `Printer returned HTTP ${response.status}. Check the address and API key.`,
        );
      if (!send) {
        const data = await response.json();
        if (
          connection.type === "octoprint"
            ? typeof data.api !== "string"
            : typeof data.result?.klippy_connected !== "boolean"
        ) {
          throw new Error(
            "This address did not return the expected printer API. Check the server URL.",
          );
        }
      }
      setConnection((c) => ({
        ...c,
        connected: true,
        status: send
          ? "G-code uploaded. Start the print from your printer interface."
          : "Connected successfully.",
      }));
      notify(send ? "G-code uploaded to printer." : "Printer connected.");
    } catch (e) {
      setConnection((c) => ({
        ...c,
        connected: false,
        status:
          (e as Error).message === "Failed to fetch"
            ? "Cannot reach the printer. Enable CORS on the printer server and use a compatible HTTP/HTTPS address."
            : (e as Error).message,
      }));
    } finally {
      setNetworkBusy(false);
    }
  }
  const settingsPanel = (
    <SettingsPanel
      filamentCount={filaments.length}
      modelHeight={Math.max(
        0,
        ...activeModels.filter((m) => m.visible).map((m) => boundsOf(m).max.z),
      )}
      onFilaments={() => setModal("filaments")}
      settings={project.settings}
      printer={project.printer}
      disabled={busy || loadingPrinter || !hydrated}
      onChange={(patch) => commit((p) => applySettingsPatch(p, patch))}
      onPrinter={async (printer) => {
        setLoadingPrinter(true);
        try {
          const loaded = await loadVendorPrinter(printer);
          commit((p) => applyPrinter(p, loaded));
        } catch (error) {
          notify((error as Error).message, "red");
        } finally {
          setLoadingPrinter(false);
        }
      }}
      onEditPrinter={() => {
        setPrinterDraft(structuredClone(project.printer));
        setModal("printer");
      }}
      onProfiles={() => setModal("presets")}
    />
  );
  const objectPanel = (
    <>
      <div className="object-heading">
        <span>Objects</span>
        <Badge size="xs" variant="light" color="gray">
          {activeModels.length}
        </Badge>
        <span className="spacer" />
        <Menu shadow="md" position="bottom-end">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Object actions"
            >
              <MoreHorizontal size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<LayoutGrid size={15} />}
              onClick={arrange}
              disabled={busy || !activeModels.length}
            >
              Arrange plate
            </Menu.Item>
            <Menu.Item
              leftSection={<Download size={15} />}
              onClick={() =>
                download(exportSTL(activeModels), `${project.name}.stl`)
              }
              disabled={!activeModels.length}
            >
              Export plate as STL
            </Menu.Item>
            <Menu.Item
              color="red"
              leftSection={<Trash2 size={15} />}
              disabled={busy || !activeModels.length}
              onClick={() => {
                commit((p) => ({
                  ...p,
                  models: p.models.filter((m) => m.plate !== p.activePlate),
                }));
                setSelected(null);
              }}
            >
              Clear plate
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
      <div className="object-list">
        {activeModels.map((m) => (
          <div
            key={m.id}
            className={`object-row ${m.id === selected ? "selected" : ""}`}
          >
            <button className="object-select" onClick={() => setSelected(m.id)}>
              <Box size={15} style={{ color: m.color }} />
              <span>{m.name}</span>
              {m.assemblyId && (
                <Link size={12} aria-label="Linked assembly part" />
              )}
            </button>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              disabled={busy}
              aria-label={`${m.visible ? "Hide" : "Show"} ${m.name}`}
              onClick={() => updateModel({ visible: !m.visible }, false, m.id)}
            >
              {m.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </ActionIcon>
          </div>
        ))}
      </div>
      {!activeModels.length && (
        <div className="empty-objects">
          An empty plate.
          <br />A little room for your next idea.
        </div>
      )}
      <button
        className="add-object"
        onClick={() => fileInput.current?.click()}
        disabled={busy || importing}
      >
        <Plus size={14} /> Add model <span>STL · OBJ + MTL · 3MF</span>
      </button>
      {model && (
        <div className="object-inspector">
          <div className="inspector-top">
            <span>Object properties</span>
            <div>
              <IconButton
                label="Duplicate object (⌘D)"
                onClick={duplicate}
                disabled={busy}
              >
                <Copy size={14} />
              </IconButton>
              <IconButton
                label="Delete object"
                onClick={() => removeModel()}
                disabled={busy}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          </div>
          {model.assemblyId && (
            <Switch
              mb="sm"
              size="xs"
              label="Transform assembly"
              description={`${assemblyParts(activeModels, model).length} linked parts`}
              checked={transformWholeAssembly}
              onChange={(e) =>
                setTransformWholeAssembly(e.currentTarget.checked)
              }
            />
          )}
          <Button
            fullWidth
            size="xs"
            variant="light"
            mb="sm"
            leftSection={<Link size={14} />}
            disabled={busy}
            onClick={() => setModal("assembly")}
          >
            Manage assembly
          </Button>
          <Button
            fullWidth
            size="xs"
            variant="light"
            mb="sm"
            disabled={busy}
            onClick={() => {
              setModifierDraft(structuredClone(model.modifiers ?? []));
              setModifierSelected(model.modifiers?.[0]?.id ?? "");
              setModifierTool("translate");
              setModifierCollapsed(false);
              setMobilePanel(null);
              setTool("select");
              setModal("modifiers");
              view("modifier-fit");
            }}
          >
            Object modifiers
            {model.modifiers?.length ? ` (${model.modifiers.length})` : ""}
          </Button>
          <TextInput
            aria-label="Object name"
            value={model.name}
            onChange={(e) => updateModel({ name: e.target.value })}
            variant="unstyled"
            size="sm"
            disabled={busy}
          />
          <div className="dimension-readout">
            {size.map((n) => n.toFixed(1)).join(" × ")} <span>mm</span>
          </div>
          <SegmentedControl
            fullWidth
            size="xs"
            value={tool === "select" || tool === "paint" ? "translate" : tool}
            onChange={(v) => setTool(v as ViewTool)}
            data={[
              { value: "translate", label: "Move" },
              { value: "rotate", label: "Rotate" },
              { value: "scale", label: "Scale" },
            ]}
          />
          <div className="axis-fields">
            {["X", "Y", "Z"].map((axis, i) => (
              <NumberInput
                key={axis}
                aria-label={`${tool === "rotate" ? "Rotate" : tool === "scale" ? "Scale" : "Position"} ${axis}`}
                label={axis}
                value={Number(
                  (tool === "rotate"
                    ? model.rotation[i]
                    : tool === "scale"
                      ? model.scale[i] * 100
                      : model.position[i]
                  ).toFixed(2),
                )}
                onChange={(v) =>
                  typeof v === "number" &&
                  (tool !== "scale" || v > 0) &&
                  transformField(i, v)
                }
                step={tool === "rotate" ? 15 : tool === "scale" ? 5 : 1}
                min={tool === "scale" ? 1 : undefined}
                max={tool === "scale" ? 10000 : undefined}
                hideControls
                size="xs"
                disabled={busy}
              />
            ))}
          </div>
          <div className="transform-caption">
            <span>
              {tool === "rotate"
                ? "Rotation in degrees"
                : tool === "scale"
                  ? "Scale in percent"
                  : "Position in millimeters"}
            </span>
            {tool === "scale" && (
              <Tooltip label="Uniform scale">
                <ActionIcon
                  size="xs"
                  variant={locked ? "light" : "subtle"}
                  aria-label="Toggle uniform scale"
                  onClick={() => setLocked(!locked)}
                >
                  <Lock size={12} />
                </ActionIcon>
              </Tooltip>
            )}
          </div>
          <div className="object-actions">
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={<ArrowDownToLine size={13} />}
              disabled={busy}
              onClick={() => updateModel({}, true)}
            >
              Drop to bed
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={<Maximize size={13} />}
              disabled={busy}
              onClick={fitToBed}
            >
              Fit to bed
            </Button>
          </div>
          {(project.printer.toolCount ?? 1) > 1 && (
            <Select
              label="Object filament"
              size="xs"
              mb="sm"
              disabled={busy}
              data={filaments.map((f, i) => ({
                value: String(i),
                label: `${i + 1}. ${f.name}`,
              }))}
              value={String(model.tool ?? 0)}
              allowDeselect={false}
              onChange={(v) =>
                v !== null &&
                updateModel({
                  tool: Number(v),
                  color: filaments[Number(v)].color,
                  faceTools: undefined,
                  paintTriangles: undefined,
                })
              }
            />
          )}
          <div className="swatches">
            {(filaments.length > 1
              ? filaments.map((f) => f.color)
              : COLORS
            ).map((color, index) => (
              <button
                key={index}
                aria-label={
                  filaments.length > 1
                    ? `Assign filament ${index + 1}`
                    : `Set model color ${color}`
                }
                className={
                  (
                    filaments.length > 1
                      ? (model.tool ?? 0) === index
                      : model.color === color
                  )
                    ? "active"
                    : ""
                }
                style={{ background: color }}
                onClick={() =>
                  updateModel(
                    filaments.length > 1
                      ? {
                          color,
                          tool: index,
                          faceTools: undefined,
                          paintTriangles: undefined,
                        }
                      : { color },
                  )
                }
                disabled={busy}
              />
            ))}
            <span className="spacer" />
            <Menu shadow="md">
              <Menu.Target>
                <ActionIcon
                  aria-label="More model tools"
                  variant="subtle"
                  color="gray"
                >
                  <MoreHorizontal size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  disabled={busy || filaments.length < 2}
                  leftSection={<Paintbrush size={14} />}
                  onClick={beginPainting}
                >
                  Paint surfaces
                </Menu.Item>
                <Menu.Item
                  disabled={busy}
                  leftSection={<Paintbrush size={14} />}
                  onClick={beginSupportPainting}
                >
                  Paint supports
                </Menu.Item>
                <Menu.Item
                  disabled={busy || filaments.length < 2}
                  onClick={() => {
                    const b = partsBounds(
                      transformWholeAssembly
                        ? assemblyParts(activeModels, model)
                        : [model],
                    );
                    setCutHeight(Number(((b.min.z + b.max.z) / 2).toFixed(2)));
                    setHeightTool(String((model.tool ?? 0) === 0 ? 1 : 0));
                    setModal("height-color");
                  }}
                >
                  Color by height
                </Menu.Item>
                <Menu.Item
                  disabled={busy}
                  leftSection={<Scissors size={14} />}
                  onClick={() => {
                    const b = partsBounds(
                      transformWholeAssembly
                        ? assemblyParts(activeModels, model)
                        : [model],
                    );
                    setCutHeight(Number(((b.min.z + b.max.z) / 2).toFixed(2)));
                    setModal("cut");
                  }}
                >
                  Cut model
                </Menu.Item>
                <Menu.Item disabled={busy} onClick={split}>
                  Split connected parts
                </Menu.Item>
                <Menu.Item
                  disabled={busy}
                  onClick={() =>
                    updateModel(
                      {
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                        position: [0, 0, 0],
                      },
                      true,
                    )
                  }
                >
                  Reset transforms
                </Menu.Item>
                <Menu.Item
                  disabled={busy}
                  onClick={() =>
                    updateModel(
                      {
                        rotation: [
                          model.rotation[0] + 90,
                          model.rotation[1],
                          model.rotation[2],
                        ],
                      },
                      true,
                    )
                  }
                >
                  Lay on side · rotate X 90°
                </Menu.Item>
                {project.plates
                  .filter((p) => p !== project.activePlate)
                  .map((p) => (
                    <Menu.Item
                      key={p}
                      disabled={busy}
                      onClick={() => {
                        updateModel({ plate: p });
                        setSelected(null);
                      }}
                    >
                      Move to plate {p}
                    </Menu.Item>
                  ))}
              </Menu.Dropdown>
            </Menu>
          </div>
          <div className="mesh-stats">
            <span>
              {(model.positions.length / 9).toLocaleString()} triangles
            </span>
            <span>{(modelVolume(model) / 1000).toFixed(1)} cm³</span>
          </div>
        </div>
      )}
    </>
  );
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy && modal !== "modifiers") setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy && modal !== "modifiers")
          void importFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".stl,.obj,.mtl,.3mf,.webslicer,.gcode,.gco,.g"
        onChange={(e) => e.target.files && void importFiles(e.target.files)}
      />
      <header className="app-header" inert={modal === "modifiers"}>
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="Stratum home"
        >
          <span className="brand-mark">
            <Layers3 size={24} strokeWidth={1.7} />
          </span>
          <span>
            stratum<span className="brand-dot">.</span>
          </span>
          <Badge
            className="beta-badge"
            variant="outline"
            size="xs"
            color="gray"
          >
            WEB SLICER
          </Badge>
        </a>
        <div className="header-divider" />
        <Menu shadow="md" position="bottom-start">
          <Menu.Target>
            <button className="project-menu">
              {project.name}
              <ChevronDown size={14} />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Project</Menu.Label>
            <Menu.Item
              leftSection={<FilePlus2 size={15} />}
              disabled={busy}
              onClick={() => {
                commit({
                  ...initialProject(),
                  name: "Untitled project",
                  models: [],
                });
                setSelected(null);
              }}
            >
              New project
            </Menu.Item>
            <Menu.Item
              leftSection={<FolderOpen size={15} />}
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              Open project or model <span className="menu-shortcut">⌘O</span>
            </Menu.Item>
            <Menu.Item
              leftSection={<Save size={15} />}
              onClick={() => saveProject(project)}
            >
              Save project <span className="menu-shortcut">⌘S</span>
            </Menu.Item>
            <Menu.Item onClick={() => setModal("rename")}>
              Rename project
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              leftSection={<Undo2 size={15} />}
              disabled={busy || !history.current.length}
              onClick={undo}
            >
              Undo
            </Menu.Item>
            <Menu.Item
              leftSection={<Redo2 size={15} />}
              disabled={busy || !future.current.length}
              onClick={redo}
            >
              Redo
            </Menu.Item>
            <Menu.Item
              leftSection={<Wifi size={15} />}
              onClick={() => setModal("connection")}
            >
              Connect printer
            </Menu.Item>
            <Menu.Item
              leftSection={<HelpCircle size={15} />}
              onClick={() => setModal("help")}
            >
              Help & shortcuts
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              leftSection={<Download size={15} />}
              disabled={!activeModels.length}
              onClick={() =>
                download(exportSTL(activeModels), `${project.name}.stl`)
              }
            >
              Export plate STL
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <span className="saved-indicator">
          <Check size={13} />
          {saveStatus === "Saved on this device" && savedProject !== project
            ? "Saving…"
            : saveStatus}
        </span>
        <span className="spacer" />
        <div className="header-tools">
          <IconButton
            label="Undo (⌘Z)"
            onClick={undo}
            disabled={busy || !history.current.length}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="Redo (⇧⌘Z)"
            onClick={redo}
            disabled={busy || !future.current.length}
          >
            <Redo2 size={18} />
          </IconButton>
          <span className="header-divider" />
          <IconButton label="Help & shortcuts" onClick={() => setModal("help")}>
            <HelpCircle size={19} />
          </IconButton>
        </div>
        <Button
          className="import-button"
          leftSection={<Plus size={16} />}
          variant="default"
          size="sm"
          onClick={() => fileInput.current?.click()}
          loading={importing || loadingPrinter}
          disabled={busy || loadingPrinter || !hydrated}
        >
          Import model
        </Button>
      </header>
      <div className="workflow-bar" inert={modal === "modifiers"}>
        <div className="workspace-label">
          <span className="status-dot" /> LOCAL WORKSPACE
        </div>
        <nav className="workflow-tabs" aria-label="Workflow">
          <button
            className={!preview ? "active" : ""}
            onClick={() => {
              previewRequest.current++;
              setLoadingPackage(false);
              setPreview(false);
            }}
          >
            <Box size={15} />
            <span>Prepare</span>
            <span className="step-number">1</span>
          </button>
          <button
            className={preview ? "active" : ""}
            onClick={() => {
              if (result) setPreview(true);
              else notify("Slice the plate to explore its toolpaths.");
            }}
          >
            <Layers3 size={15} />
            <span>Preview</span>
            <span className="step-number">2</span>
          </button>
        </nav>
        <div className="workspace-right">
          <ShieldCheck size={14} /> Private by design{" "}
          <button
            onClick={() => setModal("connection")}
            aria-label="Connect printer"
          >
            <Wifi size={14} />
            <span>Connect printer</span>
          </button>
        </div>
      </div>
      <div className="workspace-body">
        <aside className="settings-sidebar" inert={modal === "modifiers"}>
          {settingsPanel}
        </aside>
        <main className="workspace">
          <Viewport
            models={viewportModels}
            printer={viewportPrinter}
            selected={selected}
            onSelect={modal === "modifiers" ? () => {} : setSelected}
            modifierDraft={viewportModifiers}
            onModifierSelect={setModifierSelected}
            onModifierTransform={(id, patch) =>
              setModifierDraft((items) =>
                items.map((item) =>
                  item.id === id ? { ...item, ...patch } : item,
                ),
              )
            }
            tool={busy || modal === "modifiers" ? "select" : tool}
            paint={paint}
            filamentColors={filamentColors}
            onPaint={paintModel}
            transformWholeAssembly={transformWholeAssembly}
            onTransform={(id, patch) => updateModel(patch, true, id)}
            viewCommand={viewCommand}
            result={result}
            preview={preview}
            layer={layer}
            singleLayer={singleLayer}
            showTravel={showTravel}
            hiddenFeatures={hiddenFeatures}
            colorMode={colorMode}
            wireframe={wireframe}
          />
          {tool === "paint" && !preview && model && !busy && (
            <PaintPanel
              onView={(v) => view(`paint-${v}`)}
              filaments={filaments}
              settings={paint}
              onChange={setPaint}
              supportMode={project.settings.supports}
              onSupportMode={(supports) =>
                commit((p) => ({ ...p, settings: { ...p.settings, supports } }))
              }
              depth={
                model.paintDepth ??
                Math.max(
                  project.settings.lineWidth * 2,
                  project.settings.layerHeight * 3,
                )
              }
              onDepth={(paintDepth) => updateModel({ paintDepth })}
              onClear={() =>
                updateModel(
                  paint.target === "support"
                    ? { supportPaint: undefined }
                    : { faceTools: undefined, paintTriangles: undefined },
                )
              }
              onDone={() => setTool("select")}
            />
          )}
          <div className="plate-heading">
            <div className="plate-label">
              <span className="plate-number">
                {archivePlate && archivePlate.index === undefined
                  ? "—"
                  : String(archivePlate?.index ?? project.activePlate).padStart(
                      2,
                      "0",
                    )}
              </span>
              <div>
                <strong
                  title={archivePlate?.name}
                  style={{
                    maxWidth: "min(50vw, 320px)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {archivePlate?.name ?? `Build plate ${project.activePlate}`}
                </strong>
                <span>
                  {viewportPrinter.bed[0]} × {viewportPrinter.bed[1]} mm{" "}
                  <i>·</i>{" "}
                  {preview ? "Toolpath preview" : "Textured build surface"}
                </span>
              </div>
            </div>
            <Badge
              size="sm"
              variant="light"
              color={preview ? "forest" : "gray"}
            >
              {preview ? "Sliced" : "Ready to prepare"}
            </Badge>
          </div>
          {!preview && (
            <div
              inert={modal === "modifiers"}
              className="scene-toolbar"
              role="toolbar"
              aria-label="Model tools"
            >
              <IconButton
                label="Select"
                active={tool === "select"}
                onClick={() => setTool("select")}
              >
                <MousePointer2 size={19} />
              </IconButton>
              <span className="toolbar-divider" />
              <IconButton
                label="Move (M)"
                active={tool === "translate"}
                onClick={() => setTool("translate")}
                disabled={!model || busy}
              >
                <Move3D size={20} />
              </IconButton>
              <IconButton
                label="Rotate (R)"
                active={tool === "rotate"}
                onClick={() => setTool("rotate")}
                disabled={!model || busy}
              >
                <Rotate3D size={20} />
              </IconButton>
              <IconButton
                label="Scale (S)"
                active={tool === "scale"}
                onClick={() => setTool("scale")}
                disabled={!model || busy}
              >
                <Scaling size={19} />
              </IconButton>
              <IconButton
                label="Cut model"
                onClick={() => {
                  if (!model) return;
                  const b = partsBounds(
                    transformWholeAssembly
                      ? assemblyParts(activeModels, model)
                      : [model],
                  );
                  setCutHeight((b.min.z + b.max.z) / 2);
                  setModal("cut");
                }}
                disabled={!model || busy}
              >
                <Scissors size={18} />
              </IconButton>
              <IconButton
                label="Paint surfaces"
                active={tool === "paint" && paint.target !== "support"}
                onClick={beginPainting}
                disabled={busy || !model || filaments.length < 2}
              >
                <Paintbrush size={19} />
              </IconButton>
              <IconButton
                label="Paint supports"
                active={tool === "paint" && paint.target === "support"}
                onClick={beginSupportPainting}
                disabled={busy || !model}
              >
                <GitBranch size={19} />
              </IconButton>
              <span className="toolbar-divider" />
              <IconButton
                label="Arrange plate"
                onClick={arrange}
                disabled={!activeModels.length || busy}
              >
                <LayoutGrid size={18} />
              </IconButton>
              <IconButton
                label="Add primitive"
                onClick={() => setModal("primitives")}
                disabled={busy}
              >
                <Plus size={20} />
              </IconButton>
            </div>
          )}
          <div className="camera-controls" inert={modal === "modifiers"}>
            <Tooltip label="Isometric view">
              <button
                className="view-cube"
                onClick={() => view("home")}
                aria-label="Isometric view"
              >
                <Box size={29} strokeWidth={1} />
                <span>ISO</span>
              </button>
            </Tooltip>
            <div>
              <IconButton label="Top view" onClick={() => view("top")}>
                <Square size={15} />
              </IconButton>
              <IconButton label="Front view" onClick={() => view("front")}>
                <Box size={15} />
              </IconButton>
              <IconButton label="Fit model (F)" onClick={() => view("fit")}>
                <Maximize size={15} />
              </IconButton>
              <IconButton
                label="Toggle wireframe"
                active={wireframe}
                onClick={() => setWireframe(!wireframe)}
              >
                <GridIcon />
              </IconButton>
            </div>
          </div>
          {!preview && <aside className="objects-card">{objectPanel}</aside>}
          {!activeModels.length && !preview && (
            <div className="empty-state">
              <div className="empty-icon">
                <Box size={38} strokeWidth={1} />
              </div>
              <h1>Make room for an idea.</h1>
              <p>
                Drop a 3D model onto your build plate,
                <br />
                or start with something simple.
              </p>
              <Button
                leftSection={<Upload size={16} />}
                onClick={() => fileInput.current?.click()}
              >
                Import a model
              </Button>
              <button
                className="text-button"
                onClick={() => setModal("primitives")}
              >
                Explore starter shapes <ArrowUpRight size={14} />
              </button>
              <small>STL, OBJ, 3MF · Millimeters</small>
            </div>
          )}
          {errors.length > 0 && (
            <Alert
              className="workspace-alert"
              color="orange"
              title="Check before printing"
              withCloseButton
              onClose={() => setErrors([])}
            >
              {errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </Alert>
          )}
          {preview && result && (
            <>
              <aside className="preview-card">
                <div className="preview-card-heading">
                  <span className="success-check">
                    <Check size={15} />
                  </span>
                  <div>
                    <strong>
                      {result.source
                        ? "Imported print preview"
                        : "Ready, layer by layer."}
                    </strong>
                    <span>
                      {result.layers.length.toLocaleString()} layers ·{" "}
                      {result.source
                        ? (result.source.printer?.name ??
                          result.source.file.name)
                        : `Plate ${project.activePlate}`}
                    </span>
                  </div>
                </div>
                {result.source?.plates && (
                  <Select
                    label="Archive plate"
                    aria-label="Archive plate"
                    size="xs"
                    mb="sm"
                    searchable
                    allowDeselect={false}
                    value={result.source.platePath}
                    disabled={loadingPackage}
                    data={result.source.plates.map((p) => ({
                      value: p.path,
                      label: `${p.index === undefined ? "" : `${p.index}. `}${p.name}${p.unavailable ? ` · ${p.unavailable}` : ""}`,
                      disabled: !!p.unavailable,
                    }))}
                    onChange={(path) => path && selectPackagePlate(path)}
                    description={
                      loadingPackage
                        ? "Loading plate…"
                        : `${result.source.plates.length} ${result.source.plates.length === 1 ? "plate" : "plates"} in the original archive`
                    }
                  />
                )}
                <div className="print-estimates">
                  <div>
                    <span>Motion time*</span>
                    <strong>{formatDuration(result.seconds)}</strong>
                  </div>
                  <div>
                    <span>Filament</span>
                    <strong>
                      {result.weight.toFixed(1)}
                      <small> g</small>
                    </strong>
                  </div>
                  <div>
                    <span>Material cost</span>
                    <strong>${result.cost.toFixed(2)}</strong>
                  </div>
                </div>
                <small className="estimate-note">
                  *Excludes heating and acceleration.
                </small>
                {result.source?.estimates && (
                  <Stack gap={2} mt="xs" className="file-estimates">
                    <Text size="xs" fw={600}>
                      {result.source.estimates.basis}
                    </Text>
                    <Text size="xs">
                      {[
                        result.source.estimates.seconds !== undefined
                          ? formatDuration(result.source.estimates.seconds)
                          : undefined,
                        result.source.estimates.weight !== undefined
                          ? `${result.source.estimates.weight.toFixed(2)} g`
                          : undefined,
                        result.source.estimates.filament !== undefined
                          ? `${(result.source.estimates.filament / 1000).toFixed(2)} m`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    {result.source.estimates.tools
                      .filter(
                        (t) => (t.weight ?? 0) > 0 || (t.filament ?? 0) > 0,
                      )
                      .map((t) => (
                        <Text size="xs" c="dimmed" key={t.tool}>
                          Filament {t.tool + 1}:{" "}
                          {[
                            t.weight !== undefined
                              ? `${t.weight.toFixed(2)} g`
                              : undefined,
                            t.filament !== undefined
                              ? `${(t.filament / 1000).toFixed(2)} m`
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      ))}
                  </Stack>
                )}
                <Divider my="sm" />
                <Select
                  aria-label="Preview color scheme"
                  size="xs"
                  value={colorMode}
                  onChange={(v) => v && setColorMode(v)}
                  data={[
                    { value: "feature", label: "Color by line type" },
                    { value: "speed", label: "Color by speed" },
                    { value: "filament", label: "Color by filament" },
                  ]}
                />
                {colorMode === "filament" && (
                  <Stack gap={4} my="sm">
                    <Text size="xs">{result.toolChanges} tool changes</Text>
                    {result.tools.map((t) => (
                      <div className="filament-usage-row" key={t.tool}>
                        <span style={{ background: t.color }} />
                        <Text size="xs">
                          {t.tool + 1}. {t.name} · {t.weight.toFixed(2)} g · $
                          {t.cost.toFixed(2)}
                        </Text>
                      </div>
                    ))}
                  </Stack>
                )}
                <div className="feature-legend">
                  {FEATURE_NAMES.map((name, i) =>
                    i === 4 ? null : (
                      <button
                        key={name}
                        className={
                          hiddenFeatures.includes(i) ? "hidden-feature" : ""
                        }
                        onClick={() =>
                          setHiddenFeatures((f) =>
                            f.includes(i)
                              ? f.filter((v) => v !== i)
                              : [...f, i],
                          )
                        }
                      >
                        <span style={{ background: FEATURE_COLORS[i] }} />
                        {name}
                        <Eye size={12} />
                      </button>
                    ),
                  )}
                </div>
                {colorMode === "speed" && (
                  <div className="speed-gradient">
                    <div />
                    <span>0 mm/s</span>
                    <span>150+ mm/s</span>
                  </div>
                )}
                <Switch
                  label="Show travel moves"
                  checked={showTravel}
                  onChange={(e) => setShowTravel(e.currentTarget.checked)}
                  size="xs"
                />
                <Switch
                  mt="sm"
                  label="Current layer only"
                  checked={singleLayer}
                  onChange={(e) => setSingleLayer(e.currentTarget.checked)}
                  size="xs"
                />
                {result.warnings.map((w) => (
                  <Text key={w} size="xs" c="orange" mt="sm">
                    {w}
                  </Text>
                ))}
                <Button
                  mt="md"
                  fullWidth
                  variant="light"
                  size="xs"
                  leftSection={<MoreHorizontal size={15} />}
                  onClick={() => setModal("gcode")}
                >
                  Inspect G-code
                </Button>
              </aside>
              <div className="layer-control">
                <IconButton
                  label={playing ? "Pause layers" : "Play layers"}
                  onClick={() => {
                    if (layer === result.layers.length - 1) setLayer(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? (
                    <span className="pause-icon">Ⅱ</span>
                  ) : (
                    <Play size={17} />
                  )}
                </IconButton>
                <div className="layer-slider">
                  <div>
                    <span>
                      Layer <strong>{layer + 1}</strong> /{" "}
                      {result.layers.length}
                    </span>
                    <span>Z {result.layers[layer]?.z.toFixed(2)} mm</span>
                  </div>
                  <Slider
                    thumbLabel="Preview layer"
                    min={0}
                    max={Math.max(1, result.layers.length - 1)}
                    value={layer}
                    onChange={(v) => {
                      setLayer(v);
                      setPlaying(false);
                    }}
                    label={(v) => `Layer ${v + 1}`}
                    size="sm"
                  />
                </div>
                <IconButton
                  label="Previous layer"
                  disabled={layer === 0}
                  onClick={() => setLayer((l) => l - 1)}
                >
                  <ChevronLeft size={16} />
                </IconButton>
                <IconButton
                  label="Next layer"
                  disabled={layer >= result.layers.length - 1}
                  onClick={() => setLayer((l) => l + 1)}
                >
                  <ChevronRight size={16} />
                </IconButton>
              </div>
            </>
          )}
          <div className="scene-bottom">
            <div className="plate-tabs" inert={modal === "modifiers"}>
              {project.plates.map((p) => (
                <button
                  key={p}
                  className={p === project.activePlate ? "active" : ""}
                  disabled={busy}
                  onClick={() => {
                    if (p !== project.activePlate) {
                      commit((old) => ({ ...old, activePlate: p }));
                      setSelected(null);
                    }
                  }}
                >
                  <Layers3 size={13} />
                  <span>Plate {p}</span>
                  {project.plates.length > 1 && p === project.activePlate && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove plate ${p}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removePlate(p);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          removePlate(p);
                        }
                      }}
                    >
                      <X size={11} />
                    </span>
                  )}
                </button>
              ))}
              <IconButton
                label="Add build plate"
                onClick={addPlate}
                disabled={busy}
              >
                <Plus size={15} />
              </IconButton>
            </div>
            <span className="orbit-hint">
              Drag to orbit <i>·</i> Pinch to zoom <i>·</i> Two fingers to pan
            </span>
          </div>
          <div
            className="mobile-workspace-buttons"
            inert={modal === "modifiers"}
          >
            <Button
              variant="default"
              leftSection={<Settings2 size={16} />}
              onClick={() => setMobilePanel("settings")}
            >
              Print setup
            </Button>
            <Button
              variant="default"
              leftSection={<Box size={16} />}
              onClick={() => setMobilePanel("objects")}
            >
              Objects{" "}
              <Badge size="xs" ml={6}>
                {activeModels.length}
              </Badge>
            </Button>
          </div>
        </main>
      </div>
      <footer className="action-bar" inert={modal === "modifiers"}>
        <div className="footer-status">
          <span className="status-dot" />
          <strong>
            {busy
              ? stage
              : preview
                ? "Toolpaths generated"
                : `${activeModels.filter((m) => m.visible).length} object${activeModels.length !== 1 ? "s" : ""} on the plate`}
          </strong>
          <span>
            {busy
              ? "Processing on your device"
              : preview
                ? `${(result!.filament / 1000).toFixed(2)} m filament`
                : `${project.settings.material} · ${project.settings.layerHeight.toFixed(2)} mm · ${project.settings.infill}% infill`}
          </span>
        </div>
        <div className="footer-actions">
          {busy ? (
            <>
              <Progress value={progress} w={160} size="sm" animated />
              <span className="small muted">{Math.round(progress)}%</span>
              <Button
                variant="default"
                onClick={() => abortRef.current?.abort()}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                className="save-project-button"
                variant="subtle"
                color="gray"
                leftSection={<Save size={15} />}
                onClick={() => saveProject(project)}
              >
                Save project
              </Button>
              {preview && result ? (
                <>
                  <Button
                    variant="default"
                    onClick={() => {
                      previewRequest.current++;
                      setLoadingPackage(false);
                      setPreview(false);
                    }}
                  >
                    Back to prepare
                  </Button>
                  <Button
                    leftSection={<Download size={17} />}
                    onClick={exportGcode}
                    size="md"
                  >
                    {result.source
                      ? "Download original"
                      : project.printer.firmware === "bambu"
                        ? "Export print 3MF"
                        : "Export G-code"}
                  </Button>
                </>
              ) : (
                <Button
                  className="slice-button"
                  size="md"
                  rightSection={<ArrowUpRight size={18} />}
                  leftSection={<Layers3 size={17} />}
                  onClick={() => void runSlice()}
                  disabled={
                    !hydrated ||
                    loadingPrinter ||
                    !activeModels.some((m) => m.visible)
                  }
                  loading={importing || loadingPrinter}
                >
                  Slice plate
                </Button>
              )}
            </>
          )}
        </div>
      </footer>
      <Drawer
        opened={mobilePanel !== null}
        onClose={() => setMobilePanel(null)}
        title={
          mobilePanel === "settings" ? "Print setup" : "Objects & transforms"
        }
        position="bottom"
        size="82%"
        radius="lg"
        className="mobile-drawer"
      >
        {mobilePanel === "settings" ? settingsPanel : objectPanel}
      </Drawer>
      <Modal
        opened={modal === "primitives"}
        onClose={() => setModal(null)}
        title="A starting point for your next print"
        size="lg"
      >
        <Text c="dimmed" size="sm" mb="lg">
          Add a starter model to the active build plate. All dimensions are in
          millimeters.
        </Text>
        <div className="primitive-grid">
          {[
            {
              id: "cube",
              name: "Calibration cube",
              desc: "20 × 20 × 20 mm",
              icon: Box,
            },
            {
              id: "cylinder",
              name: "Cylinder",
              desc: "Ø30 × 40 mm",
              icon: Grip,
            },
            { id: "sphere", name: "Sphere", desc: "Ø40 mm", icon: Rotate3D },
            {
              id: "torus",
              name: "Torus",
              desc: "Ø56 × 12 mm",
              icon: RotateCcw,
            },
            {
              id: "vase",
              name: "Helix planter",
              desc: "Twisted walls · 80 mm tall",
              icon: Layers3,
            },
          ].map((p) => (
            <button key={p.id} onClick={() => addPrimitive(p.id)}>
              <p.icon size={36} strokeWidth={1} />
              <strong>{p.name}</strong>
              <span>{p.desc}</span>
              <Plus size={16} />
            </button>
          ))}
        </div>
      </Modal>
      <Modal
        opened={modal === "rename"}
        onClose={() => setModal(null)}
        title="Rename project"
      >
        <TextInput
          label="Project name"
          value={project.name}
          maxLength={100}
          onChange={(e) => commit((p) => ({ ...p, name: e.target.value }))}
        />
        <Button mt="md" onClick={() => setModal(null)}>
          Done
        </Button>
      </Modal>
      {modal === "modifiers" && model && (
        <ModifierPanel
          model={model}
          value={modifierDraft}
          selected={modifierSelected}
          onSelect={setModifierSelected}
          tool={modifierTool}
          onTool={setModifierTool}
          collapsed={modifierCollapsed}
          onCollapsed={(value) => {
            setModifierCollapsed(value);
            view(
              viewCommand.view.startsWith("modifier-")
                ? viewCommand.view
                : "modifier-fit",
            );
          }}
          onView={(v) => view(`modifier-${v}`)}
          onChange={setModifierDraft}
          onClose={() => setModal(null)}
          onSave={() => {
            updateModel({ modifiers: modifierDraft });
            setModal(null);
          }}
        />
      )}
      <Modal
        opened={modal === "assembly"}
        onClose={() => setModal(null)}
        title="Multi-color assembly"
        centered
        size="md"
      >
        {modal === "assembly" && model && (
          <AssemblyPanel
            models={project.models}
            selected={model}
            filaments={filaments}
            onChange={(models) => {
              commit((p) => ({ ...p, models }));
              setTransformWholeAssembly(true);
            }}
            onDone={() => setModal(null)}
          />
        )}
      </Modal>
      <Modal
        opened={modal === "filaments"}
        onClose={() => setModal(null)}
        title="Filaments & tool changes"
        size="lg"
      >
        <FilamentPanel
          filaments={filaments}
          multi={multiMaterial}
          settings={project.settings}
          printer={project.printer}
          usedTools={usedTools}
          plate={project.activePlate}
          models={activeModels}
          onChange={(filaments, multiMaterial) =>
            commit((p) => ({
              ...p,
              filaments,
              multiMaterial,
              settings:
                filaments.length === 1
                  ? settingsForFilament(p.settings, filaments[0])
                  : p.settings,
            }))
          }
        />
      </Modal>
      <Modal
        opened={modal === "printer"}
        onClose={() => !loadingPrinter && setModal(null)}
        withCloseButton={!loadingPrinter}
        closeOnEscape={!loadingPrinter}
        closeOnClickOutside={!loadingPrinter}
        title="Printer configuration"
        size="lg"
      >
        <Stack gap="md">
          <fieldset
            disabled={loadingPrinter}
            style={{
              border: 0,
              padding: 0,
              margin: 0,
              minWidth: 0,
              display: "contents",
            }}
          >
            <Alert color="gray" title="Machine-specific setup">
              {printerDraft.firmware ? (
                <>
                  This profile uses the manufacturer's machine sequences.{" "}
                  <a
                    href={printerDraft.profileSource}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View official profile source
                  </a>
                  . Changing the nozzle loads its official machine sequences
                  when you save.
                  {printerDraft.firmware === "snapmaker-u1" &&
                    " All four U1 heads must use the same diameter."}
                </>
              ) : (
                <>
                  Set the build volume, tool system, and G-code sequences for
                  your machine.
                </>
              )}
            </Alert>
            <TextInput
              label="Printer name"
              value={printerDraft.name}
              onChange={(e) =>
                setPrinterDraft((p) => ({
                  ...p,
                  name: e.target.value,
                  id: p.firmware ? p.id : "generic",
                }))
              }
            />
            {printerDraft.id === "bambu-x1c" && (
              <Select
                label="X1 Carbon mains supply"
                description="Maximum bed temperature: 120°C on 110 V; 110°C on 220 V."
                data={[
                  { value: "unknown", label: "Unspecified (110°C bed limit)" },
                  { value: "110", label: "110 V" },
                  { value: "220", label: "220 V" },
                ]}
                value={String(printerDraft.mainsVoltage ?? "unknown")}
                allowDeselect={false}
                onChange={(v) =>
                  setPrinterDraft((p) => ({
                    ...p,
                    mainsVoltage:
                      v === "110" ? 110 : v === "220" ? 220 : undefined,
                  }))
                }
              />
            )}
            <div className="three-fields">
              {["Build width (X)", "Build depth (Y)", "Build height (Z)"].map(
                (label, i) => (
                  <NumberInput
                    key={label}
                    label={label}
                    value={printerDraft.bed[i]}
                    min={20}
                    max={2000}
                    suffix=" mm"
                    onChange={(v) => {
                      if (typeof v === "number" && v >= 20 && v <= 2000)
                        setPrinterDraft((p) => ({
                          ...p,
                          bed: p.bed.map((n, j) => (j === i ? v : n)) as Vec3,
                        }));
                    }}
                  />
                ),
              )}
            </div>
            <div className="field-pair">
              <Select
                label="Nozzle diameter"
                allowDeselect={false}
                value={String(printerDraft.nozzle)}
                data={
                  printerDraft.firmware
                    ? VENDOR_NOZZLES.map(String)
                    : ["0.2", "0.25", "0.4", "0.6", "0.8", "1"]
                }
                description="Changing diameter resets layer heights, line width, support spacing and vendor retraction, and disables the saved manual layer curve."
                onChange={(v) =>
                  v && setPrinterDraft((p) => ({ ...p, nozzle: Number(v) }))
                }
              />
              <Select
                label="Filament diameter"
                value={String(printerDraft.filament)}
                allowDeselect={false}
                data={printerDraft.firmware ? ["1.75"] : ["1.75", "2.85"]}
                onChange={(v) =>
                  v && setPrinterDraft((p) => ({ ...p, filament: Number(v) }))
                }
              />
            </div>
            <div className="field-pair">
              <Select
                label="Tool system"
                value={printerDraft.multiMaterialMode ?? "single"}
                disabled={Boolean(printerDraft.firmware)}
                allowDeselect={false}
                data={[
                  { value: "single", label: "Single filament" },
                  {
                    value: "shared-nozzle",
                    label: "Shared nozzle / color changer",
                  },
                  { value: "toolchanger", label: "Independent toolheads" },
                ]}
                onChange={(v) =>
                  v &&
                  setPrinterDraft((p) => ({
                    ...p,
                    multiMaterialMode: v as PrinterType["multiMaterialMode"],
                    toolCount:
                      v === "single" ? 1 : Math.max(2, p.toolCount ?? 4),
                    hardware: {
                      ...p.hardware,
                      abrasiveTools: p.hardware?.abrasiveTools?.filter(
                        (t) => v === "toolchanger" || t === 0,
                      ),
                    },
                  }))
                }
              />
              <NumberInput
                label="Filament slots"
                value={printerDraft.toolCount ?? 1}
                min={1}
                max={64}
                allowDecimal={false}
                disabled={
                  Boolean(printerDraft.firmware) ||
                  (printerDraft.multiMaterialMode ?? "single") === "single"
                }
                onChange={(v) =>
                  typeof v === "number" &&
                  v >= 1 &&
                  v <= 64 &&
                  setPrinterDraft((p) => ({
                    ...p,
                    toolCount: v,
                    hardware: {
                      ...p.hardware,
                      abrasiveTools: p.hardware?.abrasiveTools?.filter(
                        (t) => t < v,
                      ),
                    },
                  }))
                }
              />
            </div>
            <PrinterHardware
              printer={printerDraft}
              onChange={setPrinterDraft}
            />
            <Tabs defaultValue="start">
              <Tabs.List>
                <Tabs.Tab value="start">Start G-code</Tabs.Tab>
                <Tabs.Tab value="end">End G-code</Tabs.Tab>
                <Tabs.Tab value="change">Tool-change G-code</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="start" pt="sm">
                <Textarea
                  aria-label="Start G-code"
                  disabled={
                    Boolean(printerDraft.firmware) &&
                    (printerDraft.profileNozzle ?? 0.4) !== printerDraft.nozzle
                  }
                  autosize
                  minRows={7}
                  maxRows={14}
                  className="code-input"
                  value={printerDraft.startGcode}
                  onChange={(e) =>
                    setPrinterDraft((p) => ({
                      ...p,
                      startGcode: e.target.value,
                    }))
                  }
                />
              </Tabs.Panel>
              <Tabs.Panel value="end" pt="sm">
                <Textarea
                  aria-label="End G-code"
                  disabled={
                    Boolean(printerDraft.firmware) &&
                    (printerDraft.profileNozzle ?? 0.4) !== printerDraft.nozzle
                  }
                  autosize
                  minRows={7}
                  maxRows={14}
                  className="code-input"
                  value={printerDraft.endGcode}
                  onChange={(e) =>
                    setPrinterDraft((p) => ({ ...p, endGcode: e.target.value }))
                  }
                />
              </Tabs.Panel>
              <Tabs.Panel value="change" pt="sm">
                <Textarea
                  aria-label="Tool-change G-code"
                  disabled={
                    Boolean(printerDraft.firmware) &&
                    (printerDraft.profileNozzle ?? 0.4) !== printerDraft.nozzle
                  }
                  autosize
                  minRows={7}
                  maxRows={14}
                  className="code-input"
                  readOnly={printerDraft.firmware === "snapmaker-u1"}
                  value={printerDraft.toolChangeGcode ?? "T{tool}"}
                  onChange={(e) =>
                    setPrinterDraft((p) => ({
                      ...p,
                      toolChangeGcode: e.currentTarget.value,
                    }))
                  }
                />
              </Tabs.Panel>
            </Tabs>
            <Text size="xs" c="dimmed">
              Available placeholders: {"{temp}"}, {"{bed_temp}"}, {"{tool}"}.
              Output uses absolute XYZ. Multi-filament output uses relative
              extrusion.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                loading={loadingPrinter}
                onClick={async () => {
                  setLoadingPrinter(true);
                  try {
                    const loaded = await loadVendorPrinter(printerDraft);
                    commit((p) => applyPrinter(p, loaded));
                    setModal(null);
                  } catch (error) {
                    notify((error as Error).message, "red");
                  } finally {
                    setLoadingPrinter(false);
                  }
                }}
              >
                Save printer
              </Button>
            </Group>
          </fieldset>
        </Stack>
      </Modal>
      <Modal
        opened={editing}
        onClose={() => abortRef.current?.abort()}
        title="Editing materials"
        closeOnClickOutside={false}
      >
        <Stack>
          <Text size="sm">{stage}</Text>
          <Progress value={progress} animated />
          <Text size="xs" c="dimmed">
            Your original model is kept until the edit finishes.
          </Text>
          <Button variant="default" onClick={() => abortRef.current?.abort()}>
            Cancel edit
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={modal === "height-color"}
        onClose={() => setModal(null)}
        title="Color by height"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Assign a filament above a horizontal boundary. Parts stay aligned
            and move together. Colors below the boundary are preserved. Repeat
            to add more color bands.
          </Text>
          <NumberInput
            label="Color boundary above bed"
            suffix=" mm"
            value={cutHeight}
            onChange={(v) => typeof v === "number" && setCutHeight(v)}
            min={0.01}
            decimalScale={2}
            step={project.settings.layerHeight}
          />
          <Select
            label="Filament above boundary"
            data={filaments.map((f, i) => ({
              value: String(i),
              label: `${i + 1}. ${f.name}`,
            }))}
            value={heightTool}
            onChange={(v) => v !== null && setHeightTool(v)}
            allowDeselect={false}
          />
          <Text size="xs" c="dimmed">
            The printed transition follows the configured layer heights.
          </Text>
          <Button onClick={applyHeightColor}>Apply height color</Button>
        </Stack>
      </Modal>
      <Modal
        opened={modal === "cut"}
        onClose={() => setModal(null)}
        title="Cut model horizontally"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Split the selected object at a horizontal plane and cap the cut
            surfaces. Painted colors become linked solid material parts.
          </Text>
          <NumberInput
            label="Height above bed"
            suffix=" mm"
            value={cutHeight}
            onChange={(v) => typeof v === "number" && setCutHeight(v)}
            min={0.1}
            max={
              model
                ? partsBounds(
                    transformWholeAssembly
                      ? assemblyParts(activeModels, model)
                      : [model],
                  ).max.z - 0.01
                : undefined
            }
            step={1}
          />
          <Select
            label="Keep"
            value={cutKeep}
            onChange={(v) => v && setCutKeep(v)}
            data={[
              { value: "both", label: "Both parts" },
              { value: "lower", label: "Lower part" },
              { value: "upper", label: "Upper part" },
            ]}
          />
          <Switch
            label="Place upper part cut-face down"
            checked={cutFlip}
            onChange={(e) => setCutFlip(e.currentTarget.checked)}
          />
          <Button leftSection={<Scissors size={16} />} onClick={cut}>
            Cut and arrange
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={modal === "presets"}
        onClose={() => setModal(null)}
        title="Print presets"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Save reusable process and material settings on this device. With
            multiple filaments, applying a preset updates process and shared bed
            settings; edit each spool in Manage filaments.
          </Text>
          <Group align="end" wrap="nowrap">
            <TextInput
              label="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button
              disabled={!presetName.trim()}
              onClick={() => {
                const list = [
                  ...presets.filter((p) => p.name !== presetName),
                  { name: presetName, settings: { ...project.settings } },
                ];
                setPresets(list);
                localStorage.setItem("stratum-presets", JSON.stringify(list));
                notify("Print preset saved.");
              }}
            >
              Save current
            </Button>
          </Group>
          {presets.map((p, i) => (
            <Group key={p.name} justify="space-between">
              <Text size="sm">{p.name}</Text>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => {
                    commit((old) =>
                      applySettingsPatch(old, {
                        ...DEFAULT_SETTINGS,
                        ...p.settings,
                      }),
                    );
                    setModal(null);
                  }}
                >
                  Apply
                </Button>
                <ActionIcon
                  aria-label={`Delete preset ${p.name}`}
                  color="red"
                  variant="subtle"
                  onClick={() => {
                    const list = presets.filter((_, j) => j !== i);
                    setPresets(list);
                    localStorage.setItem(
                      "stratum-presets",
                      JSON.stringify(list),
                    );
                  }}
                >
                  <Trash2 size={15} />
                </ActionIcon>
              </Group>
            </Group>
          ))}
          <Divider />
          <Group>
            <Button
              size="xs"
              variant="default"
              onClick={() =>
                download(
                  JSON.stringify(
                    {
                      version: 1,
                      name: presetName,
                      settings: project.settings,
                    },
                    null,
                    2,
                  ),
                  "stratum-preset.json",
                  "application/json",
                )
              }
            >
              Export current preset
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={() => presetInput.current?.click()}
            >
              Import preset
            </Button>
          </Group>
          <input
            hidden
            type="file"
            accept=".json"
            ref={presetInput}
            onChange={async (e) => {
              try {
                const file = e.target.files?.[0];
                if (!file) return;
                const data = JSON.parse(await file.text());
                const p = await readProject(
                  new File(
                    [
                      JSON.stringify({
                        ...project,
                        models: [],
                        settings: data.settings,
                        filaments: undefined,
                        multiMaterial: undefined,
                      }),
                    ],
                    "preset.webslicer",
                  ),
                );
                commit((old) => applySettingsPatch(old, p.settings));
                notify("Preset applied.");
              } catch {
                notify("Invalid preset file.", "red");
              }
              e.target.value = "";
            }}
          />
        </Stack>
      </Modal>
      <Modal
        opened={modal === "connection"}
        onClose={() => setModal(null)}
        title="Connect your printer"
        size="md"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Upload G-code to OctoPrint or a Moonraker / Klipper server.
            Uploading does not start a print. Your API key stays in memory for
            this session.
          </Text>
          <SegmentedControl
            value={connection.type}
            onChange={(type) =>
              setConnection((c) => ({ ...c, type, connected: false }))
            }
            data={[
              { value: "octoprint", label: "OctoPrint" },
              { value: "moonraker", label: "Moonraker" },
            ]}
          />
          <TextInput
            label="Printer server URL"
            placeholder="http://octopi.local"
            value={connection.url}
            onChange={(e) =>
              setConnection((c) => ({
                ...c,
                url: e.target.value,
                connected: false,
              }))
            }
          />
          <TextInput
            label="API key"
            type="password"
            value={connection.key}
            onChange={(e) =>
              setConnection((c) => ({
                ...c,
                key: e.target.value,
                connected: false,
              }))
            }
          />
          {connection.status && (
            <Alert color={connection.connected ? "forest" : "orange"}>
              {connection.status}
            </Alert>
          )}
          <Text size="xs" c="dimmed">
            The server must allow browser requests (CORS). HTTPS workspaces
            require a reachable HTTPS printer endpoint.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              loading={networkBusy}
              disabled={!connection.url}
              onClick={() => void connectPrinter()}
            >
              Test connection
            </Button>
            <Button
              loading={networkBusy}
              disabled={!result || !connection.connected}
              onClick={() => void connectPrinter(true)}
            >
              Upload G-code
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={modal === "gcode"}
        onClose={() => setModal(null)}
        title="Generated G-code"
        size="xl"
      >
        <Group justify="space-between" mb="md">
          <Text size="sm" c="dimmed">
            First 500 lines ·{" "}
            {result?.gcode.split("\n").length.toLocaleString()} lines total
          </Text>
          <Button
            size="xs"
            leftSection={<Download size={14} />}
            onClick={exportGcode}
          >
            Download complete file
          </Button>
        </Group>
        <ScrollArea h={420}>
          <pre className="gcode-view">
            {result?.gcode.split("\n").slice(0, 500).join("\n")}
          </pre>
        </ScrollArea>
      </Modal>
      <Modal
        opened={modal === "help"}
        onClose={() => setModal(null)}
        title="Made for your next layer."
        size="lg"
      >
        <Stack>
          <Text>
            Stratum is a local browser slicer built with React, Mantine,
            Three.js, and the Kiri:Moto slicing engine. Models and projects stay
            on your device unless you upload G-code to your printer.
          </Text>
          <Tabs defaultValue="guide">
            <Tabs.List>
              <Tabs.Tab value="guide">Getting started</Tabs.Tab>
              <Tabs.Tab value="shortcuts">Shortcuts</Tabs.Tab>
              <Tabs.Tab value="about">Capabilities</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="guide" pt="md">
              <ol className="help-list">
                <li>
                  Import an STL, OBJ, or 3MF mesh, or add a starter shape.
                </li>
                <li>
                  Choose a printer and material. Review your machine’s start/end
                  G-code and installed material hardware. In Manage filaments,
                  configure each spool’s material requirements from its
                  manufacturer data.
                </li>
                <li>
                  Move, rotate, scale, cut, duplicate, and arrange models on
                  plates.
                </li>
                <li>
                  Set quality, infill, supports, temperatures, and adhesion.
                </li>
                <li>Slice locally, inspect the layers, and export G-code.</li>
              </ol>
              <Text size="sm" c="dimmed">
                Desktop: drag to orbit, scroll to zoom, right-drag to pan.
                Touch: one finger to orbit, pinch to zoom, two fingers to pan.
                Projects recover automatically on this browser; save a
                .webslicer file for backup or sharing.
              </Text>
            </Tabs.Panel>
            <Tabs.Panel value="shortcuts" pt="md">
              <Table>
                <Table.Tbody>
                  {[
                    ["⌘ / Ctrl + O", "Import model / open project"],
                    ["⌘ / Ctrl + S", "Save project file"],
                    ["⌘ / Ctrl + Z", "Undo"],
                    ["⌘ / Ctrl + Shift + Z", "Redo"],
                    ["⌘ / Ctrl + D", "Duplicate selected model"],
                    ["M / R / S", "Move / rotate / scale"],
                    ["F", "Fit model in view"],
                    ["Delete", "Delete selection"],
                    ["Esc", "Deselect"],
                  ].map(([key, value]) => (
                    <Table.Tr key={key}>
                      <Table.Td>
                        <kbd>{key}</kbd>
                      </Table.Td>
                      <Table.Td>{value}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Tabs.Panel>
            <Tabs.Panel value="about" pt="md">
              <Text size="sm">
                Multi-tool FDM slicing with normal or branching tree supports,
                adaptive and manual variable layers, spiral vase, multiple
                infill patterns, and skirt/brim/raft. Multiple objects and
                plates, G-code inspection, and reusable print presets are
                supported. Imported G-code previews include tool-colored arcs,
                circles and helices.
              </Text>
              <Text size="sm" mt="md">
                Assign filament to each part, paint surfaces, or use Color by
                height to create linked bands. Bambu AMS and Snapmaker U1
                profiles are available. U1 exports include printer thumbnails
                and filament details. Manage filaments sets cooling, fan start
                layer, temperature and flow for each spool; bed temperature is
                shared. Cuts, splits, and height colors preserve painted
                materials as linked solid parts. Paint supports independently
                with enforce, block and restore tools. Object modifiers change
                regional wall/skin counts, infill, print speed, extrusion flow
                and support contacts. STEP, resin slicing, and full Orca project
                settings are not supported. 3MF imports component geometry,
                material assignments, and painted facets. Generated paths still
                need printer-specific validation.
              </Text>
              <Text size="sm" mt="md">
                <a
                  href="https://github.com/GridSpace/grid-apps"
                  target="_blank"
                  rel="noreferrer"
                >
                  Kiri:Moto engine · GridSpace
                </a>{" "}
                ·{" "}
                <a
                  href={`${import.meta.env.BASE_URL}engine/LICENSE.md`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Engine license
                </a>
              </Text>
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Modal>
      {dragging && (
        <div className="drop-overlay">
          <Upload size={42} />
          <strong>Drop it on the plate.</strong>
          <span>STL, OBJ, 3MF, G-code, or a Stratum project</span>
        </div>
      )}
    </div>
  );
}
function GridIcon() {
  return <LayoutGrid size={15} />;
}
export default App;
