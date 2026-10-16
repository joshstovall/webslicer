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
import type {
  Filament,
  MultiMaterialSettings,
  Printer,
  Settings,
} from "../types";
import { defaultFilament } from "../lib/multimaterial";
import { MATERIALS } from "../lib/profiles";
interface Props {
  filaments: Filament[];
  multi: MultiMaterialSettings;
  printer: Printer;
  settings: Settings;
  usedTools: number[];
  onChange: (filaments: Filament[], multi: MultiMaterialSettings) => void;
}
export function FilamentPanel({
  filaments,
  multi,
  printer,
  settings,
  usedTools,
  onChange,
}: Props) {
  const update = (index: number, patch: Partial<Filament>) =>
    onChange(
      filaments.map((f, i) => (i === index ? { ...f, ...patch } : f)),
      multi,
    );
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
                    max={350}
                    suffix=" °C"
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 150 &&
                      v <= 350 &&
                      update(i, { nozzleTemp: v })
                    }
                  />
                  <NumberInput
                    label={`Filament ${i + 1} first layer temperature`}
                    value={f.firstNozzleTemp}
                    min={150}
                    max={350}
                    suffix=" °C"
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 150 &&
                      v <= 350 &&
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
                    max={50}
                    suffix=" mm³/s"
                    onChange={(v) =>
                      typeof v === "number" &&
                      v >= 1 &&
                      v <= 50 &&
                      update(i, { maxFlow: v })
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
                    onClick={() => onChange(filaments.slice(0, -1), multi)}
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
          {multi.purgeTower && (
            <NumberInput
              label="Purge volume per change"
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
          )}
        </>
      )}
    </Stack>
  );
}
