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

## Earlier evidence (before surface painting and material edits)

- `npm test`: 37 core tests pass (geometry/assemblies/height bands, project, G-code/material accounting, directional purge values, template interpreter and package integrity).
- Full browser suite: 23 of 24 passed before the high-slot purge placement fix; the new high-slot test exposed an actual defect. After the fix all 12 affected engine/vendor/height/assembly tests passed. The other 12 tests had passed in that full run.
- Vendor browser suite subsequently passed both tests: two-color slicing with all six real official profiles, and downloading/reopening a native Bambu package with PNG thumbnails and valid checksum.
- Desktop and phone filament setup/assignment/persistence/color preview tests pass.
- Production TypeScript/Vite build passes; rerun after final formatting or further changes as appropriate.
- No physical printer verification has occurred. Software verification must not be described as physical validation.

## Remaining work for the full goal

1. Preserve 3MF/OBJ multi-part assemblies, relative placement, imported material assignments and colors. Component import, painted triangle trees, and core vertex/triangle material regions are implemented and tested. Further vendor metadata and OBJ material-group coverage remains required.
2. Make assembly-aware transforms, packing, grounding, collision validation and multi-widget grouping consistent. Grouped transforms, packing, and actual solid-overlap resolution are implemented and tested. Explicit assembly grouping/ungrouping and overlap-priority editing controls still need completion.
3. Complete and verify material editing workflows for full multi-color use. Surface paint, painted 3MF segmentation, and height assignments generate real material toolpaths. Cuts, splits, and height edits now preserve painted material volumes. Continue the complete editing and import audit; do not equate these tested operations with all requested multi-color support.
4. Dedicated support filament now passes real normal/tree support path tests. Continue reviewing per-filament/global-settings interactions, physical material limits and cooling.
5. Review purge planning: directional overrides, unused slots, initial nonzero tools and AMS slots 8/16 now pass tests; the block index placement defect is fixed. Crowded-plate placement, exact quantities/capacity and pair-specific tower extrusion still need refinement.
6. Native Bambu package previews now use imported printer dimensions and preserve original archive downloads. External archive/multi-plate metadata handling and U1 firmware macro assumptions still need a focused audit.
7. Audit printer-specific start/end/tool-change state restoration (XYZ/E/feed, retract, temperature), physical bounds, firmware variants, and loading/error/offline behavior. Do not infer full machine support just from valid templates or green tests.
8. README/help now describe current multi-tool behavior and unfinished features. Keep them aligned as the remaining features are implemented.
9. Run relevant core/browser checks plus a production build under `/webslicer/`, verify desktop/phone renderings, then commit/push to `joshstovall/webslicer`, wait for GitHub Pages deployment and verify live workflows. Commit `adb585a` was published successfully and four live production checks passed. Further changes require their own verified deployment.
10. Only mark the goal complete after auditing all requirements against current code/runtime evidence.

## Research sources

- Bambu Studio revision `79df7ae309be398ed30c9f397c13c9911c2edc57`, `resources/profiles/BBL/machine/`.
- Snapmaker OrcaSlicer revision `89311782298309040ee28b9a183f33f0f5477b15`, `resources/profiles/Snapmaker/machine/`.
- GridSpace source revision `d138275bbe9d4e4030d8cb8b2dcf66607da9295a`; research copies in `/tmp/stratum-research`. Kiri's sample U1 device contains Bambu-style commands and must not be used as an authoritative U1 machine profile.
- Research JSON/source files are in `/tmp/stratum-research`; vendored engine remains version 4.7.3. Preserve hashes in `vendor-manifest.json` whenever runtime bundles change.

## Current continuation: assemblies, height colors, purge planning

This section supersedes the older status of items 1–6 above; their remaining scope is still part of the goal.

