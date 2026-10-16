export type Vec3 = [number, number, number];
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
}
export interface MultiMaterialSettings {
  purgeTower: boolean;
  purgeVolume: number;
  /** Directional overrides in mm³, keyed by zero-based "from:to" slots. */
  purgeVolumes?: Record<string, number>;
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
  bedOrigin?: [number, number];
  bedType?: string;
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
export interface SliceResult {
  source?: { file: File; printer?: Printer };
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
export const FEATURE_COLORS = [
  "#478d69",
  "#d7a84f",
  "#6b9fbc",
  "#ba80bc",
  "#b9c0c5",
  "#cf7955",
];
export const FEATURE_NAMES = [
  "Walls",
  "Infill",
  "Solid layers",
  "Supports",
  "Travel",
  "Purge tower",
];
