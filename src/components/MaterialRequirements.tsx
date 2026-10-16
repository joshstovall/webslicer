import {
  Accordion,
  Button,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import type { Filament, Printer } from "../types";
import {
  filamentFeed,
  materialRequirements,
} from "../lib/material-compatibility";
export function MaterialRequirements({
  filament,
  index,
  printer,
  onChange,
}: {
  filament: Filament;
  index: number;
  printer: Printer;
  onChange: (patch: Partial<Filament>) => void;
}) {
  const feed = filamentFeed(printer),
    r = materialRequirements(filament, feed);
  const label = (s: string) => `Filament ${index + 1} ${s}`;
  const update = (patch: Partial<NonNullable<Filament["requirements"]>>) =>
    onChange({ requirements: { ...filament.requirements, ...patch } });
  return (
    <Accordion variant="contained">
      <Accordion.Item value="requirements">
        <Accordion.Control>{label("material requirements")}</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <Text size="xs" c="dimmed">
              Defaults are conservative assumptions from the material code. Set
              requirements for the exact spool using its manufacturer data.
              Printer configuration records the installed hardware.
            </Text>
            <TextInput
              label={label("material code")}
              description="For example: PA6-CF, PVA or TPU 95A. The display name does not determine compatibility."
              value={filament.material}
              maxLength={80}
              onChange={(e) => {
                const material = e.currentTarget.value.replace(
                  /[\x00-\x1f\x7f]/g,
                  "",
                );
                if (material.trim())
                  onChange({ material, requirements: undefined });
              }}
            />
            <Switch
              label={label("requires enclosure")}
              checked={r.enclosure}
              onChange={(e) => update({ enclosure: e.currentTarget.checked })}
            />
            <Switch
              label={label("is abrasive")}
              checked={r.abrasive}
              onChange={(e) => update({ abrasive: e.currentTarget.checked })}
            />
            <NumberInput
              label={label("minimum nozzle diameter")}
              value={r.minNozzle}
              min={0.1}
              max={2}
              step={0.1}
              suffix=" mm"
              onChange={(v) =>
                typeof v === "number" &&
                v >= 0.1 &&
                v <= 2 &&
                update({ minNozzle: v })
              }
            />
            {feed && (
              <Select
                label={label(`${feed} compatibility`)}
                value={r.feedCompatibility}
                allowDeselect={false}
                data={[
                  {
                    value: "unspecified",
                    label: "Unspecified — verify exact spool",
                  },
                  {
                    value: "compatible",
                    label: "Manufacturer-approved for this feed system",
                  },
                  { value: "incompatible", label: "Incompatible" },
                ]}
                onChange={(v) =>
                  v &&
                  update({
                    feedSystem: feed,
                    feedCompatibility: v as typeof r.feedCompatibility,
                  })
                }
              />
            )}
            <Switch
              label={label("restrict shared bed temperature")}
              checked={!!r.bedRange}
              onChange={(e) =>
                update({
                  bedRange: e.currentTarget.checked ? [50, 70] : undefined,
                })
              }
            />
            {r.bedRange && (
              <div className="field-pair">
                {[0, 1].map((i) => (
                  <NumberInput
                    key={i}
                    label={label(
                      i ? "maximum bed temperature" : "minimum bed temperature",
                    )}
                    value={r.bedRange![i]}
                    min={0}
                    max={130}
                    suffix=" °C"
                    error={
                      r.bedRange![0] > r.bedRange![1]
                        ? "Minimum must not exceed maximum"
                        : undefined
                    }
                    onChange={(v) => {
                      if (typeof v === "number" && v >= 0 && v <= 130) {
                        const range: [number, number] = [...r.bedRange!];
                        range[i] = v;
                        if (range[0] > range[1]) range[i === 0 ? 1 : 0] = v;
                        update({ bedRange: range });
                      }
                    }}
                  />
                ))}
              </div>
            )}
            <Button
              variant="subtle"
              size="xs"
              onClick={() => onChange({ requirements: undefined })}
            >
              Reset material requirements to defaults
            </Button>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