- Replaced merged 3MF imports with an assembly-aware loader. Production-extension component paths, path-scoped object IDs, unit conversion, mirrored winding, per-part transforms, Bambu part extruder metadata, and core material/color palettes are retained. Multipart OBJ meshes remain separate. Imported palette colors map into existing project slots without overwriting spools.
- Assemblies share a pivot and transform/duplicate/pack/ground together. The inspector can toggle editing a single part. Whole-assembly plate moves and fit-to-bed use group bounds. The viewport applies the selected transform delta to sibling meshes while dragging. Tests cover relative transforms, rotations/nonuniform scale, duplication, imported placement and recovery. Actual overlapping solids are NOT yet resolved; same-assembly AABB collision exemptions permit legitimate interlocks but do not prove non-overlap.
- Added Color by height with repeatable bands. Closed cut halves stay at their original coordinates, retain distinct filament IDs, and share an assembly. Desktop/phone browser tests save/reopen three bands and verify actual slice paths use tools 0, 1, 2 in the corresponding height ranges.
- Dedicated support filament tests verify both normal/tree supports use tool 2, model paths use tool 1, and unused tool 0 is absent from filament usage. Engine-generated support object comments may contain `undefined`; executable commands do not.
- Directional purge overrides are editable with from/to selectors on phones and desktops, validated and persisted. Bambu station commands use the directional volume. The tower conservatively reserves the maximum needed by active filaments; unused slots do not enlarge it. The tower itself is not yet optimized to each pair's exact volume.
- Found and fixed a Kiri worker bug: purge-block XY offsets used the extruder ID, moving high-numbered AMS blocks off the bed. Placement now uses consecutive block indices while retaining actual tool IDs. NOTICE and vendor-manifest checksum updated. A regression slices X1C slots 8/16 and all four U1 heads; it failed before the fix and passed after.
- Imported Bambu packages detect their printer for preview build-volume/filament diameter, retain filament metadata, and download the original archive unchanged. A browser regression reopens a P1S archive while a different printer is active and verifies byte-for-byte download preservation.
- README/help reflect the current multi-tool features and remaining limits.

### Still required after this continuation

1. Surface paint editing and actual volumetric material segmentation; painted 3MF tree decoding. `faceTools` currently persists core triangle colors but slicing/cutting/splitting explicitly refuses those assignments. Assigning a part filament clears them. This is a temporary honest limitation, not completion of surface color support.
2. Resolve actual intersecting material volumes in assemblies without double extrusion; further import tests for vendor project metadata and OBJ material groups, with no silent color loss. Core vertex-interpolated colors currently use the first vertex with a warning.
3. Continue purge-tower placement/capacity work for crowded plates and validate produced purge quantities. Directional overrides and high slot IDs are now tested, but automatic tower relocation and exact pair-specific tower extrusion remain unfinished.
4. Audit U1 firmware macros and all printer-specific XYZ/E/feed/retraction/temperature restoration, physical limits and offline/error handling. Existing tests prove software compilation and path/tool assignments, not physical printer compatibility.
5. Finish native metadata fidelity for external archives and U1, including multi-plate package selection (the reader currently opens the first G-code entry).
6. Final production-prefix/browser/rendering checks and deployment of the completed goal. Multi-color commits remain local; the live GitHub Pages app still reflects the original single-tool release.
7. Completion remains unproven. Audit the entire original goal and the original numbered requirements before marking it complete.

### Research for the next implementation step

- Orca TriangleSelector serialization source was fetched to `/tmp/stratum-research/TriangleSelector.cpp` from `https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/main/src/libslic3r/TriangleSelector.cpp`. Its nibble tree decoder and midpoint split ordering describe the painted-triangle format; do not silently ignore it or copy AGPL code without handling licensing.
- Official Manifold WASM APIs: https://manifoldcad.org/docs/jsapi/classes/manifold.Mesh.html and https://manifoldcad.org/docs/jsapi/classes/manifold.Manifold.html . Closed boolean material regions could provide actual printable volumes for painted shells and intersecting assembly parts. The npm package query returned `manifold-3d` 3.5.4, Apache-2.0; it has NOT been installed yet. The existing Kiri internal Manifold WASM is not exposed as an app geometry API.

