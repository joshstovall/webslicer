# Snapmaker U1 jobs

U1 slicing now produces a plain `.gcode` file with the same compiled motion/temperature/tool-change commands as before, plus printer-readable comments and PNG thumbnails. The generated result already contains the metadata, so download, raw inspection and Moonraker upload use the same job. Uploading does not start a print.

## Comment contract

The header identifies the generator as **Stratum 0.1.0**. A separate `metadata format: OrcaSlicer Stratum-0.1.0 on export` compatibility marker selects the Orca comment decoder in Snapmaker's published Moonraker reader. It does not claim generation by Snapmaker Orca or activate the firmware's official-Snapmaker-slicer branch. The reference parser reports `slicer=OrcaSlicer`, `slicer_version=Stratum-0.1.0`; this is a decoder compatibility convention, not upstream affiliation.

The footer contains an Orca-style configuration block: printer identity/nozzle size, filament colors/names/types, diameters/densities/costs, flow ratios/limits, first/normal temperatures, shared bed settings, layer heights, line width and outer-wall speed. Slot arrays always contain four entries. Sparse tool usage stays in its physical position (e.g. using T1/T3 yields `0, used1, 0, used3`), allowing the U1 service to identify used heads from consumption. Strings are constrained to one comment line and delimiter characters are sanitized; metadata cannot add executable commands.

The 48 × 48 and 300 × 300 PNG blocks match the pinned U1 profile's requested sizes. Base64 lengths and line chunks follow the published file-reader contract. Thumbnails fit deposited paths, including the tower, instead of the entire build volume. This also improves Bambu package thumbnails for small models. Geometry is rendered once; the smaller preview is resampled from that canvas to avoid repeating the drawing work on mobile devices. Travel and machine calibration motion do not appear in the thumbnail.

Totals and per-tool length/weight include explicit parsed extrusion. Estimates use the existing motion-only calculator: heating, acceleration and opaque firmware macro internals are not modeled. The exported comments identify this basis. This metadata work does not establish physical printer validation, macro internals, nozzle variants or all firmware versions.

## Reopening and archives

Plain G-code imports inspect bounded header/footer windows for comment metadata. Recognized machine names set preview dimensions; filament names/colors/properties retain slot positions. Numeric values are bounded, quoted string vectors are supported, and malformed optional data does not replace calculated values. Executable instructions are not treated as metadata. Original downloads remain byte-for-byte identical.

Archives can use embedded G-code metadata when project/plate fields are absent. The pinned Snapmaker model ID `SM_U1` is recognized. Plate-specific archive prediction/weight/filament usage takes precedence over G-code summaries and is shown separately from calculated statistics. Existing unknown-printer and duplicate/checksum diagnostics remain in place. Per-tool declared usage is visible in the preview on desktops and phones.

## Source evidence and interoperability check

- [Snapmaker U1 Moonraker metadata reader](https://github.com/Snapmaker/u1-moonraker/blob/a308cfae31b7eb70ebf96bc73e6968d9792e4d73/moonraker/components/file_manager/metadata.py), revision `a308cfae31b7eb70ebf96bc73e6968d9792e4d73`: identity aliases, comment fields, thumbnail framing, one-MiB header/footer windows, and sparse usage arrays. SHA-256 of the verification source is `07c1e72d9f0cbcc2d6dfc3021c1b1bd9c6727ec20c2623463e1722cd3e756c7a`.
- [Pinned U1 machine profile](https://github.com/Snapmaker/OrcaSlicer/blob/89311782298309040ee28b9a183f33f0f5477b15/resources/profiles/Snapmaker/machine/Snapmaker%20U1%20(0.4%20nozzle).json): 48/300 PNG sizes. [Machine model](https://github.com/Snapmaker/OrcaSlicer/blob/89311782298309040ee28b9a183f33f0f5477b15/resources/profiles/Snapmaker/machine/Snapmaker%20U1.json): `SM_U1` identity.
- [Pinned Orca G-code writer](https://github.com/Snapmaker/OrcaSlicer/blob/89311782298309040ee28b9a183f33f0f5477b15/src/libslic3r/GCode.cpp): config/summary field serialization and zero placeholders for unused extruders. [3MF writer](https://github.com/Snapmaker/OrcaSlicer/blob/89311782298309040ee28b9a183f33f0f5477b15/src/libslic3r/Format/bbs_3mf.cpp): plate IDs, model identity, prediction and filament usage fields.
- [U1 print-task firmware](https://github.com/Snapmaker/u1-klipper/blob/10f2f69714c059f1dee0423db4f515b8a01f5388/klippy/extras/print_task_config.py): used-head detection from slot consumption and the separate official-slicer branch.

The app uses independently implemented serialization/parsing of these data contracts. Upstream GPL implementations are not bundled. For independent verification, download the pinned `metadata.py` separately and use Python with Pillow. The browser test `tests/e2e/u1-metadata.spec.ts` writes exported G-code and expected usage to `/tmp/stratum-u1-native-{1440,390}.{gcode,json}`. Then run:

```sh
python3 scripts/verify-u1-metadata.py \
  --parser /tmp/stratum-research/u1-metadata.py \
  --gcode /tmp/stratum-u1-native-1440.gcode \
  --expected /tmp/stratum-u1-native-1440.json
```

The verifier pins the source checksum and checks actual vendor parsing of identity, all four usage/diameter/color/type slots, temperatures, layer count, estimates and PNG extraction/framing. Browser tests additionally cover mock Moonraker upload, desktop/phone reopening, plate-summary selection and exact original downloads. The check is an interoperability test against published software, not a physical print.
