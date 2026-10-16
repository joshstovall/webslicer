# Shape-aware arrangement and collision checking

**Arrange plate** opens a Mantine dialog with part spacing, bed edge clearance and optional 90° rotations. The explicit arrange command uses projected model outlines, including concavities and through-openings. A small object can fit inside a frame even when their bounding boxes overlap. Parts in an assembly move and rotate together, including hidden members; visible parts determine the footprint and grounding. Hidden-only objects are unchanged. Different plates are packed independently.

The arrangement job owns a disposable worker and changes the project only after a complete successful result. It is one undoable edit. Cancellation, errors and a three-minute timeout terminate the worker and retain the prior project. Cancel is available in the dialog and busy footer. Model-local vertices, colors, surface/support paint, modifier geometry and scales remain intact; a common world Z rotation and translation update the parts' transforms.

## Outline search

The worker uses the already pinned Manifold 3.5.4 library. Closed meshes project through its native solid projection. Open meshes can still contribute their positive triangle projections; triangles are unioned in batches without filling convex hulls. Degenerate XY-only outlines require reorientation or repair. Model vertices are transformed to world space; mirrored transforms have their winding corrected before solid construction.

Parts in a group are unioned for placement. Footprints are offset by half the selected spacing using miter joins. Reserved areas account for both part spacing and edge/adhesion clearance. Bed edges reserve at least the current brim/skirt requirement. Objects are considered in descending footprint bounding-area order; the search considers original and optionally quarter-turn orientations, bed/obstacle bounds and sampled contour vertex alignments. Candidates are tested by polygon intersection. A final common centering translation is accepted only when all padded outlines still fit and avoid reserved areas.

The candidate search is heuristic, not a proof of optimal packing or impossibility. It samples up to roughly 24 vertices per contour for candidate generation while testing the complete projected contours for collisions. Limits are 200 parts, two million source triangles, 256 sampled contour vertices per footprint, 50,000 candidates per orientation and one million polygon intersection checks. It reports limits and failed searches explicitly. Native work can allocate before geometry limits establish a practical memory bound; real mobile performance still depends on model complexity.

The existing quick layout after import, starter creation or cutting remains a conservative rectangular layout. Use **Arrange plate** for outline nesting and rotation. Shape-aware automatic import/cut placement, support-aware orientation, and outline-aware purge-tower placement remain in the broader goal. Arrange considers model footprints, not future support envelopes, printer-head clearance for sequential printing, or a fixed manual purge tower. The slicing pipeline continues to validate generated supports/towers and physical output bounds.

## Before slicing

Fast preflight still checks printer dimensions, adhesion margins and grounding. Potential model/model or reserved-area conflicts are resolved in a cancellable geometry worker before material preparation and engine startup:

- Disjoint model projections prove separation, including through-holes.
- Where XY projections and XYZ boxes overlap, closed solids are intersected. Positive volume greater than `1e-6 mm³` is an overlap. Merely touching surfaces are permitted. Full containment is detected; a cube below an arch can pass even when projected outlines overlap.
- Parts in the same linked assembly retain the established material-overlap precedence workflow. Different plate IDs do not collide.
- Open/invalid meshes with intersecting projections cannot establish solid separation. They produce an actionable error to repair the meshes or separate the footprints instead of silently being accepted.
- Reserved areas use the actual projected geometry with adhesion clearance. Generated extrusion checks remain authoritative for support/adhesion/tower paths that may extend beyond the model silhouette.

`validatePlate` retains its conservative default for existing utility callers. The application defers its box-based geometry checks to the exact worker stage; the slicing API also invokes that stage so direct API users receive the same overlap checks.

## Verification

Core tests use real Manifold geometry: through-hole nesting and independent clearance assertions, interlocking L outlines, full containment, contacting solids, a cube below an arch, open-surface diagnostics, mirrored rotated assemblies, separate plates, hidden objects, Bambu exclusions, adhesion margins, search failure and input limits. Browser workflows cover responsive controls, project undo/recovery and real G-code inspection, cancellation/retry and existing assembly/workspace/printer-exclusion behavior. Publication evidence is recorded in the progress ledger.
