# Imported G-code curves and material accounting

Plain G-code and every selected print-package plate use the same local parser. It preserves the original input for download. G0/G1 lines and G2/G3 arcs contribute to tool-colored preview paths, motion time and per-filament usage. Native slicing continues to export linear paths.

## Supported curves

- Clockwise/counterclockwise I/J center-offset arcs in XY; I/K and J/K in the selected vertical plane.
- Signed R radii: positive selects the minor arc, negative the major arc. A center-defined arc can describe a full circle with omitted or coincident planar endpoints.
- Helices interpolate the remaining axis while following the circle. Motion time uses the analytic helix length, rather than the endpoint chord or a sum of render segments.
- G17/G18/G19 plane selection, G90/G91 endpoint positioning, G90.1/G91.1 center positioning, G20/G21 units, M82/M83 extrusion, G92 resets and modal F. Unit conversion includes E and feed rate. Explicit extrusion mode remains independent of endpoint positioning, as in the existing interpreter.
- Tool registers and retraction debt remain independent. An arc that only recovers retracted filament appears as travel; a mixed recovery/deposition move is split at the recovery boundary. Startup consumption is counted even when its geometry is excluded.
- Orca/Prusa `;LAYER_CHANGE`, Bambu `; CHANGE_LAYER`, Cura `;LAYER:n` and Stratum/Kiri layer markers exclude pre-layer geometry and establish actual layer changes. TYPE/FEATURE comments retain walls, sparse/solid fill, supports and wipe/prime towers. Stratum's machine-change/end boundaries continue to exclude device routines.

The U1's pinned Klipper code uses the XZ orientation for G18. Marlin uses ZX, so the same G2/G3 command has a different direction in that plane. Recognized U1 file or selected-plate metadata selects the Klipper orientation; other imports default to Marlin's convention. Choosing an unrelated editable project printer does not change an imported file's convention. Unknown-printer dialect selection remains part of the broader import audit. Previewing a command does not establish that a particular firmware accepts it: for example, the pinned U1 firmware rejects R-form and relative-endpoint arcs even though this general viewer can visualize them.

## Precision and limits

Ordinary arcs use at most 1 mm per segment and a target chord error of 0.02 mm (plus source endpoint rounding). Each arc is capped at 4,096 rendered segments. Coarser long arcs produce a visible warning while retaining analytical time and filament accounting. Imported previews stop collecting geometry at 1,000,000 segments with a visible warning; they continue reading the entire file for consumption, time and modal state. Generated-job audits do not apply this import-only limit, so machine bounds and template layer counts never use truncated geometry.

Malformed center/radius combinations, impossible R endpoints, missing centers and inconsistent radii are reported. Their geometry and unknown duration are omitted; the declared endpoint, feed and E register are retained to interpret subsequent commands. The viewer does not invent a straight chord. Center-radius mismatch allows 0.05 mm or 0.1% of radius for source rounding. Multi-turn P arcs are currently reported rather than guessing between dialects' incompatible extra-circle/total-turn semantics. Firmware macros, offsets, volumetric extrusion, acceleration/heating and other unsupported machine behavior are not simulated. The motion estimate is therefore not a firmware execution forecast. Full printer-state/dialect fidelity remains open in the multicolor requirement ledger.

## Source evidence and verification

Geometry is independently implemented; no upstream firmware implementation is bundled.

- [Marlin G2/G3 contract](https://marlinfw.org/docs/gcode/G002-G003.html): direction, center/radius forms, full circles, planes and helical interpolation.
- [Klipper G-code reference](https://www.klipper3d.org/G-Codes.html#gcode_arcs): plane commands and supported arc parameters.
- [Pinned Snapmaker U1 arc implementation](https://github.com/Snapmaker/u1-klipper/blob/10f2f69714c059f1dee0423db4f515b8a01f5388/klippy/extras/gcode_arcs.py): G18 XZ orientation and firmware restrictions.
- [Pinned Snapmaker Orca processor tags](https://github.com/Snapmaker/OrcaSlicer/blob/89311782298309040ee28b9a183f33f0f5477b15/src/libslic3r/GCode/GCodeProcessor.cpp): Bambu and compatible layer/feature comments.

Core tests use analytically known quarter/major/full circles, helices, per-plane handedness, precise endpoints, sparse tools, modal state, retraction, malformed curves and preview limits. Desktop/phone browser tests open an arc-only multicolor file, switch U1/Bambu archive plates, verify palette/consumption and compare original downloads byte-for-byte. Rendering inspection checks that curves appear in the WebGL viewport. These are software checks; physical printer verification has not occurred.

The optional independent comparison executes the separately downloaded U1 planner and compares our parametric geometry at every firmware sample. With Node 24+ and Python 3:

```sh
curl -fsSL https://raw.githubusercontent.com/Snapmaker/u1-klipper/10f2f69714c059f1dee0423db4f515b8a01f5388/klippy/extras/gcode_arcs.py -o /tmp/u1-gcode-arcs.py
node scripts/verify-u1-arcs.mjs /tmp/u1-gcode-arcs.py
```

The verifier checks SHA-256 `6dddcfb3bc0e828b2f152f998ca494d338e95ca0259d79b1f57e788d7ab6f9dd` before loading the external module. The current comparison covers 24 trajectories / 930 points, with maximum position difference below 0.00000001 mm. It verifies geometry, not the printer's command acceptance, heater behavior or physical operation. The vendor source stays outside the application and repository.
