# Branching tree supports

Choose **Automatic · branching trees** or **Enforced only · branching trees** in Support & adhesion or the support-paint editor. Automatic mode uses the normal overhang detector plus painted/volume-selected contacts. Enforced-only mode uses selected contacts without adding automatic contacts. Blockers remove contact initiation areas; they do not sever branches underneath higher unblocked contacts.

## Controls

- **Maximum branch angle** is measured from vertical, from 5° to 60° (default 40°). The planner bounds the lateral reach of each descending section using actual printed layer tops, including adaptive and manual schedules.
- **Branch spacing** controls contact sampling, from 1 to 10 mm (default 3 mm). Smaller spacing creates more potential tips and increases planning work.
- **Tip diameter** sets the minimum tip/stem diameter, defaulting to 1.6 mm or two extrusion widths, whichever is larger. Contact caps can be wider to cover their selected contact patch, then taper toward this diameter.
- **Maximum trunk diameter** limits merged trunks, default 8 mm. It must be at least the tip diameter. Broad contact caps can exceed it while tapering.
- Existing support body density, XY separation, support filament and adhesion settings apply. Separate top/bottom contact interface layers, density and angle are available; see `support-interfaces.md`. An independent support layer grid, build-plate-only tree mode and organic/tree style selector remain unfinished.

The controls use optional project fields, so existing projects and presets without them retain valid defaults. New fields survive recovery and portable project/preset import and export. Invalid dimensions are rejected before slicing. A legacy `tree` project now generates branching geometry; older releases used normal supports for that flag.

## Geometry and integration

The original MIT planner in `public/engine/tree-supports.js` uses the pinned engine's polygon operations. It runs once for the whole plate, after contact detection and before toolpath preparation. All material parts share one physical layer grid. Contact masks remain scoped to their owners, while collision geometry includes every part on the plate.

The planner tiles selected contact roofs, finds interior points even in concave or hollow sections, and grows connected sections downward. Tips taper and nearby branches converge into bounded trunks. Lookahead considers both routes around neighboring solids and landings on their top surfaces. A descent is accepted only if the entire upper section fits within the angle-limited reach of the lower section plus a real model landing. The algorithm rejects an impossible continuation instead of silently replacing it with normal supports or dropping the branch.

Per-layer tree geometry is unioned globally and assigned to one physical slice, preventing duplicate support walls and fill where trees from different parts meet. Native support filling, dedicated support tools, raft/skirt footprints, purge placement and G-code generation run afterward. Branch sections are clipped to the bed and printer keep-out regions. Shared trees do not currently preserve per-object cancellation ownership.

Work is bounded to 2,048 active branches, 50,000 sampled contact cells, 250,000 branch steps and two million routing checks. The obstacle cache is bounded to 2,048 entries. Planning yields between groups of layers; cancellation removes the job's isolated engine and workers. Limit or geometry errors retain the project and allow a subsequent attempt with changed spacing/angle, normal supports or a split plate. The planner is local and greedy; it does not guarantee finding every geometrically possible route through complex narrow passages.

## Verification and remaining scope

Focused tests cover merging canopy branches, exported section slope limits, neighboring solids and model-top landings, fixed/adaptive/manual multi-material grids, dedicated support filament, duplicate extrusion, automatic/volume/paint contacts, paint blockers, hollow geometry, raft footprints, cancellation/retry and printer keep-out space. Responsive workflows exercise selection, numeric controls, recovery, portable projects and actual G-code exports on desktop, tablet and phone. See the current checkpoint in `multicolor-progress.md` for verified results and publication state.

This is an original branching-support implementation, not a port of OrcaSlicer's organic/tree algorithms. Further interface controls (separate tool/speed, patterns and Z gaps), additional tree strategies, large-model performance and physical print quality still need work. No physical Bambu/U1 print validation has occurred. The broader slicer goal also retains import/texture/process fidelity, further orientation controls and support/tower envelopes, mixed-diameter U1 heads, additional feed/firmware/cooling/connectivity controls, mobile/offline reliability and the final requirement audit.