### Final evidence for this checkpoint

- 37 core tests pass.
- All 12 affected slicing/assembly/height/vendor browser regressions pass after the purge block fix.
- The production build succeeds with `VITE_BASE_PATH=/webslicer/`. Three production browser checks pass: desktop transforms/undo/redo, phone controls, and a complete multi-filament UI-to-G-code export using both tools and the purge tower. A separate bounded single-tool slicing check also passed under that prefix.
- The production multi-filament test exposed Escape from the filament dialog also deselecting the model; global shortcuts now ignore events originating in a dialog. Its regression passes without reselecting the model as a workaround.
- Vendor hashes match the manifest; `git diff --check` passes.
- These results establish this checkpoint, not completion of the full goal. No goal update to complete and no Pages deployment has occurred.

## Surface color and overlap implementation checkpoint

This continuation replaces the earlier surface-color and overlap limitations with working implementations, while retaining the rest of the original goal.

- Added locked `manifold-3d` 3.5.4, Apache-2.0. Its app worker and WASM are bundled locally, separate from Kiri's internal Manifold. `prepareMaterials` bypasses boolean processing for unpainted non-overlapping jobs, and terminates its worker on completion, error, timeout or cancellation.
- `material-regions.ts` converts painted facets into inward material masks, intersects them with the closed source mesh, and subtracts them from the base material. Independent closed solids retain the original total volume. Within an assembly, later source parts take priority in actual overlaps; same-filament regions are unioned to avoid duplicate extrusion.
- Painted surface tessellation stays separate from the watertight source geometry. A round brush subdivides only affected areas. Flat-face and replace-color operations, editable world-space color depth, filament selection, camera views and clear paint are available in a Mantine panel. Each drag is one undo entry. Paint persists through project serialization/recovery and assembly transforms. Painting on a phone frames the model below the control panel; two-finger camera gestures remain available.
- 3MF painted-facet trees now decode right-to-left hexadecimal leaf states, extended slots and one/two/three-edge splits. Decoded patches preserve the original source triangle order under mirrored transforms. Core vertex-interpolated colors become discrete nearest-vertex material regions rather than dropping the second/third vertex color. This decoder is an independent format implementation; Orca source is not bundled.
- Added tests for volume conservation, real brush-mask volumes, overlap precedence, malformed paint data, closed-mesh errors, paint project persistence/transforms and color replacement. Browser tests exercise real converted extrusion paths, imported painted 3MF, worker cancellation/retry and surface painting/recovery/export at desktop and phone dimensions.
- Actual tested development failure: Vite initially optimized the newly loaded worker dependency during slicing and reloaded the page. `optimizeDeps.include` now includes Manifold up front so the first job is not interrupted.
- See `docs/material-regions.md` for source references and detailed behavior.

### Remaining interaction and validation work

- Cutting/splitting/height-editing an already painted surface currently asks to clear paint first. These need to operate on the prepared material regions and preserve their assignments. Do not treat that temporary restriction as the full requested editing scope being satisfied.
- Add or complete remaining coverage for imported OBJ material groups and assembly editing order/grouping controls. The material overlap rule is documented but reordering/grouping needs a usable workflow.
- Continue the earlier firmware state, physical-material limit, purge quantity/placement/capacity, native multi-plate metadata and offline/profile error audits. None of those requirements are removed by the new paint work.
- Final deployment remains pending. Physical printer verification has not occurred, and software tests must not be described as physical verification.

## Requested GitHub Pages release

The user subsequently requested publication to `joshstovall` and GitHub Pages. This release publishes the current implementation while the remaining full multi-color goal stays active; the earlier statements that these changes are local-only describe prior checkpoints.

