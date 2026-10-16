import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  Badge,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { Settings } from "../types";
import {
  processImportPatch,
  type ProcessImportReport,
} from "../lib/import-process";
import { download } from "../lib/project";

export function ProcessImportDialog({
  name,
  report,
  warnings,
  onResolve,
}: {
  name: string;
  report: ProcessImportReport;
  warnings: string[];
  onResolve: (patch: Partial<Settings> | null) => void;
}) {
  const [selected, setSelected] = useState(report.entries.map((e) => e.id));
  const phone = useMediaQuery("(max-width: 600px)");
  return (
    <Modal
      opened
      onClose={() => onResolve(null)}
      title="Import 3MF settings"
      size="xl"
      fullScreen={phone}
      closeOnClickOutside={false}
    >
      <Stack
        gap="sm"
        style={{ height: phone ? "calc(100dvh - 96px)" : "min(75dvh, 720px)" }}
      >
        <ScrollArea
          style={{ flex: 1, minHeight: 0 }}
          type="auto"
          offsetScrollbars
        >
          <Stack gap="md">
            <Text size="sm" fw={600} style={{ overflowWrap: "anywhere" }}>
              {name}
            </Text>
            <Text size="sm">
              Choose process settings to use with the imported models. These
              settings apply to the whole project, including models already on
              other plates.
            </Text>
            <Alert color="blue" title="Review the transfer">
              {(report.skipped.length > 0 || warnings.length > 0) && (
                <Text size="xs" fw={600}>
                  {report.skipped.length + warnings.length} source settings or
                  annotations are not transferred. Review “Not transferred”
                  below.
                </Text>
              )}
              {report.notes.map((note, i) => (
                <Text size="xs" key={i}>
                  {note}
                </Text>
              ))}
            </Alert>
            <Group justify="space-between">
              <Badge>{report.entries.length} supported settings</Badge>
              <Button
                variant="subtle"
                size="xs"
                onClick={() =>
                  setSelected(
                    selected.length ? [] : report.entries.map((e) => e.id),
                  )
                }
              >
                {selected.length ? "Deselect all" : "Select all"}
              </Button>
            </Group>

            <Stack gap="sm">
              {!report.entries.length && (
                <Text size="sm">
                  No supported process settings were found. The geometry and
                  supported material colors can still be imported.
                </Text>
              )}
              {report.entries.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    borderBottom: "1px solid var(--mantine-color-gray-2)",
                    paddingBottom: 10,
                  }}
                >
                  <Checkbox
                    label={entry.label}
                    checked={selected.includes(entry.id)}
                    onChange={(e) =>
                      setSelected(
                        e.currentTarget.checked
                          ? [...selected, entry.id]
                          : selected.filter((k) => k !== entry.id),
                      )
                    }
                  />
                  <Text size="sm" ml={28}>
                    Current: {entry.current} → Import: {entry.value}
                  </Text>
                  {entry.note && (
                    <Text size="xs" c="dimmed" ml={28}>
                      {entry.note}
                    </Text>
                  )}
                </div>
              ))}
            </Stack>
            {(report.skipped.length > 0 || warnings.length > 0) && (
              <details>
                <summary style={{ cursor: "pointer" }}>
                  Not transferred ({report.skipped.length + warnings.length})
                </summary>
                <ScrollArea.Autosize mah={160} offsetScrollbars>
                  <Stack gap="xs" mt="xs">
                    {(warnings.length > 100 || report.skipped.length > 100) && (
                      <Text size="xs">
                        Showing the first 100 items in each group. Download the
                        transfer report for the complete list.
                      </Text>
                    )}
                    {warnings.slice(0, 100).map((w, i) => (
                      <Text size="xs" key={`w${i}`}>
                        {w}
                      </Text>
                    ))}
                    {report.skipped.slice(0, 100).map((item, i) => (
                      <Text
                        size="xs"
                        key={i}
                        style={{ overflowWrap: "anywhere" }}
                      >
                        <strong>{item.key}</strong>: {item.value} —{" "}
                        {item.reason}
                      </Text>
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              </details>
            )}
            <Button
              variant="subtle"
              size="xs"
              onClick={() =>
                download(
                  JSON.stringify(
                    { file: name, ...report, warnings, selected },
                    null,
                    2,
                  ),
                  "3mf-settings-report.json",
                  "application/json",
                )
              }
            >
              Download transfer report
            </Button>
          </Stack>
        </ScrollArea>
        <Group
          justify="end"
          gap="xs"
          style={{
            flexShrink: 0,
            ...(phone
              ? { display: "grid", gridTemplateColumns: "1fr 1fr" }
              : {}),
          }}
        >
          <Button variant="subtle" onClick={() => onResolve(null)}>
            Cancel import
          </Button>
          <Button variant="default" onClick={() => onResolve({})}>
            Models only
          </Button>
          <Button
            style={phone ? { gridColumn: "1 / -1" } : undefined}
            disabled={!selected.length}
            onClick={() => onResolve(processImportPatch(report, selected))}
          >
            Import selected settings
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
