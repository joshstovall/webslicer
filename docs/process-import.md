# Orca/Bambu 3MF process settings

Open a model 3MF with `Metadata/project_settings.config` to review supported process settings before adding its geometry. The dialog shows current and proposed values, with individual checkboxes, **Models only**, **Import selected settings**, and **Cancel import**. Settings apply across the project, including models on other plates. The geometry/material binding and chosen settings form one undoable edit. Recovery and portable project files retain the resulting settings through the existing project format.

The selected printer, its G-code templates and existing filament thermal settings remain authoritative. Newly added filament slots use material defaults. This importer never executes embedded G-code or imports it into the machine templates. Source nozzle mismatches are reported. A percentage default line width is converted using an explicit uniform source nozzle diameter; a missing/mixed reference is reported rather than guessed. Selecting a fixed layer height disables an existing adaptive/manual schedule, as stated alongside that choice.

## Supported transfers

- Layer height, first-layer height and default line width.
- Wall count, top/bottom layer counts, infill density/direction/overlap, and supported pattern families: gyroid, grid, cubic, honeycomb, triangles and rectilinear/line.
- Inner/outer or outer/inner wall order; nearest or random seams; thin-wall and spiral-vase flags.
- Outer-wall and travel speeds. First-layer wall/infill speeds transfer to the common first-layer speed only when both are explicit and equal. General print speed transfers only when explicit inner-wall, sparse-infill, solid-infill and top-surface speeds agree. Different regional or per-tool values are listed as unsupported.
- Disabled, automatic or enforced-only normal/tree support modes; XY separation; top/bottom interface counts, including resolving the source bottom count `-1` from an explicit valid source top count. Overhang thresholds convert from Orca's angle above horizontal to the native threshold from vertical (`90 - source`). Zero/automatic overlap thresholds are not approximated.
- Supported exclusive outer brim, skirt or no adhesion when brim type, skirt loops and raft layers are all explicit; brim width/gap and skirt distance. Automatic/inner/ear/painted brims, combined skirt+brim and nonzero raft counts are reported rather than replaced with a different strategy.

Numeric values may be numbers, canonical numeric strings, or uniform tool arrays. Percent fields retain their intended units. Automatic, invalid, out-of-range and fractional integer values are not clamped or silently substituted. Missing fields leave the current setting unchanged. Pattern names select Stratum's algorithm family; this is not a promise of identical Orca toolpaths.

## Transfer report and limits

**Not transferred** lists unsupported settings and scope warnings. **Download transfer report** saves the proposed patch for each supported entry, chosen entries, skipped fields/reasons and warnings as JSON. Long individual source values are abbreviated; the report is a compatibility report, not a complete copy of the source archive. Large diagnostic groups show the first 100 entries on screen; the downloaded report retains the complete bounded diagnostic list.

Global options never override scoped object/part options by pretending those overrides were imported. Per-object process metadata, imported non-printable modifiers, support/seam paint, variable layer profiles and layer-range configuration remain unsupported. Their detected presence is reported. Preset inheritance is not resolved or fetched. Shell thickness constraints, feature-specific widths, most advanced infill/support options, thermal/firmware settings, acceleration/jerk and separate regional speeds remain outside this transfer. Supported filament palette data continues through the existing material importer.

Malformed project JSON, non-object documents, more than 2,000 settings, or process metadata above 4 MiB leave model geometry available with a diagnostic. Normal expanded geometry retains its existing 200 MiB cap. Per-object metadata diagnostics are bounded to 1,000 entries. Print-ready `.gcode.3mf` packages continue to open in toolpath preview; this transfer dialog is for model projects.

This implementation was independently written from the serialized option names and units in [OrcaSlicer PrintConfig.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/82aee1abdd5c475cff4e3adcb9d8d56078df2c10/src/libslic3r/PrintConfig.cpp) and archive member names in [bbs_3mf.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/82aee1abdd5c475cff4e3adcb9d8d56078df2c10/src/libslic3r/Format/bbs_3mf.cpp). No upstream implementation source is bundled. See `multicolor-progress.md` for verification and release evidence. Full Orca project fidelity and physical printer validation remain unfinished.
