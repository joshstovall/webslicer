export interface LayerCurvePoint {
  z: number;
  height: number;
}
export interface PlannedLayer {
  z: number;
  top: number;
  height: number;
}
export interface LayerProcess {
  sliceAdaptive?: boolean;
  sliceHeight: number;
  sliceMinHeight: number;
  firstSliceHeight: number;
  stratumLayerCurve?: LayerCurvePoint[];
}
export function validLayerCurve(points: unknown): points is LayerCurvePoint[];
export function sampleLayerCurve(points: LayerCurvePoint[], z: number): number;
export function planManualLayers(
  parts: { vertices: ArrayLike<number> }[],
  process: LayerProcess,
): PlannedLayer[] | undefined;
export function planAdaptiveLayers(
  parts: { vertices: ArrayLike<number> }[],
  process: LayerProcess,
): PlannedLayer[] | undefined;
