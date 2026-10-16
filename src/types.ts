export type Vec3 = [number, number, number];
export interface SupportPaint {
  positions: Float32Array;
  /** 0 = automatic, 1 = enforce, 2 = block, per surface triangle. */
  states: Uint8Array;
}
export interface ModifierMesh {
  id: string;
  name: string;
  positions: Float32Array;
  /** Transform relative to the owning model. */
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  enabled: boolean;
  /** Missing on older projects means infill. Support volumes select overhang contacts. */
  kind?:
    | "infill"
    | "support-enforcer"
    | "support-blocker"
    | "process"
    | "walls";
  /** Required for wall modifiers; integer 0–20. */
  walls?: number;
  /** Independent overrides; undefined inherits the preceding volume or base process. */
  speedPercent?: number;
  flowPercent?: number;
  infill: number;
  infillPattern: string;
}
export interface Model {
  id: string;
  name: string;
  positions: Float32Array;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  visible: boolean;
  plate: number;
  /** Zero-based filament slot; independent of the display color. */
  tool?: number;
  /** Parts with this ID form one positioned object. */
  assemblyId?: string;
  /** Per-triangle material slots, when surface paint is present. */
  faceTools?: Uint8Array;
  /** Optional subdivided surface for painting; the original closed solid stays intact. */
  paintTriangles?: Float32Array;
  /** Inward paint depth in world millimeters. */
  paintDepth?: number;
  /** Independent surface tessellation; never changes filament colors or the solid. */
  supportPaint?: SupportPaint;
  /** Ordered modifier volumes; later entries take priority. */
  modifiers?: ModifierMesh[];
}
export interface Filament {
  name: string;
  color: string;
  material: string;
  nozzleTemp: number;
  firstNozzleTemp: number;
  density: number;
  cost: number;
  flow: number;
  maxFlow: number;
  fan: number;
  /** First layer on which part cooling is enabled (one-based). */
  fanLayer?: number;
  bridgeFan?: number;
  auxiliaryFan?: number;
  auxiliaryFanLayer?: number;
  auxiliaryFanRampLayers?: number;
  fanRampLayers?: number;
  minLayerTime?: number;
  minPrintSpeed?: number;
  requirements?: {
    abrasive?: boolean;
    enclosure?: boolean;
    minNozzle?: number;
    bedRange?: [number, number];
    feedSystem?: "AMS" | "AMS lite";
    feedCompatibility?: "unspecified" | "compatible" | "incompatible";
  };
}
export interface MultiMaterialSettings {
  purgeTower: boolean;
  purgeVolume: number;
  /** Directional overrides in mm³, keyed by zero-based "from:to" slots. */
  purgeVolumes?: Record<string, number>;
  /** Independent Bambu station flush budget; omitted fields migrate from legacy tower budgets. */
  flushVolume?: number;
  flushVolumes?: Record<string, number>;
  /** First block center in machine XY millimeters, keyed by build plate ID. */
  towerPositions?: Record<string, { x: number; y: number; axis: "x" | "y" }>;
  supportTool: number;
}
export interface Printer {
  id: string;
  name: string;
  bed: Vec3;
  nozzle: number;
  filament: number;
  startGcode: string;
  endGcode: string;
  toolCount?: number;
  multiMaterialMode?: "single" | "shared-nozzle" | "toolchanger";
  toolChangeGcode?: string;
  profileSource?: string;
  firmware?: "bambu" | "snapmaker-u1";
  profileRevision?: string;
  /** Diameter associated with the stored machine sequences; legacy profiles imply 0.4 mm. */
  profileNozzle?: number;
  bedOrigin?: [number, number];
  bedType?: string;
  mainsVoltage?: 110 | 220;
  hardware?: {
    enclosed?: boolean;
    abrasiveTools?: number[];
    auxiliaryFan?: boolean;
    auxiliaryFanIndex?: number;
  };
}
export interface Settings {
  layerHeight: number;
  firstLayerHeight: number;
  lineWidth: number;
  walls: number;
  topLayers: number;
  bottomLayers: number;
  infill: number;
  infillPattern: string;
  infillAngle: number;
  infillOverlap: number;
  wallOrder: string;
  seam: string;
  thinWalls: boolean;
  adaptive: boolean;
  minLayerHeight: number;
  manualLayers?: boolean;
  /** Model-space Z / target height points, shared across every material on a plate. */
  layerHeightCurve?: { z: number; height: number }[];
  vase: boolean;
  supports: string;
  supportDensity: number;
  supportAngle: number;
  supportOffset: number;
  adhesion: string;
  brimWidth: number;
  brimGap: number;
  skirtLoops: number;
  skirtDistance: number;
  speed: number;
  outerSpeed: number;
  travelSpeed: number;
  firstLayerSpeed: number;
  minLayerTime: number;
  minPrintSpeed?: number;
  fanRampLayers?: number;
  maxFlow: number;
  nozzleTemp: number;
  bedTemp: number;
  firstNozzleTemp: number;
  firstBedTemp: number;
  fan: number;
  fanLayer: number;
  retraction: number;
  retractSpeed: number;
  zHop: number;
  flow: number;
  density: number;
  cost: number;
  material: string;
}
export interface Project {
  version: 1;
  name: string;
  models: Model[];
  printer: Printer;
  settings: Settings;
  plates: number[];
  activePlate: number;
  filaments?: Filament[];
  multiMaterial?: MultiMaterialSettings;
}
export type Feature = "wall" | "infill" | "solid" | "support" | "travel";
export interface ToolpathLayer {
  z: number;
  segments: Float32Array;
  features: Uint8Array;
  speeds: Float32Array;
  tools: Uint8Array;
}
export interface PrintEstimates {
  seconds?: number;
  filament?: number;
  weight?: number;
  tools: { tool: number; filament?: number; weight?: number }[];
  basis: string;
}
export interface SliceResult {
  source?: {
    file: File;
    printer?: Printer;
    plates?: PrintPackagePlate[];
    platePath?: string;
    estimates?: PrintEstimates;
  };
  gcode: string;
  layers: ToolpathLayer[];
  filament: number;
  seconds: number;
  weight: number;
  cost: number;
  warnings: string[];
  toolChanges: number;
  tools: {
    tool: number;
    color: string;
    name: string;
    filament: number;
    weight: number;
    cost: number;
  }[];
}
export interface PrintPackagePlate {
  path: string;
  name: string;
  index?: number;
  size: number;
  unavailable?: string;
}
export const FEATURE_COLORS = [
  "#478d69",
  "#d7a84f",
  "#6b9fbc",
  "#ba80bc",
  "#b9c0c5",
  "#cf7955",
  "#51a9a0",
];
export const FEATURE_NAMES = [
  "Walls",
  "Infill",
  "Solid layers",
  "Supports",
  "Travel",
  "Purge tower",
  "Bridges",
];
