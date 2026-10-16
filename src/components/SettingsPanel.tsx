import {
  Accordion,
  Button,
  NumberInput,
  Select,
  Switch,
  SegmentedControl,
  TextInput,
  Tooltip,
  ActionIcon,
  Badge,
} from "@mantine/core";
import {
  Printer as PrinterIcon,
  SlidersHorizontal,
  Search,
  Layers3,
  Grid3X3,
  Gauge,
  GitBranch,
  Wind,
  Thermometer,
  Settings2,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import type { Printer, Settings } from "../types";
import { thermalLimits } from "../lib/thermal-limits";
import { PRINTERS, MATERIALS, QUALITY } from "../lib/profiles";
interface Props {
  filamentCount: number;
  onFilaments: () => void;
  settings: Settings;
  printer: Printer;
  onChange: (patch: Partial<Settings>) => void;
  onPrinter: (p: Printer) => void;
  onEditPrinter: () => void;
  onProfiles: () => void;
  disabled: boolean;
}
export function SettingsPanel({
  filamentCount,
  onFilaments,
  settings: s,
  printer,
  onChange,
  onPrinter,
  onEditPrinter,
  onProfiles,
  disabled,
}: Props) {
  const limits = thermalLimits(printer);
  const [advanced, setAdvanced] = useState(false),
    [query, setQuery] = useState("");
  function number(
    key: keyof Settings,
    label: string,
    min: number,
    max: number,
    step = 1,
    suffix = "",
  ) {
    return (
      <NumberInput
        label={label}
        value={s[key] as number}
        error={
          (s[key] as number) > max || (s[key] as number) < min
            ? `Allowed range: ${min}–${max}${suffix}`
            : undefined
        }
        onChange={(v) => {
          if (typeof v === "number" && v >= min && v <= max)
            onChange({ [key]: v });
        }}
        min={min}
        max={max}
        step={step}
        suffix={suffix}
        decimalScale={step < 0.1 ? 3 : step < 1 ? 2 : 0}
        size="xs"
        disabled={
          disabled ||
          (filamentCount > 1 &&
            [
              "nozzleTemp",
              "firstNozzleTemp",
              "flow",
              "maxFlow",
              "density",
              "cost",
              "fan",
              "fanLayer",
              "fanRampLayers",
              "minLayerTime",
              "minPrintSpeed",
            ].includes(key))
        }
      />
    );
  }
  function select(
    key: keyof Settings,
    label: string,
    data: { value: string; label: string }[] | string[],
  ) {
    return (
      <Select
        label={label}
        data={data}
        value={s[key] as string}
        onChange={(v) => v && onChange({ [key]: v })}
        size="xs"
        allowDeselect={false}
        disabled={disabled}
      />
    );
  }
  function toggle(key: keyof Settings, label: string, description?: string) {
    return (
      <Switch
        label={label}
        description={description}
        checked={s[key] as boolean}
        onChange={(e) => onChange({ [key]: e.currentTarget.checked })}
        size="sm"
        disabled={disabled}
      />
    );
  }
  const groups = [
    {
      id: "quality",
      title: "Quality",
      icon: Layers3,
      summary: `${s.layerHeight.toFixed(2)} mm`,
      keywords: "layer line width adaptive thin walls vase",
      content: (
        <>
          <div className="field-pair">
            {number(
              "layerHeight",
              "Layer height",
              0.04,
              printer.nozzle * 0.8,
              0.01,
              " mm",
            )}
            {number(
              "firstLayerHeight",
              "First layer",
              0.04,
              printer.nozzle,
              0.01,
              " mm",
            )}
          </div>
          {number(
            "lineWidth",
            "Line width",
            printer.nozzle * 0.6,
            printer.nozzle * 2,
            0.01,
            " mm",
          )}
          {advanced && (
            <>
              {toggle(
                "adaptive",
                "Adaptive layer height",
                "Vary layer heights to follow the model.",
              )}
              {s.adaptive &&
                number(
                  "minLayerHeight",
                  "Minimum layer height",
                  0.04,
                  s.layerHeight,
                  0.01,
                  " mm",
                )}
              {toggle("thinWalls", "Detect thin walls")}
              {toggle(
                "vase",
                "Spiral vase",
                "Single continuous outer wall; no top layers.",
              )}
              {select("seam", "Seam placement", [
                { value: "last", label: "Nearest" },
                { value: "center", label: "Center" },
                { value: "random", label: "Random" },
              ])}
            </>
          )}
        </>
      ),
    },
    {
      id: "strength",
      title: "Strength",
      icon: Grid3X3,
      summary: `${s.infill}% infill`,
      keywords: "walls top bottom infill shell angle overlap",
      content: (
        <>
          {number("walls", "Wall loops", 1, 20)}
          <div className="field-pair">
            {number("topLayers", "Top layers", 0, 30)}
            {number("bottomLayers", "Bottom layers", 1, 30)}
          </div>
          {number("infill", "Infill density", 0, 100, 1, " %")}
          {select("infillPattern", "Infill pattern", [
            { value: "gyroid", label: "Gyroid" },
            { value: "grid", label: "Grid" },
            { value: "hex", label: "Honeycomb" },
            { value: "triangle", label: "Triangles" },
            { value: "linear", label: "Lines" },
            { value: "cubic", label: "Cubic" },
          ])}
          {advanced && (
            <>
              {number("infillAngle", "Infill angle", 0, 180, 1, "°")}
              {number("infillOverlap", "Infill overlap", 0, 50, 1, " %")}
              {select("wallOrder", "Wall order", [
                { value: "in-out", label: "Inner → outer" },
                { value: "out-in", label: "Outer → inner" },
              ])}
            </>
          )}
        </>
      ),
    },
    {
      id: "speed",
      title: "Speed",
      icon: Gauge,
      summary: `${s.speed} mm/s`,
      keywords: "speed travel outer first layer flow time",
      content: (
        <>
          <div className="field-pair">
            {number("speed", "Print speed", 5, 500, 5, " mm/s")}
            {number("outerSpeed", "Outer wall", 5, 300, 5, " mm/s")}
          </div>
          <div className="field-pair">
            {number("travelSpeed", "Travel", 10, 600, 10, " mm/s")}
            {number("firstLayerSpeed", "First layer", 5, 100, 5, " mm/s")}
          </div>
          {advanced && (
            <>
              {number("maxFlow", "Max volumetric flow", 1, 100, 0.5, " mm³/s")}
              {number("minLayerTime", "Minimum layer time", 0, 120, 1, " s")}
              {number(
                "minPrintSpeed",
                "Minimum cooling speed",
                1,
                100,
                1,
                " mm/s",
              )}
            </>
          )}
        </>
      ),
    },
    {
      id: "support",
      title: "Support & adhesion",
      icon: GitBranch,
      summary: s.supports === "disabled" ? "Off" : "On",
      keywords: "support tree brim skirt raft overhang",
      content: (
        <>
          {select("supports", "Support generation", [
            { value: "disabled", label: "Disabled" },
            { value: "auto", label: "Automatic · normal" },
            { value: "tree", label: "Automatic · tree" },
          ])}
          {s.supports !== "disabled" && (
            <>
              <div className="field-pair">
                {number("supportAngle", "Overhang angle", 15, 85, 1, "°")}
                {number("supportDensity", "Density", 5, 80, 1, " %")}
              </div>
              {advanced &&
                number("supportOffset", "XY separation", 0.1, 3, 0.1, " mm")}
            </>
          )}
          {select("adhesion", "Build plate adhesion", [
            { value: "none", label: "None" },
            { value: "skirt", label: "Skirt" },
            { value: "brim", label: "Brim" },
            { value: "raft", label: "Raft" },
          ])}
          {s.adhesion === "brim" && (
            <div className="field-pair">
              {number("brimWidth", "Brim width", 1, 20, 0.5, " mm")}
              {number("brimGap", "Brim gap", 0, 1, 0.05, " mm")}
            </div>
          )}
          {s.adhesion === "skirt" && (
            <div className="field-pair">
              {number("skirtLoops", "Skirt loops", 1, 10)}
              {number("skirtDistance", "Distance", 1, 20, 1, " mm")}
            </div>
          )}
        </>
      ),
    },
    {
      id: "material",
      title: "Temperature & cooling",
      icon: Thermometer,
      summary:
        filamentCount > 1
          ? `Per filament / ${s.bedTemp}° bed`
          : `${s.nozzleTemp}° / ${s.bedTemp}°`,
      keywords: "nozzle bed temperature cooling fan material",
      content: (
        <>
          <div className="field-pair">
            {number(
              "nozzleTemp",
              "Nozzle",
              150,
              limits?.nozzle ?? 350,
              5,
              " °C",
            )}
            {number("bedTemp", "Bed", 0, limits?.bed ?? 130, 5, " °C")}
          </div>
          {advanced && (
            <div className="field-pair">
              {number(
                "firstNozzleTemp",
                "First layer nozzle",
                150,
                limits?.nozzle ?? 350,
                5,
                " °C",
              )}
              {number(
                "firstBedTemp",
                "First layer bed",
                0,
                limits?.bed ?? 130,
                5,
                " °C",
              )}
            </div>
          )}
          {number("fan", "Cooling fan", 0, 100, 5, " %")}
          {advanced && number("fanLayer", "Fan starts at layer", 1, 20)}
          {advanced &&
            number("fanRampLayers", "Fan ramp length", 1, 20, 1, " layers")}
        </>
      ),
    },
    {
      id: "filament",
      title: "Filament & retraction",
      icon: Wind,
      summary: `${s.retraction} mm`,
      keywords: "retraction flow density cost filament z hop",
      content: (
        <>
          <div className="field-pair">
            {number("retraction", "Retraction", 0, 10, 0.1, " mm")}
            {number("retractSpeed", "Retract speed", 5, 100, 5, " mm/s")}
          </div>
          {number("zHop", "Z hop", 0, 3, 0.1, " mm")}
          {number("flow", "Flow ratio", 0.5, 1.5, 0.01)}
          {advanced && (
            <div className="field-pair">
              {number("density", "Density", 0.5, 3, 0.01, " g/cm³")}
              {number("cost", "Price per kg", 0, 500, 1, " $")}
            </div>
          )}
        </>
      ),
    },
  ];
  const filtered = groups.filter((g) =>
    `${g.title} ${g.keywords}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="settings-content">
      <div className="panel-eyebrow">
        PRINT SETUP{" "}
        <Tooltip label="Save or load print presets">
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Manage print presets"
            onClick={onProfiles}
          >
            <SlidersHorizontal size={16} />
          </ActionIcon>
        </Tooltip>
      </div>
      <div className="printer-card">
        <div className="printer-icon">
          <PrinterIcon size={25} strokeWidth={1.5} />
        </div>
        <div>
          <span className="muted small">Printer</span>
          <Select
            aria-label="Printer"
            value={printer.id}
            data={PRINTERS.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => {
              const p = PRINTERS.find((p) => p.id === v);
              if (p) onPrinter(structuredClone(p));
            }}
            variant="unstyled"
            allowDeselect={false}
            disabled={disabled}
          />
          <span className="muted small">
            {printer.bed.join(" × ")} mm · {printer.nozzle} mm nozzle
          </span>
        </div>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="Edit printer"
          onClick={onEditPrinter}
          disabled={disabled}
        >
          <Settings2 size={16} />
        </ActionIcon>
      </div>
      <div className="material-header">
        <span className="panel-label">Filament</span>
        <Badge color="gray" variant="light" size="xs">
          {filamentCount} {filamentCount === 1 ? "filament" : "filaments"}
        </Badge>
      </div>
      <div className="material-card">
        <span
          className="filament-swatch"
          style={{
            background: MATERIALS.find((m) => m.name === s.material)?.color,
          }}
        />
        <Select
          aria-label="Material"
          data={[
            ...MATERIALS.map((m) => ({
              value: m.name,
              label: `Generic ${m.name}`,
            })),
            ...(!MATERIALS.some((m) => m.name === s.material)
              ? [{ value: s.material, label: s.material }]
              : []),
          ]}
          value={s.material}
          onChange={(v) => {
            const m = MATERIALS.find((m) => m.name === v);
            if (m)
              onChange({
                material: m.name,
                nozzleTemp: m.nozzle,
                firstNozzleTemp: m.nozzle + 5,
                bedTemp: m.bed,
                firstBedTemp: m.bed,
                density: m.density,
                fan: m.fan,
                maxFlow: m.flow,
              });
          }}
          variant="unstyled"
          allowDeselect={false}
          disabled={disabled || filamentCount > 1}
        />
        <span className="muted small">{printer.filament} mm</span>
      </div>
      <Button
        variant="light"
        size="xs"
        fullWidth
        mb="sm"
        onClick={onFilaments}
        disabled={disabled}
      >
        Manage filaments
      </Button>
      <div className="process-heading">
        <div>
          <span className="panel-label">Process</span>
          <span className="small muted">Global settings</span>
        </div>
        <Switch
          label="Advanced"
          checked={advanced}
          onChange={(e) => setAdvanced(e.currentTarget.checked)}
          size="xs"
          labelPosition="left"
        />
      </div>
      <SegmentedControl
        fullWidth
        size="xs"
        className="quality-presets"
        value={String(s.layerHeight)}
        onChange={(v) => onChange({ layerHeight: Number(v) })}
        data={QUALITY.map((q) => ({
          value: String(q.value),
          label: (
            <div>
              <strong>{q.value.toFixed(2)}</strong>
              <span>{q.name}</span>
            </div>
          ),
        }))}
        disabled={disabled}
      />
      <TextInput
        className="settings-search"
        placeholder="Find a setting…"
        aria-label="Find a setting"
        leftSection={<Search size={14} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        size="xs"
        rightSection={
          query ? (
            <ActionIcon
              variant="subtle"
              size="xs"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              ×
            </ActionIcon>
          ) : null
        }
      />
      <Accordion
        multiple
        defaultValue={["quality", "strength"]}
        chevron={<ChevronRight size={14} />}
        className="settings-accordion"
        {...(query ? { value: filtered.map((g) => g.id) } : {})}
      >
        {filtered.map((g) => (
          <Accordion.Item value={g.id} key={g.id}>
            <Accordion.Control icon={<g.icon size={16} />}>
              <span className="accordion-title">
                {g.title}
                <span>{g.summary}</span>
              </span>
            </Accordion.Control>
            <Accordion.Panel>
              <div className="settings-fields">{g.content}</div>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      {!filtered.length && (
        <p className="muted empty-search">No matching settings.</p>
      )}
      <div className="local-note">
        <span className="status-dot" /> Everything stays on this device
      </div>
    </div>
  );
}
