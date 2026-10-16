import { useState } from "react";
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  Loader,
  Anchor,
} from "@mantine/core";
import {
  STEP_QUALITY,
  type StepOptions,
  type StepQuality,
} from "../lib/step-mesh";
export function StepImportDialog({
  name,
  stage,
  onStart,
  onCancel,
}: {
  name: string;
  stage?: string;
  onStart: (options: StepOptions) => void;
  onCancel: () => void;
}) {
  const [quality, setQuality] = useState<StepQuality>("balanced");
  const [colors, setColors] = useState(true);
  return (
    <Modal
      opened
      onClose={onCancel}
      title="Import STEP model"
      closeOnClickOutside={false}
      size="md"
    >
      <Stack>
        <Text size="sm" style={{ overflowWrap: "anywhere" }}>
          {name}
        </Text>
        {stage ? (
          <Group wrap="nowrap" role="status">
            <Loader size="sm" />
            <Text size="sm">{stage}</Text>
          </Group>
        ) : (
          <>
            <Text size="sm">
              Convert CAD surfaces to printable triangles. File units and
              relative part placement are preserved. Fine quality uses more
              memory.
            </Text>
            <Select
              label="Surface quality"
              value={quality}
              allowDeselect={false}
              onChange={(v) => v && setQuality(v as StepQuality)}
              data={Object.entries(STEP_QUALITY).map(([value, preset]) => ({
                value,
                label: preset.label,
              }))}
            />
            <Switch
              label="Import CAD colors"
              checked={colors}
              onChange={(e) => setColors(e.currentTarget.checked)}
              description="Part and face colors become filament assignments."
            />
            <Text size="xs" c="dimmed">
              Use a self-contained STEP export. Open surfaces may need repair.
              Limits: 100 MB, 200 parts and 2 million triangles.
            </Text>
            <Anchor
              size="xs"
              href={`${import.meta.env.BASE_URL}cad/NOTICE.html`}
              target="_blank"
              rel="noreferrer"
            >
              CAD converter licenses and source
            </Anchor>
          </>
        )}
        <Group justify="end">
          <Button variant="default" onClick={onCancel}>
            Cancel import
          </Button>
          {!stage && (
            <Button onClick={() => onStart({ quality, colors })}>
              Import STEP
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
