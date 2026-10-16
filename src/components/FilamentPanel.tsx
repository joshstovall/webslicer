import {
  Accordion,
  Alert,
  Button,
  ColorInput,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import type {
  Filament,
  MultiMaterialSettings,
  Printer,
  Settings,
} from "../types";
import {
  defaultFilament,
  purgeVolumeFor,
  flushVolumeFor,
  independentPurgeBudgets,
} from "../lib/multimaterial";
import { thermalLimits } from "../lib/thermal-limits";
import { MATERIALS } from "../lib/profiles";
interface Props {
  filaments: Filament[];
  multi: MultiMaterialSettings;
  printer: Printer;
  settings: Settings;
  usedTools: number[];
  plate: number;
  onChange: (filaments: Filament[], multi: MultiMaterialSettings) => void;
}
export function FilamentPanel({
  filaments,
  multi: storedMulti,
  printer,
  settings,
  usedTools,
  plate,
  onChange,
}: Props) {
  const multi = independentPurgeBudgets(storedMulti);
  const position = multi.towerPositions?.[String(plate)];
  const setPosition = (
    next?: NonNullable<MultiMaterialSettings["towerPositions"]>[string],
  ) => {
    const positions = { ...multi.towerPositions };
    if (next) positions[String(plate)] = next;
    else delete positions[String(plate)];
    onChange(filaments, { ...multi, towerPositions: positions });
  };
  const [purgeFrom, setPurgeFrom] = useState("0"),
    [purgeTo, setPurgeTo] = useState("1");
  const from = Math.min(Number(purgeFrom), filaments.length - 1);
  const to = Math.min(Number(purgeTo), filaments.length - 1);
  const pair = `${from}:${to}`;
  const update = (index: number, patch: Partial<Filament>) =>
    onChange(
      filaments.map((f, i) => (i === index ? { ...f, ...patch } : f)),
      multi,
    );
  const maxTemperature = thermalLimits(printer)?.nozzle ?? 350;
  const capacity = printer.toolCount ?? 1;
  return (
    <Stack gap="md">
      <Text size="sm">
        {printer.name} · {capacity} slots ·{" "}
        {printer.multiMaterialMode === "toolchanger"
          ? "Independent toolheads"
          : printer.multiMaterialMode === "shared-nozzle"
            ? "Shared nozzle"
            : "Single filament"}
      </Text>
      {filaments.length > capacity && (
        <Alert color="orange">
          This project has more filaments than the selected printer supports.
          Select a compatible printer or reassign parts and remove the extra
          slots.
        </Alert>
      )}
      <Text size="xs" c="dimmed">
        Each filament has its own nozzle temperature, flow and part-cooling fan.
        The bed temperature is shared; set it in Temperature &amp; cooling.
      </Text>
      <Accordion multiple defaultValue={["0"]}>
        {filaments.map((f, i) => (
          <Accordion.Item value={String(i)} key={i}>
            <Accordion.Control>
              <Group gap="xs">
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    background: f.color,
                    border: "1px solid #8885",
                  }}
                />
                <Text size="sm">
                  {i + 1}. {f.name}
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <TextInput
                  label={`Filament ${i + 1} name`}
                  value={f.name}
                  onChange={(e) => update(i, { name: e.currentTarget.value })}
                />
                <ColorInput
                  label={`Filament ${i + 1} color`}
                  format="hex"
                  value={f.color}
                  onChange={(color) => {
                    if (/^#[0-9a-f]{6}$/i.test(color)) update(i, { color });
                  }}
                />
                <Select
                  label={`Filament ${i + 1} material`}
                  value={f.material}
                  data={MATERIALS.map((m) => m.name)}
                  allowDeselect={false}
                  onChange={(name) => {
                    const m = MATERIALS.find((m) => m.name === name);
                    if (m)
                      update(i, {
                        material: m.name,
                        nozzleTemp: m.nozzle,
                        firstNozzleTemp: m.nozzle + 5,
                        density: m.density,
                        maxFlow: m.flow,
                        fan: m.fan,
                      });
                  }}
                />
                <div className="field-pair">
                  <NumberInput
                    label={`Filament ${i + 1} temperature`}
                    value={f.nozzleTemp}
                    min={150}
                    max={maxTemperature}
                    error={
                      f.nozzleTemp > maxTemperature
                        ? `Printer limit: ${maxTemperature}°C`
                        : undefined
                    }
                    suffix=" °C"
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 150 &&
                      v <= maxTemperature &&
                      update(i, { nozzleTemp: v })
                    }
                  />
                  <NumberInput
                    label={`Filament ${i + 1} first layer temperature`}
                    value={f.firstNozzleTemp}
                    min={150}
                    max={maxTemperature}
                    error={
                      f.firstNozzleTemp > maxTemperature
                        ? `Printer limit: ${maxTemperature}°C`
                        : undefined
                    }
                    suffix=" °C"
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 150 &&
                      v <= maxTemperature &&
                      update(i, { firstNozzleTemp: v })
                    }
                  />
                </div>
                <div className="field-pair">
                  <NumberInput
                    label={`Filament ${i + 1} flow ratio`}
                    value={f.flow}
                    min={0.5}
                    max={1.5}
                    step={0.01}
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 0.5 &&
                      v <= 1.5 &&
                      update(i, { flow: v })
                    }
                  />
                  <NumberInput
                    label={`Filament ${i + 1} max flow`}
                    value={f.maxFlow}
                    min={1}
                    max={100}
                    suffix=" mm³/s"
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 1 &&
                      v <= 100 &&
                      update(i, { maxFlow: v })
                    }
                  />
                </div>
                <div className="field-pair">
                  <NumberInput
                    label={`Filament ${i + 1} cooling fan`}
                    value={f.fan}
                    min={0}
                    max={100}
                    suffix=" %"
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 0 &&
                      v <= 100 &&
                      update(i, { fan: v })
                    }
                  />
                  <NumberInput
                    label={`Filament ${i + 1} fan starts at layer`}
                    value={f.fanLayer ?? settings.fanLayer}
                    min={1}
                    max={20}
                    allowDecimal={false}
                    onChange={(v) =>
                      typeof v === "number" &&
                      Number.isInteger(v) &&
                      v >= 1 &&
                      v <= 20 &&
                      update(i, { fanLayer: v })
                    }
                  />
                </div>
                <div className="field-pair">
                  <NumberInput
                    label={`Filament ${i + 1} density`}
                    value={f.density}
                    min={0.5}
                    max={3}
                    step={0.01}
                    suffix=" g/cm³"
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 0.5 &&
                      v <= 3 &&
                      update(i, { density: v })
                    }
                  />
                  <NumberInput
                    label={`Filament ${i + 1} cost`}
                    value={f.cost}
                    min={0}
                    max={1000}
                    prefix="$"
                    suffix=" /kg"
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 0 &&
                      v <= 1000 &&
                      update(i, { cost: v })
                    }
                  />
                </div>
                {i === filaments.length - 1 && i > 0 && (
                  <Button
                    variant="subtle"
                    color="red"
                    disabled={usedTools.includes(i) || multi.supportTool === i}
                    onClick={() =>
                      onChange(filaments.slice(0, -1), {
                        ...multi,
                        purgeVolumes: Object.fromEntries(
                          Object.entries(multi.purgeVolumes ?? {}).filter(
                            ([key]) => !key.split(":").includes(String(i)),
                          ),
                        ),
                        flushVolumes: Object.fromEntries(
                          Object.entries(multi.flushVolumes ?? {}).filter(
                            ([key]) => !key.split(":").includes(String(i)),
                          ),
                        ),
                      })
                    }
                  >
                    Remove last filament
                  </Button>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <Button
        variant="light"
        disabled={filaments.length >= capacity}
        onClick={() =>
          onChange(
            [...filaments, defaultFilament(settings, filaments.length)],
            multi,
          )
        }
      >
        Add filament
      </Button>
      {capacity > 1 && (
        <>
          <Select
            label="Support filament"
            data={filaments.map((f, i) => ({
              value: String(i),
              label: `${i + 1}. ${f.name}`,
            }))}
            value={String(multi.supportTool)}
            allowDeselect={false}
            onChange={(v) =>
              v !== null &&
              onChange(filaments, { ...multi, supportTool: Number(v) })
            }
          />
          <Switch
            label="Purge tower"
            description="Prime the new filament before printing the part."
            checked={multi.purgeTower}
            onChange={(e) =>
              onChange(filaments, {
                ...multi,
                purgeTower: e.currentTarget.checked,
              })
            }
          />
          {printer.firmware === "bambu" && (
            <NumberInput
              label="Station flushing volume per change"
              description="Flush at the Bambu purge station, separately from tower priming. Machine loading routines may extrude additional material."
              value={multi.flushVolume}
              min={0}
              max={2000}
              suffix=" mm³"
              onChange={(v) =>
                typeof v === "number" &&
                v >= 0 &&
                v <= 2000 &&
                onChange(filaments, { ...multi, flushVolume: v })
              }
            />
          )}
          {multi.purgeTower && (
            <Stack gap="sm">
              <Text size="xs" c="dimmed">
                Tower placement for plate {plate}. Clearance includes models,
                supports, adhesion and reserved bed areas. The tower ends at the
                final color change.
              </Text>
              <Select
                label="Tower placement"
                value={position ? "manual" : "automatic"}
                allowDeselect={false}
                data={[
                  { value: "automatic", label: "Automatic" },
                  { value: "manual", label: "Manual" },
                ]}
                onChange={(mode) =>
                  setPosition(
                    mode === "manual"
                      ? {
                          x: (printer.bedOrigin?.[0] ?? 0) + printer.bed[0] / 2,
                          y:
                            (printer.bedOrigin?.[1] ?? 0) +
                            printer.bed[1] * 0.15,
                          axis: "x",
                        }
                      : undefined,
                  )
                }
              />
              {position && (
                <>
                  <Text size="xs" c="dimmed">
                    Set the first block’s center in machine X/Y millimeters,
                    measured from the front-left origin. Additional blocks
                    extend along the selected positive axis. Slicing checks the
                    complete footprint and reports collisions without moving
                    your tower.
                  </Text>
                  <Group grow wrap="nowrap" align="start">
                    <NumberInput
                      label="Tower center X"
                      value={position.x}
                      suffix=" mm"
                      decimalScale={2}
                      onChange={(x) =>
                        typeof x === "number" &&
                        Number.isFinite(x) &&
                        setPosition({ ...position, x })
                      }
                    />
                    <NumberInput
                      label="Tower center Y"
                      value={position.y}
                      suffix=" mm"
                      decimalScale={2}
                      onChange={(y) =>
                        typeof y === "number" &&
                        Number.isFinite(y) &&
                        setPosition({ ...position, y })
                      }
                    />
                  </Group>
                  <Select
                    label="Tower row direction"
                    value={position.axis}
                    allowDeselect={false}
                    data={[
                      { value: "x", label: "+X · left to right" },
                      { value: "y", label: "+Y · front to back" },
                    ]}
                    onChange={(axis) =>
                      (axis === "x" || axis === "y") &&
                      setPosition({ ...position, axis })
                    }
                  />
                </>
              )}
              <NumberInput
                label="Tower priming volume per change"
                description="Each transition deposits this amount plus the material needed to support the tower."
                value={multi.purgeVolume}
                min={1}
                max={2000}
                suffix=" mm³"
                onChange={(v) =>
                  typeof v === "number" &&
                  v >= 1 &&
                  v <= 2000 &&
                  onChange(filaments, { ...multi, purgeVolume: v })
                }
              />
              {filaments.length > 1 && (
                <Accordion variant="contained">
                  <Accordion.Item value="directional-purge">
                    <Accordion.Control>
                      Directional purge volumes
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="sm">
                        <Text size="xs" c="dimmed">
                          Set tower priming for each change in mm³. The
                          footprint reserves the largest active budget; each
                          change uses its own amount. Foundation and support
                          paths are additional.
                        </Text>
                        <Select
                          label="Purge from filament"
                          data={filaments.map((f, i) => ({
                            value: String(i),
                            label: `${i + 1}. ${f.name}`,
                          }))}
                          value={String(from)}
                          onChange={(v) => v !== null && setPurgeFrom(v)}
                          allowDeselect={false}
                        />
                        <Select
                          label="Purge to filament"
                          data={filaments.map((f, i) => ({
                            value: String(i),
                            label: `${i + 1}. ${f.name}`,
                          }))}
                          value={String(to)}
                          onChange={(v) => v !== null && setPurgeTo(v)}
                          allowDeselect={false}
                        />
                        <NumberInput
                          label="Purge for this change"
                          suffix=" mm³"
                          disabled={from === to}
                          value={purgeVolumeFor(multi, from, to)}
                          min={1}
                          max={2000}
                          onChange={(v) =>
                            typeof v === "number" &&
                            v >= 1 &&
                            v <= 2000 &&
                            onChange(filaments, {
                              ...multi,
                              purgeVolumes: {
                                ...multi.purgeVolumes,
                                [pair]: v,
                              },
                            })
                          }
                        />
                        <Button
                          size="xs"
                          variant="subtle"
                          disabled={multi.purgeVolumes?.[pair] === undefined}
                          onClick={() => {
                            const purgeVolumes = { ...multi.purgeVolumes };
                            delete purgeVolumes[pair];
                            onChange(filaments, { ...multi, purgeVolumes });
                          }}
                        >
                          Use default for this change
                        </Button>
                        {printer.firmware === "bambu" && (
                          <>
                            <NumberInput
                              label="Station flushing for this change"
                              value={flushVolumeFor(multi, from, to)}
                              disabled={from === to}
                              min={0}
                              max={2000}
                              suffix=" mm³"
                              onChange={(v) =>
                                typeof v === "number" &&
                                v >= 0 &&
                                v <= 2000 &&
                                onChange(filaments, {
                                  ...multi,
                                  flushVolumes: {
                                    ...multi.flushVolumes,
                                    [pair]: v,
                                  },
                                })
                              }
                            />
                            <Button
                              size="xs"
                              variant="subtle"
                              disabled={
                                multi.flushVolumes?.[pair] === undefined
                              }
                              onClick={() => {
                                const flushVolumes = { ...multi.flushVolumes };
                                delete flushVolumes[pair];
                                onChange(filaments, { ...multi, flushVolumes });
                              }}
                            >
                              Use station default for this change
                            </Button>
                          </>
                        )}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
