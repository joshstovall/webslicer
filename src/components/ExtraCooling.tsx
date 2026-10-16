import { Alert, NumberInput, Stack, Switch, Text } from "@mantine/core";
import type { Filament, Printer, Settings } from "../types";
import { auxiliaryFanIndex } from "../lib/fan-control";
export function ExtraCooling({
  filament: f,
  index,
  printer,
  settings,
  onChange,
}: {
  filament: Filament;
  index: number;
  printer: Printer;
  settings: Settings;
  onChange: (patch: Partial<Filament>) => void;
}) {
  const label = (name: string) => `Filament ${index + 1} ${name}`;
  return (
    <Stack gap="sm">
      <Switch
        label={label("bridge fan override")}
        aria-label={label("bridge fan override")}
        description="Use a separate part-fan speed on unsupported solid-fill paths. The configured fan start layer still applies."
        checked={f.bridgeFan !== undefined}
        onChange={(e) =>
          onChange({ bridgeFan: e.currentTarget.checked ? 100 : undefined })
        }
      />
      {f.bridgeFan !== undefined && (
        <NumberInput
          label={label("bridge fan")}
          value={f.bridgeFan}
          min={0}
          max={100}
          suffix=" %"
          onChange={(v) =>
            typeof v === "number" &&
            v >= 0 &&
            v <= 100 &&
            onChange({ bridgeFan: v })
          }
        />
      )}
      <Switch
        label={label("auxiliary fan override")}
        aria-label={label("auxiliary fan override")}
        description="Control the printer's auxiliary part-cooling fan while this filament is active."
        checked={f.auxiliaryFan !== undefined}
        onChange={(e) =>
          onChange({ auxiliaryFan: e.currentTarget.checked ? 0 : undefined })
        }
      />
      {f.auxiliaryFan !== undefined && (
        <>
          {auxiliaryFanIndex(printer) === undefined && (
            <Alert color="orange">
              This profile has no configured auxiliary fan. A nonzero override
              blocks slicing; configure installed hardware or disable the
              override.
            </Alert>
          )}
          <NumberInput
            label={label("auxiliary fan")}
            value={f.auxiliaryFan}
            min={0}
            max={100}
            suffix=" %"
            onChange={(v) =>
              typeof v === "number" &&
              v >= 0 &&
              v <= 100 &&
              onChange({ auxiliaryFan: v })
            }
          />
          <div className="field-pair">
            <NumberInput
              label={label("auxiliary fan starts at layer")}
              value={f.auxiliaryFanLayer ?? f.fanLayer ?? settings.fanLayer}
              min={1}
              max={20}
              allowDecimal={false}
              onChange={(v) =>
                typeof v === "number" &&
                Number.isInteger(v) &&
                v >= 1 &&
                v <= 20 &&
                onChange({ auxiliaryFanLayer: v })
              }
            />
            <NumberInput
              label={label("auxiliary fan ramp length")}
              value={
                f.auxiliaryFanRampLayers ??
                f.fanRampLayers ??
                settings.fanRampLayers ??
                1
              }
              min={1}
              max={20}
              allowDecimal={false}
              suffix=" layers"
              onChange={(v) =>
                typeof v === "number" &&
                Number.isInteger(v) &&
                v >= 1 &&
                v <= 20 &&
                onChange({ auxiliaryFanRampLayers: v })
              }
            />
          </div>
          <Text size="xs" c="dimmed">
            Once any active spool controls the auxiliary fan, spools without an
            override use 0%. The fan switches off before the end sequence.
            Chamber and hotend fans retain their machine controls.
          </Text>
        </>
      )}
    </Stack>
  );
}
