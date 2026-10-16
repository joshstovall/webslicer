# Filament settings and thermal limits

## Editing and recovery

Manage filaments exposes each spool's first/normal nozzle temperatures, extrusion ratio, volumetric flow, part-cooling percentage, fan start layer/ramp, minimum layer time, minimum cooling speed, density and cost. Fan start layers are one-based; before that layer the part fan is off. A ramp length of 1 applies full configured fan speed at the start layer. For a ramp of N layers, the first enabled layer uses 1/N of the target, reaching the full target on start + N − 1. Older projects inherit the saved global fan start layer for every spool, then persist it independently. Removing the last extra slot returns the remaining spool's values to the single-material setup controls.

A single spool is authoritative for material settings. Process edits preserve its properties; applying or importing a preset updates its material values while retaining its name/color. With multiple spools, presets update process and shared-bed settings without replacing individual material values. The global material selector and spool-specific fields are disabled for multiple spools; use Manage filaments instead. Bed temperatures remain shared and are not changed when choosing a spool material. The Saved indicator refers to the current project revision; a delayed completion from an older edit cannot mark newer edits as saved.

Volumetric flow is editable from 1–100 mm³/s in both interfaces. This is a UI range, not a claim about a particular hotend's capacity. Use a tested limit for the installed material/nozzle. The advertised U1 throughput is conditional on its manufacturer's test setup, so it is not imposed as a universal material limit.

## Generated commands

Explicit filament jobs use G90/M83 at the planned-region boundary, including single-filament jobs. The material pass scales positive depositing E by the spool/process flow ratio, then limits feed using the rounded emitted E, filament diameter and 3D move distance. Feed rounds down to avoid exceeding the volumetric limit. Travel/retraction restores the requested modal feed after a flow-limited move. G90/G91 and G92 coordinates are tracked. Unexpected absolute extrusion in a planned depositing path is rejected.

The active spool's first-layer or normal temperature is set at layer boundaries when it changes. After a tool change, temperature and fan are always restored because machine sequences may change them. Repeated unchanged layer temperatures do not insert redundant waits. Bambu part cooling uses M106 P1. P3 chamber commands are preserved; P2 auxiliary commands are preserved unless an active spool opts into auxiliary control. U1 uses unindexed M106 because its firmware binds the print fan to the active extruder; the tool number is not a fan index. Startup, shutdown and tool-change sequences retain their own commands.

Flow limiting here covers planned deposition, including the tower, rather than opaque firmware macros or every machine calibration/purge operation. Firmware owns the U1 macro internals. These implementation checks do not establish physical printer validation.

## Whole-layer cooling

Each spool can request 0–120 seconds of minimum layer time (0 disables its own request) and a 1–100 mm/s cooling speed floor. Old spools inherit the saved global minimum-layer-time setting and a 10 mm/s floor; old fan behavior uses a one-layer ramp. New fields participate in single-spool preset edits and project recovery. Multi-spool process presets leave individual cooling settings intact; the global material/cooling editors are disabled in that mode.

The layer target is the maximum request among spools actually depositing material in that layer, including support and tower material. The calculation covers the complete layer rather than separately slowing each object. It counts planned deposition, travel, retraction/recovery and explicit dwell. It excludes startup/shutdown, opaque tool-change routines and temperature waits, whose real duration is unknown. Accelerations, firmware feed overrides and physical cooling performance are not modeled.

After per-filament flow limiting, `src/lib/cooling.ts` slows depositing moves uniformly until the target is reached or each move reaches its spool’s floor. Existing lower feeds remain lower; cooling never increases a flow-limited or otherwise slower move. Travel and retraction retain their original feeds. Rounded emitted feeds are used to solve the timing target. Repeated explicit F commands are rewritten correctly, and the intended feed is restored before custom tool-change code.

