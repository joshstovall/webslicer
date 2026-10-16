import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { Model, Printer } from "../types";
import { applyOrientation, findOrientations } from "../lib/orientation";
import type {
  OrientationCandidate,
  OrientationPriority,
  OrientationResult,
} from "../lib/orientation-core";
import { Viewport } from "./Viewport";
export function OrientationDialog({
  models,
  printer,
  filamentColors,
  edge,
  angle,
  signal,
  onCancel,
  onApply,
}: {
  models: Model[];
  printer: Printer;
  filamentColors: string[];
  edge: number;
  angle: number;
  signal: AbortSignal;
  onCancel: () => void;
  onApply: (candidate: OrientationCandidate) => void;
}) {
  const phone = useMediaQuery("(max-width: 600px)");
  const [priority, setPriority] = useState<OrientationPriority>("balanced");
  const [searchedPriority, setSearchedPriority] = useState(priority);
  const [result, setResult] = useState<OrientationResult | null>(null);
  const [selected, setSelected] = useState("0");
  const [working, setWorking] = useState(false),
    [applying, setApplying] = useState(false),
    [error, setError] = useState("");
  const [progress, setProgress] = useState(0),
    [stage, setStage] = useState("");
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => job.current?.abort(), []);
  const candidate = result?.candidates[Number(selected)];
  const preview = useMemo(
    () => (candidate ? applyOrientation(models, candidate) : models),
    [models, candidate],
  );
  const view = useMemo(
    () => ({ view: "fit", tick: Number(selected) }),
    [candidate, selected],
  );
  async function search() {
    if (job.current || signal.aborted) return;
    const controller = new AbortController();
    job.current = controller;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    setWorking(true);
    setResult(null);
    setError("");
    setProgress(0);
    setSearchedPriority(priority);
    try {
      const r = await findOrientations(
        models,
        printer,
        { edge, angle, priority },
        controller.signal,
        (value, label) => {
          setProgress(value * 100);
          setStage(label);
        },
      );
      if (!controller.signal.aborted) {
        setResult(r);
        setSelected("0");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      signal.removeEventListener("abort", abort);
      job.current = null;
      setWorking(false);
    }
  }
  const n = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <Modal
      opened
      onClose={onCancel}
      title="Find printing orientation"
      size="lg"
      fullScreen={phone}
      closeOnClickOutside={false}
    >
      <Stack
        gap="sm"
        style={{ height: phone ? "calc(100dvh - 96px)" : "min(78dvh, 760px)" }}
      >
        <ScrollArea
          style={{ flex: 1, minHeight: 0 }}
          offsetScrollbars
          type="auto"
        >
          <Stack gap="sm">
            <Text size="sm">
              Compare printing angles for{" "}
              {models.length === 1
                ? models[0].name
                : `${models.length} linked parts`}
              . Applying also arranges the active plate.
            </Text>
            <Select
              label="Orientation priority"
              value={priority}
              onChange={(v) => v && setPriority(v as OrientationPriority)}
              allowDeselect={false}
              disabled={working || applying}
              data={[
                {
                  value: "balanced",
                  label: "Balance support, base and height",
                },
                { value: "support", label: "Less support" },
                { value: "base", label: "Larger bed contact" },
                { value: "height", label: "Lower printing height" },
              ]}
            />
            {error && (
              <Alert color="orange" title="Orientation needs attention">
                {error}
              </Alert>
            )}
            {working ? (
              <>
                <Text role="status" size="sm">
                  {stage}
                </Text>
                <Progress value={progress} animated />
              </>
            ) : (
              <>
                {result && (
                  <Select
                    label="Suggested printing angle"
                    value={selected}
                    onChange={(v) => v && setSelected(v)}
                    allowDeselect={false}
                    disabled={applying}
                    data={result.candidates.map((c, i) => ({
                      value: String(i),
                      label: `${i === 0 ? "Recommended" : `Alternative ${i}`} · ${c.current ? "current angle · " : ""}${n(c.size[2])} mm high`,
                    }))}
                  />
                )}
                <div
                  style={{
                    height: phone ? 220 : 260,
                    position: "relative",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "#eff0eb",
                  }}
                  aria-label="Orientation preview"
                >
                  <Viewport
                    models={preview}
                    printer={printer}
                    filamentColors={filamentColors}
                    selected={null}
                    onSelect={() => {}}
                    tool="select"
                    onTransform={() => {}}
                    viewCommand={view}
                    result={null}
                    preview={false}
                    layer={0}
                    singleLayer={false}
                    showTravel={false}
                    hiddenFeatures={[]}
                    colorMode="feature"
                    wireframe={false}
                  />
                </div>
                {candidate && result && (
                  <Stack gap={4} aria-label="Orientation estimates">
                    <Text size="sm">
                      Support space:{" "}
                      <strong>{n(candidate.supportVolume / 1000)} cm³</strong>{" "}
                      (current {n(result.baseline.supportVolume / 1000)} cm³)
                    </Text>
                    <Text size="sm">
                      Bed contact:{" "}
                      <strong>{n(candidate.contactArea)} mm²</strong> · Height:{" "}
                      <strong>{n(candidate.size[2])} mm</strong>
                    </Text>
                    <Text size="xs" c="dimmed">
                      {result.examined} angles compared. Support space is a
                      solid-column estimate, not filament usage.
                    </Text>
                  </Stack>
                )}
              </>
            )}
            <Text size="xs" c="dimmed">
              Uses the {angle}° overhang threshold and {n(edge)} mm bed
              clearance. Estimates use visible geometry; support paint,
              modifiers, tree routing and bridges are resolved when slicing.
              Review the angle for surface finish and strength.
            </Text>
            {models.some((m) => !m.visible) && (
              <Text size="xs" c="dimmed">
                Hidden linked parts follow the rotation but do not affect the
                estimates.
              </Text>
            )}
            {result && priority !== searchedPriority && (
              <Text size="sm">
                Search again to compare angles with this priority.
              </Text>
            )}
          </Stack>
        </ScrollArea>
        <Group justify="end" gap="xs">
          <Button variant="default" onClick={onCancel}>
            Cancel orientation
          </Button>
          {!working && !applying && (
            <Button
              variant={result ? "light" : "filled"}
              onClick={() => void search()}
            >
              {result ? "Search again" : "Find angles"}
            </Button>
          )}
          {candidate && !working && (
            <Button
              disabled={applying || priority !== searchedPriority}
              onClick={() => {
                setApplying(true);
                onApply(candidate);
              }}
            >
              Apply and arrange
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
