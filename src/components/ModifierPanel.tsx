import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Alert,
  Button,
  Drawer,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import type { Model, ModifierMesh, Vec3 } from "../types";
import { importModels, mergedVertices, primitive } from "../lib/geometry";
import { MODIFIER_PATTERNS, validateModifiers } from "../lib/modifiers";
import { newId } from "../lib/id";

export function ModifierPanel({
  model,
  value,
  onChange,
  onSave,
  onClose,
  onView,
  selected,
  onSelect,
  tool,
  onTool,
  collapsed,
  onCollapsed,
}: {
  selected: string;
  onSelect: (id: string) => void;
  tool: "translate" | "rotate" | "scale";
  onTool: (tool: "translate" | "rotate" | "scale") => void;
  collapsed: boolean;
  onCollapsed: (value: boolean) => void;
  model: Model;
  value: ModifierMesh[];
  onChange: (v: ModifierMesh[]) => void;
  onSave: () => void;
  onClose: () => void;
  onView: (view: string) => void;
}) {
  const compact = useMediaQuery("(max-width: 760px)");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true),
    latestValue = useRef(value);
  latestValue.current = value;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const item = value.find((m) => m.id === selected);
  const update = (patch: Partial<ModifierMesh>) =>
    onChange(value.map((m) => (m.id === selected ? { ...m, ...patch } : m)));
  const add = (mesh: Model) => {
    const modifier: ModifierMesh = {
      id: newId(),
      name: mesh.name,
      positions: mesh.positions,
      position: mesh.position,
      rotation: mesh.rotation,
      scale: mesh.scale,
      enabled: true,
      infill: 100,
      infillPattern: "grid",
    };
    const next = [...latestValue.current, modifier];
    validateModifiers(next);
    onChange(next);
    onSelect(modifier.id);
    setError("");
  };
  const reorder = (direction: number) => {
    const index = value.findIndex((m) => m.id === selected),
      next = [...value];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <Drawer
      opened
      position={compact ? "bottom" : "right"}
      size={compact ? (collapsed ? 300 : "65%") : 390}
      title="Object modifiers"
      onClose={onClose}
      withOverlay={false}
      trapFocus={false}
      lockScroll={false}
      closeOnClickOutside={false}
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm" fw={600}>
            {item?.name ?? "Add a modifier volume"}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => onCollapsed(!collapsed)}
          >
            {collapsed ? "Show modifier settings" : "Hide modifier settings"}
          </Button>
        </Group>
        {!!value.length && (
          <Select
            label="Modifier volume"
            value={selected}
            allowDeselect={false}
            data={value.map((m, i) => ({
              value: m.id,
              label: `${i + 1}. ${m.name}${m.enabled ? "" : " (disabled)"}`,
            }))}
            onChange={(v) => v && onSelect(v)}
          />
        )}
        <Group grow gap="xs">
          {(["translate", "rotate", "scale"] as const).map((mode) => (
            <Button
              key={mode}
              size="xs"
              h={40}
              disabled={!item?.enabled}
              aria-label={`${mode === "translate" ? "Move" : mode === "rotate" ? "Rotate" : "Scale"} modifier volume`}
              aria-pressed={tool === mode}
              variant={tool === mode ? "filled" : "default"}
              onClick={() => onTool(mode)}
            >
              {mode === "translate"
                ? "Move"
                : mode === "rotate"
                  ? "Rotate"
                  : "Scale"}
            </Button>
          ))}
        </Group>
        {!collapsed && (
          <>
            <Text size="sm">
              Change walls, skins, infill, speed, flow or support contacts
              inside a volume on {model.name}
              {model.assemblyId ? " and its linked parts" : ""}. Later volumes
              take priority within each setting.
            </Text>
            <Text size="xs" c="dimmed">
              Modifier positions, rotations and scales are relative to this
              part. They follow the object when it moves. Drag the colored
              handles in the 3D view, or enter exact values below. Move uses
              world axes; rotate and scale use volume axes.
            </Text>
            <Group gap="xs">
              {["fit", "front", "top", "right"].map((view) => (
                <Button
                  key={view}
                  size="xs"
                  variant="subtle"
                  onClick={() => onView(view)}
                >
                  {view === "fit"
                    ? "Isometric"
                    : view[0].toUpperCase() + view.slice(1)}
                </Button>
              ))}
            </Group>
            {error && <Alert color="red">{error}</Alert>}
            <Group gap="xs">
              {["cube", "cylinder", "sphere"].map((shape) => (
                <Button
                  key={shape}
                  size="xs"
                  variant="light"
                  disabled={loading || value.length >= 32}
                  onClick={() => {
                    try {
                      add(primitive(shape, model.plate));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Add {shape}
                </Button>
              ))}
              <Button
                size="xs"
                variant="default"
                loading={loading}
                disabled={value.length >= 32}
                onClick={() => input.current?.click()}
              >
                Import volume
              </Button>
            </Group>
            <input
              ref={input}
              type="file"
              aria-label="Import modifier mesh"
              accept=".stl,.obj,.3mf"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (!file) return;
                setLoading(true);
                setError("");
                try {
                  const imported = await importModels(file, model.plate);
                  if (!alive.current) return;
                  if (!imported.length)
                    throw new Error("This file contains no modifier geometry.");
                  add({
                    ...imported[0],
                    name: file.name,
                    positions: mergedVertices(imported),
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                  });
                } catch (e) {
                  if (alive.current) setError((e as Error).message);
                } finally {
                  if (alive.current) setLoading(false);
                }
              }}
            />
            {item && (
              <>
                <TextInput
                  label="Modifier name"
                  value={item.name}
                  onChange={(e) => update({ name: e.currentTarget.value })}
                />
                <Switch
                  label="Enable modifier"
                  checked={item.enabled}
                  onChange={(e) => update({ enabled: e.currentTarget.checked })}
                />
                <Select
                  label="Modifier effect"
                  value={item.kind ?? "infill"}
                  data={[
                    { value: "infill", label: "Infill density and pattern" },
                    {
                      value: "support-enforcer",
                      label: "Enforce support contacts",
                    },
                    {
                      value: "support-blocker",
                      label: "Block support contacts",
                    },
                    { value: "process", label: "Print speed and flow" },
                    { value: "walls", label: "Wall count" },
                    { value: "skins", label: "Top and bottom skins" },
                  ]}
                  allowDeselect={false}
                  onChange={(v) =>
                    v &&
                    update({
                      kind: v as ModifierMesh["kind"],
                      ...(v === "skins" &&
                      item.topLayers === undefined &&
                      item.bottomLayers === undefined
                        ? { topLayers: 5 }
                        : {}),
                      ...(v === "walls" && item.walls === undefined
                        ? { walls: 4 }
                        : {}),
                      ...(v === "process" &&
                      item.speedPercent === undefined &&
                      item.flowPercent === undefined
                        ? { speedPercent: 50 }
                        : {}),
                    })
                  }
                />
                {item.kind?.startsWith("support-") ? (
                  <Text size="sm">
                    Cover the underside that needs support. Enforcers add
                    contacts regardless of the overhang angle; blockers remove
                    contacts. Supports from higher contacts can still pass
                    through a blocker. Enable Automatic or Enforced only
                    supports in print settings. Green volumes enforce; red
                    volumes block.
                  </Text>
                ) : item.kind === "skins" ? (
                  <>
                    <Text size="sm">
                      Cyan volumes change solid layers near exposed top and
                      bottom surfaces. Counts apply inside the volume at each
                      layer. Zero removes that skin; infill keeps its own
                      settings.
                    </Text>
                    {(["topLayers", "bottomLayers"] as const).map((key) => {
                      const label = key === "topLayers" ? "Top" : "Bottom";
                      return (
                        <Stack gap="xs" key={key}>
                          <Switch
                            label={`Override ${label.toLowerCase()} skin layers`}
                            checked={item[key] !== undefined}
                            onChange={(e) =>
                              update({
                                [key]: e.currentTarget.checked ? 5 : undefined,
                              })
                            }
                          />
                          <NumberInput
                            label={`Modifier ${label.toLowerCase()} skin layers`}
                            min={0}
                            max={30}
                            allowDecimal={false}
                            disabled={item[key] === undefined}
                            value={item[key] ?? 5}
                            onChange={(v) =>
                              typeof v === "number" &&
                              Number.isInteger(v) &&
                              v >= 0 &&
                              v <= 30 &&
                              update({ [key]: v })
                            }
                          />
                        </Stack>
                      );
                    })}
                    <Text size="xs" c="dimmed">
                      Later overrides win independently for top and bottom
                      skins.
                    </Text>
                  </>
                ) : item.kind === "walls" ? (
                  <>
                    <NumberInput
                      label="Modifier wall count"
                      min={0}
                      max={20}
                      allowDecimal={false}
                      value={item.walls ?? 4}
                      onChange={(v) =>
                        typeof v === "number" &&
                        Number.isInteger(v) &&
                        v >= 0 &&
                        v <= 20 &&
                        update({ walls: v })
                      }
                    />
                    <Text size="sm">
                      Blue volumes change the number of model walls. Infill and
                      surface skins meet the resulting wall thickness. Zero
                      removes walls within the volume. Later wall volumes take
                      priority.
                    </Text>
                  </>
                ) : item.kind === "process" ? (
                  <>
                    <Text size="sm">
                      Purple volumes change model walls, skins and infill.
                      Filament flow limits and cooling still apply. Travel,
                      supports and purge paths keep their own settings.
                    </Text>
                    {(["speedPercent", "flowPercent"] as const).map((key) => {
                      const label =
                        key === "speedPercent"
                          ? "Print speed"
                          : "Extrusion flow";
                      return (
                        <Stack gap="xs" key={key}>
                          <Switch
                            label={`Override ${label.toLowerCase()}`}
                            checked={item[key] !== undefined}
                            onChange={(e) =>
                              update({
                                [key]: e.currentTarget.checked
                                  ? 100
                                  : undefined,
                              })
                            }
                          />
                          <NumberInput
                            label={`${label} multiplier`}
                            suffix=" %"
                            min={10}
                            max={300}
                            disabled={item[key] === undefined}
                            value={item[key] ?? 100}
                            onChange={(v) =>
                              typeof v === "number" &&
                              v >= 10 &&
                              v <= 300 &&
                              update({ [key]: v })
                            }
                          />
                        </Stack>
                      );
                    })}
                    <Text size="xs" c="dimmed">
                      100% keeps the base value. Later enabled overrides win
                      independently for speed and flow.
                    </Text>
                  </>
                ) : (
                  <>
                    <NumberInput
                      label="Modifier infill density"
                      min={0}
                      max={100}
                      suffix=" %"
                      value={item.infill}
                      onChange={(v) =>
                        typeof v === "number" &&
                        update({ infill: Math.max(0, Math.min(100, v)) })
                      }
                    />
                    <Select
                      label="Modifier infill pattern"
                      value={item.infillPattern}
                      data={MODIFIER_PATTERNS.map((value) => ({
                        value,
                        label: (
                          {
                            gyroid: "Gyroid",
                            grid: "Grid",
                            hex: "Honeycomb",
                            triangle: "Triangles",
                            linear: "Lines",
                            cubic: "Cubic",
                          } as Record<string, string>
                        )[value],
                      }))}
                      allowDeselect={false}
                      onChange={(v) => v && update({ infillPattern: v })}
                    />
                  </>
                )}
                {(["position", "rotation", "scale"] as const).map((key) => (
                  <div key={key}>
                    <Text size="xs" fw={600}>
                      {key === "position"
                        ? "Position (mm)"
                        : key === "rotation"
                          ? "Rotation (degrees)"
                          : "Scale (%)"}
                    </Text>
                    <Group grow gap="xs">
                      {["X", "Y", "Z"].map((axis, i) => (
                        <NumberInput
                          key={axis}
                          label={axis}
                          aria-label={`Modifier ${key} ${axis}`}
                          value={Number(
                            (
                              item[key][i] * (key === "scale" ? 100 : 1)
                            ).toFixed(3),
                          )}
                          decimalScale={3}
                          min={key === "scale" ? 0.1 : undefined}
                          step={key === "rotation" ? 15 : 1}
                          onChange={(v) => {
                            if (
                              typeof v !== "number" ||
                              (key === "scale" && v <= 0)
                            )
                              return;
                            const vector = [...item[key]] as Vec3;
                            vector[i] = v / (key === "scale" ? 100 : 1);
                            update({ [key]: vector });
                          }}
                        />
                      ))}
                    </Group>
                  </div>
                ))}
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={value[0]?.id === selected}
                    onClick={() => reorder(-1)}
                  >
                    Earlier
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    disabled={value.at(-1)?.id === selected}
                    onClick={() => reorder(1)}
                  >
                    Later
                  </Button>
                  <Button
                    size="xs"
                    color="red"
                    variant="light"
                    onClick={() => {
                      const next = value.filter((m) => m.id !== selected);
                      onChange(next);
                      onSelect(next[0]?.id ?? "");
                    }}
                  >
                    Remove volume
                  </Button>
                </Group>
              </>
            )}
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={loading}
            onClick={() => {
              try {
                validateModifiers(value);
                onSave();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Apply modifiers
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
