# Nozzle profiles

**Print setup → Edit printer → Nozzle diameter** offers 0.2, 0.4, 0.6 and 0.8 mm for Bambu X1 Carbon, P1S, P1P, A1, A1 mini and Snapmaker U1. U1 currently uses one common diameter for all four heads. Mixed head diameters are not implemented.

Changing diameter and saving loads the matching official start/end/change sequences before applying the new printer. A failed download leaves the previous project intact and keeps the dialog open for correction or retry. Template editors are disabled while their stored diameter differs from the draft selection. Same-diameter edits retain customized sequences. Nozzle changes replace them with the corresponding pinned vendor sequences.

Successful downloads are cached by printer, revision and diameter. A reload can use these without GitHub access. Legacy caches and saved sequences lacking diameter metadata are treated as 0.4 mm only. Portable projects retain the machine sequences and their `profileNozzle` tag. Slicing and direct machine-code compilation reject a mismatch until the matching profile is loaded. An unavailable browser cache does not prevent an online selection.

## Settings and limits

A diameter change resets the following geometry defaults: layer height = 50% of diameter, first layer = 60%, line width = 105%, adaptive minimum = 20% (at least 0.04 mm), and support clearance = one diameter. These are **Stratum defaults**, not a complete vendor process preset. The three quality shortcuts scale to 30%, 50% and 70%. Retraction lengths follow the pinned machine profiles below. Other settings, spool requirements, hardware configuration and purge budgets are preserved.

| Nozzle | Minimum layer | Maximum layer | X1C / P1S / P1P / A1 mini retraction | A1 retraction | U1 retraction |
|---|---|---|---|---|---|
| 0.2 mm | 0.04 mm | 0.14 mm | 0.4 mm | 0.8 mm | 0.4 mm |
| 0.4 mm | 0.08 mm | 0.28 mm; U1 0.32 mm | 0.8 mm | 0.8 mm | 1.5 mm |
| 0.6 mm | 0.12 mm | 0.42 mm | 1.4 mm | 0.8 mm | 1.4 mm |
| 0.8 mm | 0.16 mm | 0.56 mm | 3 mm | 0.8 mm | 1.5 mm |

Layer limits apply to normal and first-layer heights. Adaptive minima must lie between the profile minimum and the selected normal height. Line width stays within the editor's 60–200% diameter range. Official profiles require 1.75 mm filament. Per-spool minimum-nozzle requirements still apply, including abrasive-material restrictions. Flow, speed and temperature remain separately configurable.

## Pinned sources and inheritance

- [BambuStudio machine profiles](https://github.com/bambulab/BambuStudio/tree/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/profiles/BBL/machine). Non-0.4 variants inherit the corresponding model's 0.4 root. X1C/P1S/P1P override the start template for each diameter; end/change templates are inherited. A1 and A1 mini inherit all three sequences and use the selected diameter in their template expressions. Layer/retraction values also inherit through the published common definitions where absent.
- [Snapmaker Orca machine profiles](https://github.com/Snapmaker/OrcaSlicer/tree/89311782298309040ee28b9a183f33f0f5477b15/resources/profiles/Snapmaker/machine). Each U1 diameter has a separate root with direct sequences. The existing explicit U1 tool-change adapter remains in use; its state contract is documented in `machine-state.md`.

Only the start, end and change sequences used by Stratum are loaded. This does not import the full vendor process/material database. Profile files are fetched at runtime; their implementations are not copied into the repository. The root diameter is checked before templates are accepted, and provenance links identify the exact pinned root file.

Bambu print archives declare the canonical printer model, selected nozzle profile ID and diameter even when the workspace printer has a custom name. U1 jobs declare the diameter in all four metadata slots. Reopened exports recover it from metadata.

Validation covers all 24 combinations with actual two-color slices, unexpanded-template checks, an independent E/XY extrusion audit, export/reopen metadata, offline cache separation, legacy cache handling and desktop/phone selection and recovery. This is software validation; physical printer behavior and mixed-nozzle U1 jobs remain unverified.
