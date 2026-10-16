import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Filament, Model } from "../types";
import {
  assemblyParts,
  changeAssemblyPriority,
  linkAssembly,
  unlinkAssembly,
} from "../lib/assemblies";

export function AssemblyPanel({
  models,
  selected,
  filaments,
  onChange,
  onDone,
}: {
  models: Model[];
  selected: Model;
  filaments: Filament[];
  onChange: (models: Model[]) => void;
  onDone: () => void;
}) {
  const parts = assemblyParts(models, selected);
  const candidates = models.filter((m) => m.plate === selected.plate);
  const [checked, setChecked] = useState(() => parts.map((m) => m.id));
  const unchanged =
    checked.length === parts.length &&
    parts.every((m) => checked.includes(m.id));
  const finish = (next: Model[]) => {
    onChange(next);
    onDone();
  };
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Link parts to move and arrange them as one multi-color object. Their
        positions and filament assignments stay intact.
      </Text>
      <Text size="sm" fw={600}>
        Parts on this plate
      </Text>
      <ScrollArea.Autosize mah={240} offsetScrollbars>
        <Stack gap="sm">
          {candidates.map((m) => (
            <Checkbox
              styles={{ root: { minHeight: 44 } }}
              key={m.id}
              label={`${m.name}${m.visible ? "" : " (hidden)"}`}
              aria-label={`Include ${m.name} in assembly`}
              description={
                m.id === selected.id
                  ? "Selected part"
                  : m.assemblyId
                    ? "Linked part"
                    : undefined
              }
              checked={checked.includes(m.id)}
              disabled={m.id === selected.id}
              onChange={(e) => {
                const include = e.currentTarget.checked;
                setChecked((ids) =>
                  include ? [...ids, m.id] : ids.filter((id) => id !== m.id),
                );
              }}
            />
          ))}
        </Stack>
      </ScrollArea.Autosize>
      <Button
        disabled={checked.length < 2 || unchanged}
        onClick={() => finish(linkAssembly(models, checked))}
      >
        Link selected parts
      </Button>
      {parts.length > 1 && (
        <>
          <Divider />
          <div>
            <Text size="sm" fw={600}>
              Material overlap priority
            </Text>
            <Text size="xs" c="dimmed">
              Higher parts in this list keep their material where linked parts
              overlap. Hidden parts do not affect slicing.
            </Text>
          </div>
          <ScrollArea.Autosize mah={260} offsetScrollbars>
            <Stack gap="xs">
              {[...parts].reverse().map((m, i) => (
                <Group
                  key={m.id}
                  wrap="nowrap"
                  gap="xs"
                  data-testid={`priority-${m.id}`}
                >
                  <Badge
                    circle
                    color={filaments[m.tool ?? 0]?.color ?? m.color}
                    variant="filled"
                    size="sm"
                    aria-label={`Filament ${(m.tool ?? 0) + 1}`}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                      {m.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {i === 0 ? "Highest priority · " : ""}
                      {filaments[m.tool ?? 0]?.name ??
                        `Filament ${(m.tool ?? 0) + 1}`}
                      {m.visible ? "" : " · hidden"}
                    </Text>
                  </div>
                  <ActionIcon
                    size={44}
                    variant="light"
                    aria-label={`Increase priority of ${m.name}`}
                    disabled={i === 0}
                    onClick={() =>
                      onChange(changeAssemblyPriority(models, m.id, 1))
                    }
                  >
                    <ArrowUp size={16} />
                  </ActionIcon>
                  <ActionIcon
                    size={44}
                    variant="light"
                    aria-label={`Decrease priority of ${m.name}`}
                    disabled={i === parts.length - 1}
                    onClick={() =>
                      onChange(changeAssemblyPriority(models, m.id, -1))
                    }
                  >
                    <ArrowDown size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          </ScrollArea.Autosize>
          <Group grow>
            <Button
              variant="default"
              onClick={() => finish(unlinkAssembly(models, selected.id))}
            >
              Detach this part
            </Button>
            <Button
              variant="default"
              onClick={() => finish(unlinkAssembly(models, selected.id, true))}
            >
              Separate all parts
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Separating keeps each part in place. Arrange them afterward if you
            want to print them as separate objects.
          </Text>
        </>
      )}
      <Button variant="subtle" onClick={onDone}>
        Done
      </Button>
    </Stack>
  );
}
