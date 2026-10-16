import { Button, Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import type { Filament } from "../types";
import type { PaintMode } from "../lib/surface-paint";
export interface PaintSettings {
  tool: number;
  radius: number;
  mode: PaintMode;
}
export function PaintPanel({
  filaments,
  settings,
  onChange,
  depth,
  onDepth,
  onClear,
  onDone,
  onView,
}: {
  filaments: Filament[];
  settings: PaintSettings;
  onChange: (s: PaintSettings) => void;
  depth: number;
  onDepth: (n: number) => void;
  onClear: () => void;
  onDone: () => void;
  onView: (view: string) => void;
}) {
  return (
    <div className="paint-panel">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" fw={700}>
            Paint surfaces
          </Text>
          <Button size="compact-xs" variant="light" onClick={onDone}>
            Done painting
          </Button>
        </Group>
        <Select
          aria-label="Paint view"
          placeholder="Choose view"
          data={[
            { value: "top", label: "Top" },
            { value: "front", label: "Front" },
            { value: "right", label: "Right" },
            { value: "home", label: "Isometric" },
            { value: "fit", label: "Fit model" },
          ]}
          onChange={(v) => v && onView(v)}
          size="xs"
        />
        <div className="field-pair">
          <Select
            label="Paint filament"
            value={String(settings.tool)}
            data={filaments.map((f, i) => ({
              value: String(i),
              label: `${i + 1}. ${f.name}`,
            }))}
            allowDeselect={false}
            onChange={(v) =>
              v !== null && onChange({ ...settings, tool: Number(v) })
            }
            size="xs"
          />
          <Select
            label="Paint mode"
            value={settings.mode}
            data={[
              { value: "brush", label: "Round brush" },
              { value: "face", label: "Flat face" },
              { value: "color", label: "Replace color" },
            ]}
            allowDeselect={false}
            onChange={(v) =>
              v && onChange({ ...settings, mode: v as PaintMode })
            }
            size="xs"
          />
        </div>
        <div className="field-pair">
          <NumberInput
            label="Brush radius"
            value={settings.radius}
            min={0.5}
            max={100}
            suffix=" mm"
            size="xs"
            disabled={settings.mode !== "brush"}
            onChange={(v) =>
              typeof v === "number" &&
              v >= 0.5 &&
              v <= 100 &&
              onChange({ ...settings, radius: v })
            }
          />
          <NumberInput
            label="Color depth"
            value={depth}
            min={0.1}
            max={20}
            step={0.2}
            decimalScale={2}
            suffix=" mm"
            size="xs"
            onChange={(v) =>
              typeof v === "number" && v >= 0.1 && v <= 20 && onDepth(v)
            }
          />
        </div>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Drag to paint. Right-drag or two fingers to orbit.
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={onClear}
          >
            Clear paint
          </Button>
        </Group>
      </Stack>
    </div>
  );
}
