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
}
export interface Printer {
  id: string;
  name: string;
  bed: Vec3;
  nozzle: number;
  filament: number;
  startGcode: string;
  endGcode: string;
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
}
export type Feature = "wall" | "infill" | "solid" | "support" | "travel";
export interface ToolpathLayer {
  z: number;
  segments: Float32Array;
  features: Uint8Array;
  speeds: Float32Array;
}
export interface SliceResult {
  gcode: string;
  layers: ToolpathLayer[];
  filament: number;
  seconds: number;
  weight: number;
  cost: number;
  warnings: string[];
}
export const FEATURE_COLORS = [
  "#478d69",
  "#d7a84f",
  "#6b9fbc",
  "#ba80bc",
  "#b9c0c5",
];
export const FEATURE_NAMES = [
  "Walls",
  "Infill",
  "Solid layers",
  "Supports",
  "Travel",
];