If slowdown is insufficient, the head retracts if necessary, lifts up to 2 mm, waits for the remaining time, and returns. It preserves each tool’s existing retraction debt and recovers only the additional retraction it introduced. XYZ mode, logical Z/coordinate offsets and feed are restored; XY stays unchanged. The lift is capped at the machine’s Z ceiling and requires at least 0.5 mm of available height. A continuous spiral vase is never interrupted with a cooling wait. When a target cannot be reached under those constraints, the preview reports it explicitly; the target is not claimed achieved. Reduce the floor or target, or leave more Z clearance.

Cooling waits use millisecond `G4 P` commands, documented by [Marlin](https://marlinfw.org/docs/gcode/G004.html) and [Klipper](https://www.klipper3d.org/G-Codes.html). They are included in exported job and preview time estimates. The pass operates only on linear, millimeter planned output; imported arcs and vendor routines retain their existing separate handling. Kiri’s per-object minimum-time slowdown is disabled so it does not run in addition to this whole-layer pass. The engine already emits linear paths.

Tests independently sum emitted motion/dwell time across color changes, verify fan ramps and bounded lifts, check unchanged purge quantities/flow ceilings, and exercise desktop Bambu and phone U1 exports. They also cover zero targets, asymmetric spool settings, per-tool retraction, coordinate/mode restoration, safe failures/warnings, presets and recovery. This is software verification, not physical printer validation.

## Manufacturer temperature ceilings

All six included vendor profiles have a 300°C nozzle ceiling. Bed ceilings are:

| Machine | Bed ceiling |
| --- | --- |
| Bambu X1 Carbon | 110°C with unspecified/220 V supply; 120°C at 110 V |
| Bambu P1S, P1P, A1 | 100°C |
| Bambu A1 mini | 80°C |
| Snapmaker U1 | 100°C |

X1 Carbon's mains supply can be set in Printer configuration and is retained in recovery/project files. The unspecified choice uses 110°C. Temperatures above a newly selected profile's limit are reported, not silently accepted for slicing. Active model/paint/support spools are checked before geometry work; unused slots need not match the selected machine. Shared-bed targets are always checked. After machine-template expansion, explicit M104/M109/M140/M190 commands are audited too, including S/R/H targets, heater-off, decimal command variants, compact syntax and numbered lines. Comments are excluded. Unknown firmware macros are not interpreted by this audit.

Custom/generic machines retain configurable temperatures (150–350°C nozzle, 0–130°C bed); these are editor bounds, not manufacturer certification. Firmware-specific physical bounds, additional material/feed variants, overhang-specific cooling and broader chamber-fan controls still require further work under the full multi-color goal.

## Primary source references

- [X1 Carbon technical specifications](https://public-cdn.bambulab.com/store/bambulab-X1-carbon-tech-specs.pdf?v=20250715085516): nozzle ceiling and voltage-dependent bed limits.
- [P1S quick-start specifications](https://cdn1.bambulab.com/documentation/quick-start-59b0cefdc0fc4/P1S/English%20version-Quick%20Start%20Guide%20for%20P1S.pdf), [P1P technical specifications](https://public-cdn.bambulab.com/store/bambulab-P1P-tech-specs.pdf), [A1 specifications](https://bambulab.com/pl/a1/tech-specs), [A1 mini quick-start specifications](https://cdn1.bambulab.com/documentation/Quick%20Start%20Guide%20for%20A1%20mini%20Combo.pdf).
- [Snapmaker U1 specifications](https://www.snapmaker.com/en-US/snapmaker-u1/specs): thermal limits and conditional throughput. No firmware source is copied into the application.
- U1 Klipper revision `10f2f69714c059f1dee0423db4f515b8a01f5388`: [fan protocol](https://github.com/Snapmaker/u1-klipper/blob/10f2f69714c059f1dee0423db4f515b8a01f5388/klippy/extras/fan.py) and [extruder fan binding](https://github.com/Snapmaker/u1-klipper/blob/10f2f69714c059f1dee0423db4f515b8a01f5388/klippy/kinematics/extruder.py).
- Bambu part/auxiliary fan indices also appear in the pinned machine sequences at Bambu Studio revision `79df7ae309be398ed30c9f397c13c9911c2edc57` (`resources/profiles/BBL/machine/`).


## Material compatibility and installed hardware

In **Manage filaments → Filament N material requirements**, enter a material code and the exact spool's enclosure, abrasion, minimum nozzle diameter and optional shared-bed temperature range. Codes such as PA6-CF and PVA are supported independently of the cosmetic spool name. Selecting another material or changing its code clears the previous product's requirement overrides. Process-only edits preserve them; multi-spool process presets leave them intact. Custom material codes remain visible in the global material selector.

**Printer configuration → Installed material hardware** records an enclosure/top cover and heads equipped with abrasion-resistant nozzles and compatible feed gears. X1 Carbon defaults to enclosed with an abrasion-ready head; P1S defaults to enclosed without that upgrade. P1P, A1, A1 mini and U1 default to open without abrasion-ready heads. Generic machines leave enclosure unspecified. All AMS slots map to physical head 1; U1's four heads have separate selections. These controls record installed equipment; they do not change the selected nozzle diameter or certify modifications. Choose the common diameter separately in Printer configuration; see `nozzle-profiles.md`.

Requirements are conservative, editable assumptions, not a complete filament-product database. ABS, ASA, PA, PC, PET and POM default to requiring enclosure; CF/GF, carbon/glass-fiber and glow identifiers default to abrasive. The default minimum nozzle is 0.4 mm for abrasive material and 0.2 mm otherwise. Exact products can require larger diameters or different hardware. No universal bed range is inferred: enabling the range editor starts with an editable 50–70°C interval, which must be replaced with the manufacturer's values. Both first-layer and normal bed targets must satisfy every used spool; disjoint ranges are reported explicitly. Unknown families retain a warning even with manual requirements.

Current Bambu profiles use AMS (X1/P1) or AMS lite (A1/A1 mini). Generic TPU/TPE requires an explicit manufacturer-approved feed compatibility setting for the exact spool. An AMS approval does not carry over to AMS lite. Unspecified flexible feed compatibility still blocks slicing. Abrasive products with unspecified feeder compatibility receive a warning even on hardened printer hardware; soluble PVA/BVOH receives a dryness reminder. External-spool and AMS HT bypass variants are not represented by these profiles. Setting a spool as compatible records the operator's manufacturer-data decision, not a verification by the application.

Checks cover visible models on the selected plate, their painted tools, and enabled support tools. Unused/hidden spools do not block slicing. Linked or painted mixed-family parts warn about bonding/shrinkage; unrelated objects and support-only materials do not create that joint warning. U1 multi-material flexible towers receive a rigidity reminder. Requirements appear before slicing, errors stop direct slicing calls before engine creation, and warnings persist in the generated preview. Hardware and spool requirements survive local recovery and portable projects; malformed values are rejected during import.

Primary hardware/feed sources checked October 16, 2026:

- [U1 specifications](https://www.snapmaker.com/en-US/snapmaker-u1/specs): stock stainless nozzle, basic material list, top-cover material list and hardened-nozzle combination.
- [X1 Carbon specifications](https://public-cdn.bambulab.com/store/bambulab-X1-carbon-tech-specs.pdf?v=20250715085516): enclosed body, hardened nozzle and extruder gears.
- [P1S manufacturer listing](https://us.store.bambulab.com/collections/3d-printer/products/p1s): stainless stock nozzle and extruder/hotend upgrades for fiber-reinforced materials.
- [Bambu AMS quick-start guidance](https://cdn1.bambulab.com/documentation/quick-start-695a11c5f06d6/Y.BC.BQ.Z0056-09_BLP001-%E5%8C%85%E8%A3%85-%E5%A5%97%E8%A3%85%E5%BF%AB%E9%80%9F%E5%85%A5%E9%97%A8%28%E8%8B%B1%E6%96%87%29.pdf): soft TPU and damp PVA feed restrictions.
- [Bambu TPU 85A/90A product data](https://us.store.bambulab.com/products/tpu-85a-tpu-90a/): compatibility depends on exact flexible product, printer, nozzle and feed path.

These checks do not predict adhesion, dimensional shrinkage, moisture content, enclosure temperatures, emissions or physical tower strength. Exact material testing and additional firmware/nozzle variants remain part of the broader unfinished multi-color scope.


## Bridge and auxiliary cooling

Each spool's **Layer cooling** panel has optional bridge and auxiliary fan overrides. Existing projects leave both unset. Bridge fan percentage applies to unsupported solid-fill deposition after the spool's fan start layer. It uses the full bridge target, then restores the normal layer-ramp target before the next non-bridge deposition. Travel between bridge lines retains the bridge target. Layer and tool boundaries restore normal cooling before the next path's bridge marker. No extra heater waits are introduced for unchanged targets.

Bridge classification compares each solid-fill segment against the previous physical layer's solid footprints across all material parts, including holes and overlapping material footprints. A segment is classified when its uncovered length exceeds half a line width (at least 0.05 mm). Bed-contact layers are excluded using actual slice height; previously printed slices may support the next layer even when their elevations overlap its base. Supports count only when their sliced geometry reaches that plane. Walls, sparse infill and purge paths keep their original classifications. This describes geometric support, not sagging, sparse-infill density, airflow or material strength. Bridge deposition has a separate teal **Bridges** preview feature; imported bridge feature labels use it too.

The engine previously chose a different starting grid for elevated widgets, creating duplicate-height tower-only layers when combined with bed-contact parts. All application slices now use the same configured first-layer height to start their grid. The arch regression checks unique layer heights and both materials' early fan ramps; a supported stacked-color object must not produce bridge markers. Independently adaptive per-part layer scheduling still needs a broader consistency audit.

Auxiliary control has its own fan percentage, one-based start layer and ramp. Defaults for start/ramp follow the spool's part fan until explicitly set. Bambu X1C/P1S and U1 expose auxiliary P2. P1P requires the auxiliary hardware toggle; A1/A1 mini profiles do not advertise an auxiliary fan. Generic printers can configure an installed auxiliary fan and its firmware P index. These are fan identifiers, not tool numbers. Unsupported nonzero requests stop slicing before worker creation.

Once an active spool opts in, auxiliary cooling belongs to the current spool: an active spool with no override uses 0%, preventing the previous spool's airflow from leaking into it. Unused spools cannot take ownership. Targets are reapplied after machine tool-change routines. Explicit chamber/hotend controls and startup/change/end routines remain intact. The owned auxiliary fan stays on through the final layer-cooling wait, then receives an off command before the end sequence. No-spool-override jobs retain previous auxiliary behavior. Material code/preset changes clear prior product-specific cooling overrides; process edits and recovery preserve them.

Protocol evidence: [pinned U1 fan implementation](https://github.com/Snapmaker/u1-klipper/blob/10f2f69714c059f1dee0423db4f515b8a01f5388/klippy/extras/fan.py) routes indexed M106/M107 to configured extension fans; [pinned printer configuration](https://github.com/Snapmaker/u1-klipper/blob/10f2f69714c059f1dee0423db4f515b8a01f5388/lava/printer.cfg) assigns auxiliary P2 to its cavity fan. Bambu P2 usage is present in the [pinned P1S machine end template](https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/profiles/BBL/machine/Bambu%20Lab%20P1S%200.4%20nozzle%20template%20machine_end_gcode.json). No firmware implementation is copied into the app.

The engine adaptation is original Stratum code plus a small patch to the MIT Kiri runtime. `scripts/patch-bridge-cooling.py` reproduces from `f46e633`; helper/runtime checksums are recorded in `vendor-manifest.json`. Classification does not change extrusion coordinates, flow, tool assignments or existing feature labels. Cooling changes and the shared starting-grid correction are software-tested; physical print behavior remains unverified.
