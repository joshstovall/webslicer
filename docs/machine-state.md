# Vendor tool-change state and profile loading

This describes the software contract implemented by `src/lib/machine-gcode.ts` and the evidence behind it. It does not establish physical printer validation.

## Planner and machine state

Kiri emits a travel retraction before a tool change and the matching recovery afterward. Its pending retraction is global across tool IDs. Machine macros run between these movements, and must leave the selected extruder with the same pending retraction expected by the planner.

The adapter tracks the planner's XYZ, feed rate, extrusion mode/register, pending retraction, and height already printed. It restores clearance before XY travel back from a station, then returns to the planned Z and feed rate. Relative XYZ and absolute E modes, including coordinate resets, are restored when present. The native Kiri multi-tool path uses absolute XYZ and relative E.

### Bambu AMS

The pinned Bambu change templates use `max_layer_z + 3` for their lift. `max_layer_z` now follows the height reached so far, rather than the eventual height of the whole model. Absolute Z movements inside change templates and the adapter's return lift are capped at the configured build height. These caps are specific to change movements; they do not rewrite homing, cleaning, start/end sequences or relative movements in user-edited templates.

The final template retraction matches the actual pending planner retraction, including zero or partial retraction. Calibration flow uses the incoming filament's volumetric limit. The current and maximum Z, return position, feed, and template expansion are exercised with all five pinned Bambu profiles.

### Snapmaker U1

The current pinned U1 change template delegates docking to `Tn` and first-use priming to `SM_PRINT_PREEXTRUDE_FILAMENT`. The separate machine profile specifies 10 mm tool-change retraction and 30 mm/s retraction/deretraction. Native Orca calls its tool-change retraction writer outside the custom template and retains per-extruder retraction state.

The adapter completes the outgoing head's pending travel retraction to 10 mm (or retains a larger existing debt), then remembers that parked head independently. After switching and waiting for its layer temperature, it restores the incoming head to the planner's pending debt. For example, with 0.8 mm already retracted: parking adds 9.2 mm; returning to that parked head restores 9.2 mm; Kiri's subsequent 0.8 mm recovery completes the operation. A first-use head starts with no writer-accounted debt and is retracted to the planner's pending amount after priming. Travel to/from tool changes is capped at the profile's 350 mm/s, and Z at the configured build height.

This follows the native writer's accounting contract. The internal priming/print macros are firmware-owned and their exact physical effects have not been exercised on hardware. The public U1 firmware restores motion/extrusion modal state around docking and provides a tool-addressed `M109`; the adapter nevertheless establishes its required modes and temperature explicitly. Four-head generated output is checked for retraction debt consuming model extrusion after repeated switches.

## Offline profile selection

Complete pinned template sets are cached in IndexedDB by firmware, printer ID and source revision, as well as in memory. Cached templates do not replace editable printer dimensions or names. Portable project files also retain their loaded templates. A partial template set triggers a fresh load. Missing/invalid responses fail selection; storage being disabled/full does not discard a successful online load.

Browser tests reload the app, block GitHub profile requests, and reselect both a Bambu profile and U1 from the cache. This provides offline profile selection once the application is loaded; it does not make an uncached application page or first-ever profile selection available without a network connection.

## Primary sources

- [Bambu Studio machine templates at 79df7ae](https://github.com/bambulab/BambuStudio/tree/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/profiles/BBL/machine).
- [Snapmaker U1 machine profile at 8931178](https://github.com/Snapmaker/OrcaSlicer/blob/89311782298309040ee28b9a183f33f0f5477b15/resources/profiles/Snapmaker/machine/Snapmaker%20U1%20%280.4%20nozzle%29.json).
- [Snapmaker Orca GCode tool-change writer](https://github.com/Snapmaker/OrcaSlicer/blob/89311782298309040ee28b9a183f33f0f5477b15/src/libslic3r/GCode.cpp), especially `set_extruder`, and [GCodeWriter retraction/unretraction](https://github.com/Snapmaker/OrcaSlicer/blob/89311782298309040ee28b9a183f33f0f5477b15/src/libslic3r/GCodeWriter.cpp).
- [U1 firmware extruder implementation at 10f2f69](https://github.com/Snapmaker/u1-klipper/blob/10f2f69714c059f1dee0423db4f515b8a01f5388/klippy/kinematics/extruder.py).

Official templates remain fetched from their pinned upstream sources, not bundled in this repository. An older research copy of the U1 template used a different explicit retract sequence; it is not the source for this implementation.

## Remaining audit

Continue physical material/temperature limits, cooling and acceleration behavior, native U1 job metadata, shared-nozzle purge accounting, exact purge quantities and tower placement, and firmware variant coverage. Software checks of emitted commands do not prove firmware macro behavior or hardware print quality. The full multi-color goal remains active; see `multicolor-progress.md`.
