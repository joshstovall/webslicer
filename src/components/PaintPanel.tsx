import { Button, Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import { useState } from "react";
import type { Filament } from "../types";
import type { PaintMode } from "../lib/surface-paint";
export interface PaintSettings {
  target?: "material" | "support";
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
  supportMode,
  onSupportMode,
}: {
  filaments: Filament[];
  settings: PaintSettings;
  onChange: (s: PaintSettings) => void;
  depth: number;
  onDepth: (n: number) => void;
  onClear: () => void;
  onDone: () => void;
  onView: (view: string) => void;
  supportMode: string;
  onSupportMode: (mode: string) => void;
}) {
  const support = settings.target === "support";
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="paint-panel">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" fw={700}>
            {support ? "Paint supports" : "Paint surfaces"}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            aria-label={
              collapsed ? "Show paint controls" : "Hide paint controls"
            }
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? "Show controls" : "Hide controls"}
          </Button>
          <Button size="compact-xs" variant="light" onClick={onDone}>
            Done painting
          </Button>
        </Group>
        {!collapsed && (
          <>
            <Select
              label="Paint target"
              value={settings.target ?? "material"}
              data={[
                { value: "material", label: "Filament colors" },
                { value: "support", label: "Support contacts" },
              ]}
              allowDeselect={false}
              size="xs"
              onChange={(v) =>
                v &&
                onChange({
                  ...settings,
                  target: v as PaintSettings["target"],
                  tool:
                    v === "support"
                      ? 1
                      : Math.min(settings.tool, filaments.length - 1),
                })
              }
            />
            <Select
              aria-label="Paint view"
              placeholder="Choose view"
              data={[
                { value: "bottom", label: "Bottom" },
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
              {support ? (
                <Select
                  label="Support paint"
                  value={String(settings.tool)}
                  data={[
                    { value: "1", label: "Enforce · green" },
                    { value: "2", label: "Block · red" },
                    { value: "0", label: "Restore automatic" },
                  ]}
                  allowDeselect={false}
                  size="xs"
                  onChange={(v) =>
                    v !== null && onChange({ ...settings, tool: Number(v) })
                  }
                />
              ) : (
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
              )}
              <Select
                label="Paint mode"
                value={settings.mode}
                data={[
                  { value: "brush", label: "Round brush" },
                  { value: "face", label: "Flat face" },
                  {
                    value: "color",
                    label: support ? "Replace support state" : "Replace color",
                  },
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
              {support ? (
                <Select
                  label="Support generation"
                  value={supportMode}
                  data={[
                    { value: "disabled", label: "Disabled" },
                    { value: "auto", label: "Automatic · normal" },
                    { value: "manual", label: "Enforced only" },
                    { value: "tree", label: "Automatic · branching trees" },
                    {
                      value: "tree-manual",
                      label: "Enforced only · branching trees",
                    },
                  ]}
                  allowDeselect={false}
                  size="xs"
                  onChange={(v) => v && onSupportMode(v)}
                />
              ) : (
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
              )}
            </div>
            {support && (
              <Text size="xs" c="dimmed">
                Paint undersides to control support contacts. Restore automatic
                removes the painted override. Use Bottom view or orbit below the
                model.
              </Text>
            )}
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
          </>
        )}
      </Stack>
    </div>
  );
}
