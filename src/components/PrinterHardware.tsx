import {
  Accordion,
  Button,
  MultiSelect,
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
