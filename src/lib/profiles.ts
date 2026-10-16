import { supportInterfaceSettings } from "./support-interface-settings";
import { treeSettings } from "./tree-settings";
import type {
  Printer,
  Settings,
  Filament,
  MultiMaterialSettings,
} from "../types";
import { VENDOR_PRINTERS } from "./vendor-printers";
import { maximumPurgeVolume } from "./multimaterial";
import { bedExclusions } from "./bed-exclusions";
const startGcode = `; Stratum / generic Marlin-compatible start\nG90\nM82\nM140 S{bed_temp}\nM104 S{temp}\nG28\nM190 S{bed_temp}\nM109 S{temp}\nG92 E0`;
const endGcode = `M400\nG92 E0\nG1 E-1 F1800\nM104 S0\nM140 S0\nM107\nM84`;
export const PRINTERS: Printer[] = [
  {
    id: "ender3",
    name: "Creality Ender-3",
    bed: [220, 220, 250],
    nozzle: 0.4,
    filament: 1.75,
    startGcode,
    endGcode,
  },
  {
    id: "prusa",
    name: "Original Prusa MK4",
    bed: [250, 210, 220],
    nozzle: 0.4,
    filament: 1.75,
    startGcode,
    endGcode,
  },
  {
    id: "voron",
    name: "Voron 2.4 · 300",
    bed: [300, 300, 300],
    nozzle: 0.4,
    filament: 1.75,
    startGcode,
    endGcode,
  },
  {
    id: "generic-multi",
    name: "Custom multi-extruder FDM",
    bed: [256, 256, 256],
    nozzle: 0.4,
    filament: 1.75,
    startGcode,
    endGcode,
    toolCount: 4,
    multiMaterialMode: "toolchanger",
    toolChangeGcode: "T{tool}",
  },
  {
    id: "generic",
    name: "Custom FDM printer",
    bed: [256, 256, 256],
    nozzle: 0.4,
    filament: 1.75,
    startGcode,
    endGcode,
  },
  ...VENDOR_PRINTERS,
];
export const MATERIALS = [
  {
    name: "PLA",
    nozzle: 210,
    bed: 60,
    density: 1.24,
    fan: 100,
    flow: 15,
    color: "#91ad87",
  },
  {
    name: "PETG",
    nozzle: 240,
    bed: 80,
    density: 1.27,
    fan: 40,
    flow: 10,
    color: "#7198b1",
  },
  {
    name: "ABS",
    nozzle: 250,
    bed: 100,
    density: 1.04,
    fan: 20,
    flow: 12,
    color: "#d7a763",
  },
  {
    name: "ASA",
    nozzle: 255,
    bed: 100,
    density: 1.07,
    fan: 20,
    flow: 12,
    color: "#c6b3aa",
  },
  {
    name: "TPU",
    nozzle: 225,
    bed: 45,
    density: 1.21,
    fan: 70,
    flow: 3,
    color: "#bb8ca5",
  },
];
export const DEFAULT_SETTINGS: Settings = {
  layerHeight: 0.2,
  firstLayerHeight: 0.24,
  lineWidth: 0.42,
  walls: 3,
  topLayers: 5,
  bottomLayers: 4,
  infill: 15,
  infillPattern: "gyroid",
  infillAngle: 45,
  infillOverlap: 15,
  wallOrder: "in-out",
  seam: "last",
  thinWalls: true,
  adaptive: false,
  manualLayers: false,
  minLayerHeight: 0.1,
  vase: false,
  supports: "disabled",
  supportDensity: 15,
  supportAngle: 50,
  supportOffset: 0.4,
  adhesion: "skirt",
  brimWidth: 5,
  brimGap: 0.1,
  skirtLoops: 2,
  skirtDistance: 3,
  speed: 60,
  outerSpeed: 40,
  travelSpeed: 150,
  firstLayerSpeed: 25,
  minLayerTime: 8,
  minPrintSpeed: 10,
  fanRampLayers: 1,
  maxFlow: 15,
  nozzleTemp: 210,
  bedTemp: 60,
  firstNozzleTemp: 215,
  firstBedTemp: 60,
  fan: 100,
  fanLayer: 2,
  retraction: 0.8,
  retractSpeed: 35,
  zHop: 0.2,
  flow: 1,
  density: 1.24,
  cost: 25,
  material: "PLA",
};
export const QUALITY = [
  { name: "Fine detail", value: 0.12 },
  { name: "Balanced", value: 0.2 },
  { name: "Draft", value: 0.28 },
];
export function processProfile(s: Settings, multi?: MultiMaterialSettings) {
  return {
    processName: "Stratum",
    outputPurgeTower: multi?.purgeTower
      ? maximumPurgeVolume(multi) / Math.min(s.layerHeight, s.firstLayerHeight)
      : 0,
    sliceSupportNozzle: multi?.supportTool ?? 0,
    sliceHeight: s.layerHeight,
    firstSliceHeight: s.firstLayerHeight,
    sliceLineWidth: s.lineWidth,
    sliceShells: s.vase ? 1 : s.walls,
    sliceTopLayers: s.vase ? 0 : s.topLayers,
    sliceBottomLayers: s.bottomLayers,
    sliceFillSparse: s.vase ? 0 : s.infill / 100,
    sliceFillType: s.vase ? "vase" : s.infillPattern,
    sliceFillAngle: s.infillAngle,
    sliceFillOverlap: s.infillOverlap / 100,
    sliceShellOrder: s.wallOrder,
    sliceLayerStart: s.seam,
    sliceDetectThin: s.thinWalls ? "basic" : "off",
    sliceAdaptive: s.manualLayers || s.adaptive,
    stratumLayerCurve: s.manualLayers ? s.layerHeightCurve : undefined,
    sliceMinHeight: s.minLayerHeight,
    sliceSupportType:
      s.supports === "tree"
        ? "auto"
        : s.supports === "tree-manual"
          ? "manual"
          : s.supports,
    sliceSupportTree: s.supports === "tree" || s.supports === "tree-manual",
    stratumTreeAngle: treeSettings(s).treeBranchAngle,
    stratumTreeSpacing: treeSettings(s).treeBranchSpacing,
    stratumTreeTipDiameter: treeSettings(s).treeTipDiameter,
    stratumTreeBranchDiameter: treeSettings(s).treeBranchDiameter,
    stratumSupportTopLayers:
      supportInterfaceSettings(s).supportTopInterfaceLayers,
    stratumSupportBottomLayers:
      supportInterfaceSettings(s).supportBottomInterfaceLayers,
    stratumSupportInterfaceDensity:
      supportInterfaceSettings(s).supportInterfaceDensity / 100,
    stratumSupportInterfaceAngle:
      supportInterfaceSettings(s).supportInterfaceAngle,
    sliceSupportDensity: s.supportDensity / 100,
    sliceSupportAngle: s.supportAngle,
    sliceSupportOffset: s.supportOffset,
    firstLayerBrim: s.adhesion === "brim" ? s.brimWidth : 0,
    firstLayerBrimGap: s.brimGap,
    outputBrimCount: s.adhesion === "skirt" ? s.skirtLoops : 0,
    outputBrimOffset: s.skirtDistance,
    outputRaft: s.adhesion === "raft",
    outputRaftSpacing: 0.2,
    outputFeedrate: s.speed,
    outputFinishrate: s.outerSpeed,
    outputSeekrate: s.travelSpeed,
    firstLayerRate: s.firstLayerSpeed,
    firstLayerFillRate: s.firstLayerSpeed,
    // Whole-layer cooling is applied after per-filament flow adjustment.
    outputMinLayerTime: 0,
    outputMaxFlowrate: s.maxFlow,
    outputTemp: s.nozzleTemp,
    outputBedTemp: s.bedTemp,
    firstLayerNozzleTemp: s.firstNozzleTemp,
    firstLayerBedTemp: s.firstBedTemp,
    outputFanSpeed: Math.round(s.fan * 2.55),
    outputFanLayer: s.fanLayer,
    firstLayerFanSpeed: 0,
    outputRetractDist: s.retraction,
    outputRetractSpeed: s.retractSpeed,
    zHopDistance: s.zHop,
    outputLayerRetract: true,
    outputShellMult: s.flow,
    outputFillMult: s.flow,
    outputSparseMult: s.flow,
    fdmArcEnabled: false,
  };
}
export function deviceProfile(p: Printer, filaments?: Filament[]) {
  // Explicit filament jobs use relative E so material flow can be applied
  // uniformly, including a single spool. The raw device API keeps its legacy default.
  const multi = Boolean(filaments?.length) || Boolean(p.firmware);
  return {
    deviceName: p.name,
    mode: "FDM",
    bedWidth: p.bed[0],
    bedDepth: p.bed[1],
    stratumBedExclusions: bedExclusions(p),
    maxHeight: p.bed[2],
    originCenter: false,
    extrudeAbs: !multi,
    gcodeFExt: "gcode",
    gcodeSpace: true,
    gcodeStrip: false,
    gcodePre: [
      ...(p.firmware ? [] : ["T{tool}", ...p.startGcode.split("\n")]),
      ";STRATUM_INITIAL_TOOL:{tool}",
      "T{tool}",
      "G90",
      multi ? "M83" : "M82",
      ";STRATUM_PRINT_BEGIN",
    ],
    gcodeChange: [
      ";STRATUM_TOOL_CHANGE:{last_tool}:{tool}",
      ...(p.firmware
        ? ["T{tool}"]
        : (p.toolChangeGcode ?? "T{tool}").split("\n")),
      ";STRATUM_TOOL_READY",
    ],
    gcodePost: [
      ";STRATUM_PRINT_END",
      ...(p.firmware
        ? []
        : [
            ...(multi && p.multiMaterialMode === "toolchanger"
              ? (filaments ?? []).map((_, i) => `M104 T${i} S0`)
              : []),
            ...p.endGcode.split("\n"),
          ]),
    ],
    gcodeFan: ["M106 S{fan_speed}"],
    gcodeLayer: [";LAYER:{layer}", ";Z:{z}"],
    gcodeFeature: [";TYPE:{feature}"],
    extruders: Array.from({ length: filaments?.length ?? 1 }, (_, tool) => ({
      extFilament: p.filament,
      extNozzle: p.nozzle,
      extOffsetX: p.bedOrigin?.[0] ?? 0,
      extOffsetY: p.bedOrigin?.[1] ?? 0,
      extSelect: [`T${tool}`],
      extDeselect: [],
    })),
  };
}
