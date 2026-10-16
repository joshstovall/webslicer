import { auxiliaryFanIndex } from "../lib/fan-control";
import {
  Accordion,
  Button,
  MultiSelect,
  NumberInput,
  Switch,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import type { Printer } from "../types";
import {
  physicalToolCount,
  printerHardware,
} from "../lib/material-compatibility";
export function PrinterHardware({
  printer,
  onChange,
}: {
  printer: Printer;
  onChange: (printer: Printer) => void;
}) {
  const h = printerHardware(printer);
  const update = (patch: NonNullable<Printer["hardware"]>) =>
    onChange({ ...printer, hardware: { ...printer.hardware, ...patch } });
  return (
    <Accordion variant="contained">
      <Accordion.Item value="hardware">
        <Accordion.Control>Installed material hardware</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <Text size="xs" c="dimmed">
              Record your installed hardware. Independent heads are configured
              separately; all AMS slots use one physical head. Nozzle diameter
              remains part of the machine profile.
            </Text>
            <Select
              label="Installed enclosure or top cover"
              allowDeselect={false}
              value={
                h.enclosed === undefined
                  ? "unknown"
                  : h.enclosed
                    ? "enclosed"
                    : "open"
              }
              data={[
                {
                  value: "unknown",
                  label: "Use profile default / unspecified",
                },
                {
                  value: "enclosed",
                  label: "Enclosure or top cover installed",
                },
                { value: "open", label: "Open printer" },
              ]}
              onChange={(v) =>
                update({
                  enclosed: v === "unknown" ? undefined : v === "enclosed",
                })
              }
            />
            <MultiSelect
              searchable
              label="Heads equipped for abrasive filament"
              description="Select only heads with an abrasion-resistant nozzle and compatible feed gears."
              value={h.abrasiveTools.map(String)}
              data={Array.from(
                { length: physicalToolCount(printer) },
                (_, i) => ({
                  value: String(i),
                  label: `Physical head ${i + 1}`,
                }),
              )}
              onChange={(values) =>
                update({ abrasiveTools: values.map(Number) })
              }
            />
            {(!printer.firmware ||
              ["bambu-x1c", "bambu-p1s", "bambu-p1p", "snapmaker-u1"].includes(
                printer.id,
              )) && (
              <>
                <Switch
                  label="Auxiliary part-cooling fan installed"
                  checked={auxiliaryFanIndex(printer) !== undefined}
                  onChange={(e) =>
                    update({
                      auxiliaryFan: e.currentTarget.checked,
                      ...(!printer.firmware
                        ? {
                            auxiliaryFanIndex:
                              printer.hardware?.auxiliaryFanIndex ?? 2,
                          }
                        : {}),
                    })
                  }
                />
                {!printer.firmware && printer.hardware?.auxiliaryFan && (
                  <NumberInput
                    label="Auxiliary fan P index"
                    description="Use the fan identifier configured in your firmware; this is not a tool number."
                    value={printer.hardware.auxiliaryFanIndex ?? 2}
                    min={1}
                    max={255}
                    allowDecimal={false}
                    onChange={(v) =>
                      typeof v === "number" &&
                      Number.isInteger(v) &&
                      v >= 1 &&
                      v <= 255 &&
                      update({ auxiliaryFanIndex: v })
                    }
                  />
                )}
              </>
            )}
            <Button
              variant="subtle"
              size="xs"
              onClick={() => onChange({ ...printer, hardware: undefined })}
            >
              Reset to stock hardware
            </Button>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