- All 47 core tests and all 32 browser integration tests pass.
- The production build succeeds with `VITE_BASE_PATH=/webslicer/`. Four additional production checks pass: phone and tablet controls, multi-filament G-code export, and surface painting through the bundled material worker/WASM to colored G-code layers.
- Phone paint controls were visually inspected; field values and the model are visible below the panel.
- Vendored engine checksums match `vendor-manifest.json`; `git diff --check` passes.
- The existing Actions workflow deploys pushes to `main` to https://joshstovall.github.io/webslicer/. Deployment success must be confirmed from the corresponding Actions run and live site.
- Publication does not resolve the remaining editing, firmware, purge-planning, metadata or physical-printer validation work listed above.


## Painted model editing checkpoint

This continuation removes the temporary restriction on cutting, splitting, and height-editing painted surfaces.

- Painted edits run in the local material worker with progress/cancellation. They replace the source only after successful completion and preserve one-step undo/redo and project recovery.
- Cuts preserve and cap each material region, retain whole-object/selected-part scope, group each side, and flip/ground all its colors together. Height assignments retain lower colors and merge the newly assigned upper material. Splitting groups by actual physical connectivity so touching colors stay in one object.
- Hollow solids retain cavities. Solid islands in cavities remain separate objects. Hidden geometry is retained without subtracting from visible parts. Project part/mesh limits are checked before committing changes.
- A transformed repeated-cut regression exposed material volume loss from Float32 Boolean slivers. Keeping original Manifold topology through each edit and simplifying exported geometry within 0.0001 mm fixes it; volume tests cover nonuniform scaling, rotations, hidden parts, and repeated cuts.
- Mobile undo/redo uses the project menu. Closing the mobile drawer no longer also invokes the global deselect shortcut.
- Current evidence: all 55 core tests and 23 affected browser checks pass. After the final memory cleanup, the cut/split and cancellation browser checks passed again. Five checks against the production build under `/webslicer/` pass, including phone/tablet controls, multi-tool export, surface painting and cutting a painted model before exporting its colored toolpaths. TypeScript/Vite build and `git diff --check` pass. Publication must be confirmed against the matching Actions run and live site.
- Remaining full-goal work is unchanged: OBJ/vendor import fidelity; grouping/priority controls; filament physical limits/cooling; purge capacity, placement and quantity; native multi-plate archives; and a focused firmware/state/offline audit for the Bambu and U1 profiles. No physical printer verification has occurred.


## Machine-state and offline-profile checkpoint

- Previous painted-material release `a0015fd` deployed successfully in GitHub Actions run `38842633373`; its live painted-cut/export check passed. This supersedes the pending-publication wording above.
- Fixed Bambu tool-change lift heights: use height reached so far, cap absolute change Z moves at the build height, match the planner's actual pending retraction, and use incoming filament calibration flow.
- U1 changes now account for each independently parked head, implement the pinned machine configuration's 10 mm tool-change retraction contract, and wait for the incoming head's temperature before priming/recovery. Return moves restore clearance, XYZ, feed and extrusion modes/registers.
- Official template sets are persistently cached by printer/firmware/revision. Reloading and selecting a previously used profile works without GitHub connectivity, while preserving editable machine settings. Incomplete template sets are repaired by fetching the full official set.
- Source evidence and implementation bounds are in `docs/machine-state.md`. These changes use the current pinned U1 profile and its native writer contract, not an older cached template. Firmware macro internals and physical prints remain unverified.
- Validation: all 62 core tests pass; 13 affected browser integration tests pass; the production build under `/webslicer/` passes; five production checks cover phone/tablet controls and generic, U1, and Bambu multi-color exports. `git diff --check` passes. Publication must be confirmed against the matching Actions run and live site. The full remaining requirements above retain their original scope.


## Assembly controls checkpoint

