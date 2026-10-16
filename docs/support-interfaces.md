# Support contact interfaces

In **Support & adhesion**, enable normal or branching tree supports and set **Top interface layers** and/or **Bottom interface layers**. Both automatic and enforced-only supports accept these controls. Zero disables that interface, preserving the previous support behavior. Existing projects and presets default to zero layers, 80% interface density and 0° interface angle.

- **Top interface layers** (0–10 whole layers) densifies support beneath the model.
- **Bottom interface layers** (0–10 whole layers) densifies support above model surfaces on which it lands. It does not densify ordinary bed roots.
- **Interface density** (5–100%) controls contact fill independently of **Support body density**. Both interfaces share this setting.
- **Interface angle** (0–180°) selects the base line direction. Successive physical layers alternate by 90°, including variable-height layers.

Counts refer to actual printed support layers, not a fixed millimeter thickness. Fixed, adaptive and manually edited schedules all use the same plate-wide grid. Interfaces retain the engine's existing contact clearance (one neighboring empty layer when its gap flag is enabled), XY separation, support filament, outer boundaries and holes. A short support region can be entirely interface; overlapping top and bottom regions are filled once.

The original MIT implementation in `public/engine/support-interfaces.js` runs after normal support clipping and optional tree generation, before native support-tool extraction, raft footprints, purge planning and export. It unions model and support sections in plate coordinates, finds contact footprints across the native gap, and propagates them through the requested number of adjacent support sections. Projection stops at missing sections or empty intersections. It does not mistake exposed branch sides for model contacts. Contact masks remain restricted to the supports already selected by automatic overhangs, painted surfaces and enforcer/blocker volumes.

Body and interface fill occupy disjoint polygon regions. Each uses native line filling and its normal inset. Region boundaries do not create extra perimeter walls; the original support outline is emitted once. Normal support columns from multiple parts are consolidated across the plate when this pass is active, so shared regions also appear once. Each global section is returned to a real slice in that widget's local coordinates, retaining the configured support extruder and actual layer height.

The pass yields between groups of layers for cancellation, and limits contact projection to 250,000 steps. Cancellation or a planning failure removes the job's frame/workers and retains the project for retry. Invalid layer counts, density and angles are rejected by project import and preflight. The engine pass independently checks layer counts and density. Optional fields preserve legacy project validation and are retained in recovery, portable projects and print presets.

## Verification and remaining work

Tests compare real exports with interfaces off, top-only, bottom-only and combined on fixed/adaptive/manual grids for normal and tree supports. They inspect changed layer counts, path density, angle, support-tool assignments, duplicate paths and model clearance. Additional tests cover overlapping interfaces, 100% fill with alternating 0/90° lines, cancellation/retry, enforced contacts, paint blockers, hollow-part rafts and Bambu keep-out space. Responsive workflows edit, recover, download and slice interface settings on desktop, tablet and phone. See `multicolor-progress.md` for completed test runs and publication state.

This adds the core interface controls. Separately chosen interface filament and speed, interface pattern choices, independently adjustable top/bottom Z gaps, independent support layer heights and additional tree strategies remain future work. Belt printers are explicitly rejected for this pass. Support interfaces remain in the Support preview category. No physical print-quality or removability validation has occurred.
