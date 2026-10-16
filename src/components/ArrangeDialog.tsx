import {
  Button,
  Group,
  Modal,
  NumberInput,
  Progress,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import type { ArrangeOptions } from "../lib/placement";
export function ArrangeDialog({
  options,
  working,
  progress,
  stage,
  onChange,
  onStart,
  onClose,
}: {
  options: ArrangeOptions;
  working: boolean;
  progress: number;
  stage: string;
  onChange: (options: ArrangeOptions) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      opened
      onClose={onClose}
      title="Arrange plate"
      closeOnClickOutside={false}
      size="sm"
    >
      <Stack>
        {working ? (
          <>
            <Text size="sm" role="status">
              {stage}
            </Text>
            <Progress value={progress} animated />
            <Text size="xs" c="dimmed">
              The plate changes only when arrangement finishes.
            </Text>
          </>
        ) : (
          <>
            <Text size="sm">
              Fit projected outlines around other parts and reserved areas.
              Linked parts move together. Openings can hold smaller objects.
            </Text>
            <NumberInput
              label="Part spacing"
              suffix=" mm"
              min={0}
              max={100}
              step={1}
              value={options.gap}
              onChange={(v) => onChange({ ...options, gap: Number(v) })}
            />
            <NumberInput
              label="Bed edge clearance"
              suffix=" mm"
              min={0}
              max={100}
              step={1}
              value={options.edge}
              onChange={(v) => onChange({ ...options, edge: Number(v) })}
            />
            <Switch
              label="Allow 90° rotations"
              checked={options.rotate}
              onChange={(e) =>
                onChange({ ...options, rotate: e.currentTarget.checked })
              }
            />
            <Text size="xs" c="dimmed">
              Adhesion clearance is also reserved at bed edges. This is a
              packing search; a failed search does not prove the parts cannot
              fit.
            </Text>
          </>
        )}
        <Group justify="end">
          <Button variant="default" onClick={onClose}>
            {working ? "Cancel arrangement" : "Cancel"}
          </Button>
          {!working && <Button onClick={onStart}>Arrange objects</Button>}
        </Group>
      </Stack>
    </Modal>
  );
}
