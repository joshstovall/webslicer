import { useMediaQuery } from "@mantine/hooks";
import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import type { Printer, Settings } from "../types";
import { flatLayerCurve, manualLayerErrors } from "../lib/layer-height";
import { planManualLayers } from "../../public/engine/layer-plan.js";

type Point = { z: number; height: number };
export function LayerHeightEditor({
  settings,
  printer,
  modelHeight,
  onSave,
  onClose,
}: {
  settings: Settings;
  printer: Printer;
  modelHeight: number;
  onSave: (points: Point[]) => void;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<Point[]>(() =>
    structuredClone(
      settings.layerHeightCurve ??
        flatLayerCurve(settings.layerHeight, modelHeight),
    ),
  );
  const [selected, setSelected] = useState(0);
  const drag = useRef<number | undefined>(undefined);
  const compact = useMediaQuery("(max-width: 600px)");
  const chartWidth = compact ? 340 : 600;
  const chartLeft = compact ? 48 : 60,
    chartRight = chartWidth - 20;
  const chartSpan = chartRight - chartLeft;
  const min = settings.minLayerHeight,
    max = settings.layerHeight;
  const zMax = Math.max(1, modelHeight, points.at(-1)!.z);
  const errors = manualLayerErrors(printer, {
    ...settings,
    manualLayers: true,
    adaptive: false,
    layerHeightCurve: points,
  });
  const preview = useMemo(() => {
    if (errors.length || modelHeight <= 0) return undefined;
    try {
      return planManualLayers([{ vertices: [0, 0, modelHeight] }], {
        sliceMinHeight: min,
        sliceHeight: max,
        firstSliceHeight: settings.firstLayerHeight,
        stratumLayerCurve: points,
      });
    } catch {
      return undefined;
    }
  }, [points, modelHeight, min, max, settings.firstLayerHeight, errors.length]);
  const round = (n: number) => Number(n.toFixed(3));
  const x = (z: number) => chartLeft + (z / zMax) * chartSpan;
  const y = (height: number) =>
    210 - ((height - min) / Math.max(0.001, max - min)) * 170;
  function update(index: number, value: Partial<Point>) {
    setPoints((old) =>
      old.map((point, i) =>
        i === index
          ? {
              z:
                index === 0
                  ? 0
                  : round(
                      Math.max(
                        old[index - 1].z + 0.001,
                        Math.min(
                          old[index + 1] ? old[index + 1].z - 0.001 : 2000,
                          value.z ?? point.z,
                        ),
                      ),
                    ),
              height: round(
                Math.max(min, Math.min(max, value.height ?? point.height)),
              ),
            }
          : point,
      ),
    );
  }
  function add(z?: number, height?: number) {
    if (points.length >= 128) return;
    if (z === undefined) {
      let gap = -1;
      for (let i = 1; i < points.length; i++)
        if (points[i].z - points[i - 1].z > gap) {
          gap = points[i].z - points[i - 1].z;
          z = (points[i].z + points[i - 1].z) / 2;
          height = (points[i].height + points[i - 1].height) / 2;
        }
    }
    const point = {
      z: round(z!),
      height: round(Math.max(min, Math.min(max, height!))),
    };
    if (
      point.z < 0.001 ||
      points.some((p) => Math.abs(p.z - point.z) < 0.001 - 1e-9)
    )
      return;
    const next = [...points, point].sort((a, b) => a.z - b.z);
    setPoints(next);
    setSelected(next.indexOf(point));
    return next.indexOf(point);
  }
  function remove() {
    if (points.length <= 2 || selected === 0) return;
    setPoints(points.filter((_, i) => i !== selected));
    setSelected(Math.min(selected, points.length - 2));
  }
  return (
    <Modal opened onClose={onClose} title="Variable layer heights" size="lg">
      <Stack gap="md">
        <Text size="sm">
          Drag points or enter exact values. The curve applies to every object
          and color, on each build plate. Z is measured from the model bed,
          before any raft offset.
        </Text>
        <Text size="sm" c="dimmed">
          First layer: {settings.firstLayerHeight} mm. Curve range: {min}–{max}{" "}
          mm. Final layers may adjust to fit the model height.
        </Text>
        {errors.length > 0 && (
          <Alert color="red" title="Check layer heights">
            {errors.join(" ")}
          </Alert>
        )}
        <svg
          viewBox={`0 0 ${chartWidth} 255`}
          role="group"
          aria-label="Layer height curve"
          style={{
            width: "100%",
            touchAction: "none",
            borderRadius: 8,
            background: "var(--mantine-color-gray-0)",
          }}
          onPointerDown={(e) => {
            if (errors.length || e.button !== 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * chartWidth;
            const py = ((e.clientY - r.top) / r.height) * 255;
            // A 44 px hit area on phones; select the closest point when targets overlap.
            const nearest = points
              .map((p, i) => ({
                i,
                distance: Math.hypot(
                  ((x(p.z) - px) * r.width) / chartWidth,
                  ((y(p.height) - py) * r.height) / 255,
                ),
              }))
              .sort((a, b) => a.distance - b.distance)[0];
            if (nearest.distance <= 22) {
              drag.current = nearest.i;
              setSelected(nearest.i);
            } else {
              if (px < chartLeft || px > chartRight || py < 40 || py > 210)
                return;
              drag.current = add(
                ((px - chartLeft) / chartSpan) * zMax,
                min + ((210 - py) / 170) * (max - min),
              );
            }
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current === undefined) return;
            const r = e.currentTarget.getBoundingClientRect(),
              px = ((e.clientX - r.left) / r.width) * chartWidth,
              py = ((e.clientY - r.top) / r.height) * 255;
            update(drag.current, {
              z: Math.max(
                0,
                Math.min(zMax, ((px - chartLeft) / chartSpan) * zMax),
              ),
              height: min + ((210 - py) / 170) * (max - min),
            });
          }}
          onPointerUp={() => {
            drag.current = undefined;
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
        >
          {[0, 0.5, 1].map((r) => (
            <g key={r}>
              <line
                x1={chartLeft}
                x2={chartRight}
                y1={40 + r * 170}
                y2={40 + r * 170}
                stroke="#ccd5c7"
              />
              <text
                x={chartLeft - 9}
                y={44 + r * 170}
                textAnchor="end"
                fontSize="13"
                fill="#354b2e"
              >
                {round(max - r * (max - min))}
              </text>
            </g>
          ))}
          <text x={chartLeft} y="23" fontSize="14" fill="#354b2e">
            Layer height (mm)
          </text>
          <text x={chartLeft} y="233" fontSize="13" fill="#354b2e">
            0
          </text>
          <text
            x={chartRight}
            y="233"
            textAnchor="end"
            fontSize="13"
            fill="#354b2e"
          >
            {round(zMax)}
          </text>
          <text
            x={(chartLeft + chartRight) / 2}
            y="249"
            textAnchor="middle"
            fontSize="14"
            fill="#354b2e"
          >
            Model Z (mm)
          </text>
          <polyline
            fill="none"
            stroke="#43663a"
            strokeWidth="3"
            points={[
              ...points.map(
                (p) => `${x(p.z)},${y(Math.min(max, Math.max(min, p.height)))}`,
              ),
              `${x(zMax)},${y(Math.min(max, Math.max(min, points.at(-1)!.height)))}`,
            ].join(" ")}
          />
          {points.map((p, i) => (
            <circle
              key={i}
              data-index={i}
              cx={x(p.z)}
              cy={y(Math.min(max, Math.max(min, p.height)))}
              r={i === selected ? 10 : 8}
              fill={i === selected ? "#43663a" : "#fff"}
              stroke="#43663a"
              strokeWidth="3"
              tabIndex={0}
              role="button"
              aria-label={`Curve point ${i + 1}, Z ${p.z} mm, height ${p.height} mm`}
              aria-pressed={i === selected}
              onFocus={() => setSelected(i)}
              onKeyDown={(e) => {
                if (
                  ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  update(
                    i,
                    e.key === "ArrowUp" || e.key === "ArrowDown"
                      ? {
                          height:
                            p.height + (e.key === "ArrowUp" ? 0.01 : -0.01),
                        }
                      : { z: p.z + (e.key === "ArrowRight" ? 0.1 : -0.1) },
                  );
                }
              }}
            />
          ))}
        </svg>
        <Select
          label="Control point"
          value={String(selected)}
          allowDeselect={false}
          data={points.map((p, i) => ({
            value: String(i),
            label: `Point ${i + 1} · Z ${p.z} mm`,
          }))}
          onChange={(v) => v !== null && setSelected(Number(v))}
        />
        <div className="field-pair">
          <NumberInput
            label="Point height (Z)"
            value={points[selected].z}
            disabled={selected === 0}
            min={selected ? points[selected - 1].z + 0.001 : 0}
            max={points[selected + 1] ? points[selected + 1].z - 0.001 : 2000}
            step={0.1}
            decimalScale={3}
            suffix=" mm"
            onChange={(v) =>
              typeof v === "number" && update(selected, { z: v })
            }
          />
          <NumberInput
            label="Layer height at point"
            value={points[selected].height}
            min={min}
            max={max}
            step={0.01}
            decimalScale={3}
            suffix=" mm"
            error={
              points[selected].height < min || points[selected].height > max
            }
            onChange={(v) =>
              typeof v === "number" && update(selected, { height: v })
            }
          />
        </div>
        <Group gap="xs">
          <Button
            variant="light"
            size="xs"
            disabled={points.length >= 128}
            onClick={() => add()}
          >
            Add point
          </Button>
          <Button
            variant="default"
            size="xs"
            disabled={selected === 0 || points.length <= 2}
            onClick={remove}
          >
            Remove point
          </Button>
          <Button
            variant="default"
            size="xs"
            onClick={() => {
              setPoints(flatLayerCurve(max, modelHeight));
              setSelected(0);
            }}
          >
            Reset flat
          </Button>
        </Group>
        {preview && (
          <Text size="sm" aria-live="polite">
            {preview.length} planned layers · model top {round(modelHeight)} mm
            · final layer top {preview.at(-1)!.top} mm
          </Text>
        )}
        <Text size="xs" c="dimmed">
          Heights change linearly between points and stay constant after the
          last point. The normal layer-height setting is the upper limit. Arrow
          keys move a focused point.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={errors.length > 0} onClick={() => onSave(points)}>
            Apply layer curve
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
