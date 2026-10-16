# Multi-color printer support — implementation checkpoint

User objective: **add full support for multi color printers, and add profiles for Bambu and Snapmaker U1.** This goal is active. This document tracks unfinished work and must not be mistaken for a completion certificate.

## Implemented and verified locally

- Per-object filament slot IDs, editable filament names/colors/material/temperatures/flow/density/cost, slot capacity validation, support-tool selection, purge tower control.
- Multi-widget Kiri slicing preserves tool assignments. The bridge exports the existing internal engine worker client (documented in engine NOTICE), synchronizes all parts, slices each, then performs joint preparation/export. A real 0/2 tool test verifies non-contiguous tools and purge tower paths.
- Relative extrusion for multi-tool output. Per-tool temperatures, cooling, flow ratio, volumetric limits, all-tool shutdown for generic independent heads.
- Independent G-code E registers, retraction debt, tool colors, usage/cost, tool-change counts, and purge feature classification. Startup/purge-station moves are excluded from layer geometry but consumed filament is counted.
- IndexedDB/project migration and validation, undo/redo through project edits, material assignment preservation through cuts/splits.
- Official profile metadata for Bambu X1 Carbon, P1S, P1P, A1, A1 mini (AMS), and Snapmaker U1. Only 0.4 mm variants are currently exposed. Bambu shared-nozzle slots: 16 for X1/P1, 4 for A1; U1 has 4 independent heads and bed origin 0.5/1 mm.
- Official start/change/end templates are fetched from pinned upstream URLs when selecting a profile and retained in the local project. They are not copied into this repository. Profile source links remain attached. The restricted template parser supports arithmetic, comparisons, conditions, arrays, legacy indexed placeholders, and rejects unknown expressions without eval.
- Snapmaker's complex tool-change statement block is implemented as an explicit adapter for by-layer printing. Its official source stays visible but this field is read-only in the editor; the adapter is in machine-gcode.ts. Review this adapter thoroughly before final completion.
- Bambu print-package export: `.gcode.3mf`, G-code MD5, model ID, filament usage metadata and thumbnails. Reopening print packages is supported. Generic/U1 exports remain plain G-code.

## Evidence

- `npm test`: 29 core tests pass (geometry, project, G-code/material accounting, template interpreter and package integrity).
- Full browser regression suite passed at 17 tests before the additional native package test was added.
- Vendor browser suite subsequently passed both tests: two-color slicing with all six real official profiles, and downloading/reopening a native Bambu package with PNG thumbnails and valid checksum.
- Desktop and phone filament setup/assignment/persistence/color preview tests pass.
- Production TypeScript/Vite build passes; rerun after final formatting or further changes as appropriate.
- No physical printer verification has occurred. Software verification must not be described as physical validation.

## Remaining work for the full goal

1. Preserve 3MF/OBJ multi-part assemblies, relative placement, imported material assignments and colors. `importModels` currently merges imported meshes, and `importFiles` auto-arranges/recolors them. This is a concrete gap, not a future wish-list item.
2. Make assembly-aware transforms, packing, grounding, collision validation and multi-widget grouping consistent. Existing AABB overlap/floating checks reject legitimate interlocking or elevated colored parts.
3. Complete and verify material editing workflows for full multi-color use (including height-based assignments and surface-color workflows where applicable); do not silently treat cosmetic model colors as print assignments. Review painted 3MF data handling explicitly instead of claiming it is supported.
4. Verify dedicated support filament behavior with real support paths and multi-tool jobs. Review per-filament settings/global-settings interactions, physical material limits and cooling.
5. Review purge planning: pairwise flush volumes, tower placement/capacity and build-volume checks, initial nonzero tools, unused slots, and larger AMS configurations. Current uniform purge volume drives both tower area and Bambu station purge, which is conservative but needs refinement.
6. Complete native print metadata/preview fidelity. Imported print packages currently preserve filament colors but do not set a separate preview printer/build volume; inspect differing-printer imports. U1 metadata and firmware macro assumptions need a focused audit against official source.
7. Audit printer-specific start/end/tool-change state restoration (XYZ/E/feed, retract, temperature), physical bounds, firmware variants, and loading/error/offline behavior. Do not infer full machine support just from valid templates or green tests.
8. Update README/help and user-facing labels to reflect final behavior and actual limits. Existing help still contains outdated single-material/AMS limitations.
9. Run relevant core/browser checks plus a production build under `/webslicer/`, verify desktop/phone renderings, then commit/push to `joshstovall/webslicer`, wait for GitHub Pages deployment and verify live workflows. Nothing from this goal has been pushed/deployed yet.
10. Only mark the goal complete after auditing all requirements against current code/runtime evidence.

## Research sources

- Bambu Studio revision `79df7ae309be398ed30c9f397c13c9911c2edc57`, `resources/profiles/BBL/machine/`.
- Snapmaker OrcaSlicer revision `89311782298309040ee28b9a183f33f0f5477b15`, `resources/profiles/Snapmaker/machine/`.
- GridSpace source revision `d138275bbe9d4e4030d8cb8b2dcf66607da9295a`; research copies in `/tmp/stratum-research`. Kiri's sample U1 device contains Bambu-style commands and must not be used as an authoritative U1 machine profile.
- Research JSON/source files are in `/tmp/stratum-research`; vendored engine remains version 4.7.3. Preserve hashes in `vendor-manifest.json` whenever runtime bundles change.