- Prior machine-state release `f7c8784` deployed successfully in Actions run `38843934010`; live U1 and Bambu multi-color UI/export checks passed.
- Added Mantine **Manage assembly** controls on desktops and phones: choose parts from the active plate to link, detach the selected part, or separate all parts. Grouping retains source material priority and a shared pivot. Geometry, paint, visibility and filament assignments survive membership changes. Removing parts cleans up singleton groups only in affected assemblies.
- Material priority controls reorder only the selected assembly's positions in the project list. Higher-priority solids own overlaps during material preparation; coplanar viewport drawing and picking follow that priority. All operations use ordinary project history and recovery.
- Regression coverage checks transformed painted geometry, changes between existing groups, unaffected plates, undo/redo, portable project downloads/recovery, and actual colored G-code boundaries after a priority change. All 65 core tests pass. Six existing import/material browser regressions and both desktop/phone surface-paint regressions pass. Four production checks pass under `/webslicer/`: desktop/phone assembly editing through real export, plus phone/tablet controls. The phone assembly dialog was visually inspected. The TypeScript/Vite build and `git diff --check` pass. Publication must be confirmed against the matching Actions run and live site.
- This completes the missing explicit grouping/ungrouping/priority controls in item 2; the broader audit retains its scope. Remaining work includes OBJ/vendor import fidelity, material/cooling limits, purge placement/capacity/exact quantities, external multi-plate archives and U1 metadata, and firmware validation. No physical printer verification has occurred.


## Multi-plate archive checkpoint

- Assembly release `f65b006` deployed successfully in Actions run `38844538817`; its live phone linking/priority/recovery/export check passed.
- External print archives now expose all G-code jobs with numeric plate ordering, names and an Archive plate selector. Only the selected job is decompressed. Empty/oversized jobs remain listed but disabled, and failed selections preserve the previous valid preview. Original downloads remain byte-for-byte identical.
- Plate-specific machine IDs/nozzle diameters and sparse one-based filament IDs override global project metadata for the selected preview. Colors, material types, names and available global material properties are retained. Unknown machines, malformed optional metadata, checksum mismatches and duplicate slice metadata produce explicit warnings. A1 mini/A1 fallback matching is disambiguated.
- Detailed contracts, source references and limits are in `docs/print-packages.md`. Multi-plate selection no longer has the first-G-code-only limitation described in earlier checkpoints.
- Current validation: 73 core tests pass; six affected archive/vendor browser checks pass; six production checks cover desktop/phone multi-plate selection, checksum warnings, cancellation of pending selections and Bambu/U1 exports. The final four archive checks passed again after the last changes. The TypeScript/Vite production build and `git diff --check` pass. Publication must be confirmed against the matching Actions run and live site.
- Remaining full-goal work includes OBJ/vendor model import fidelity, physical material/cooling limits, purge placement/capacity/exact quantities, U1 native job metadata and firmware validation. Vendor-declared time/usage summaries and external arc visualization also retain the documented limitations in the archive fidelity audit. No physical printer validation has occurred.

## OBJ material checkpoint

- Multi-plate release `622f9dd` deployed successfully in Actions run `38845434843`; live phone archive selection and pending-selection cancellation checks passed.
- Import OBJ and MTL files together to preserve per-face material groups, diffuse colors including white, and discrete vertex-color regions. Groups splitting one shell are reunited along unmatched edges; separate closed solids remain linked parts with retained placement. Missing libraries, textures and transparency are reported explicitly. See `docs/obj-materials.md` for supported behavior and limits.
- All 81 core tests pass, including closed-volume preservation, palette boundaries, material persistence and ambiguous libraries. Five affected development browser checks passed. Both desktop and phone OBJ import/recovery/colored G-code export checks pass against the production build under `/webslicer/`. The phone rendering was visually inspected. TypeScript/Vite build and `git diff --check` pass. Publication must be confirmed against the corresponding Actions run and live site.
- Remaining full-goal work retains its scope: further vendor/texture import fidelity, physical material/cooling limits, purge placement/capacity/exact quantities, U1 native metadata, external arc visualization and firmware validation. This checkpoint is not completion of the full multi-color goal. No physical printer verification has occurred.
