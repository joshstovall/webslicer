# Support surface painting

Select a model and choose **Paint supports**. The camera looks at its underside and the bed is hidden while painting. Choose **Enforce · green**, **Block · red**, or **Restore automatic**, then use the round brush, flat-face tool, or replace-support-state tool. Drag with one finger to paint; use two fingers to orbit. **Hide controls** leaves the phone canvas accessible while retaining the Done button. Bottom, top, front, right, isometric and fit views are available.

Choose Automatic for ordinary normal supports with painted overrides, or Enforced only for selected contacts. Enforcers require enabled support generation. Restore automatic removes the painted override, restoring the base generation and any volume modifiers; it does not delete support volumes. Clear paint affects the current paint target only. Filament colors and their depth are independent of support selections. Undo/redo, recovery and portable projects retain both.

## Contact semantics

Paint selects surfaces where supports begin. Only downward-facing patches participate after the model's world transform. Upward and vertical patches are retained for future rotation but do not initiate supports in their current orientation. The worker clips each triangle to the interval between neighboring model sampling planes before projecting it into XY. This prevents sloped painted triangles from casting their whole shadow at every height. Micron quantization follows the native model geometry.

Volume modifiers apply first, then painted enforcers, then painted blockers. Enforcers are clipped to new underside areas; blockers remove contact seeds. If different assembly parts have overlapping paint, blockers win. Hidden owners do not contribute. A part's paint reaches its linked material regions, not unrelated objects. Other printable geometry still clips support contact, projection and clearance. Support density, gap, XY separation, adhesion and dedicated filament continue through the normal engine pipeline.

Blocking contacts does not cut existing support columns from higher, unblocked surfaces. Painting a top face red therefore does not sever a column passing above it. Normal support geometry is produced; branching tree supports remain unfinished.

## Geometry edits and precision

Support selections use their own surface tessellation while the original closed mesh and filament paint remain intact. Assembly transforms, duplication and rebasing carry this surface. Cuts, disconnected splits and height-color edits transfer surviving coplanar patches to the new mesh in the material worker. New cut caps stay automatic and deleted surfaces lose their paint. Visible and hidden inputs are transferred separately. A no-op split keeps the original editable model.

Surface transfer matches aligned normals and plane distance within 0.0003 mm, using a spatial tree for candidate lookup. Brush boundaries are triangle approximations with finer subdivision than material painting. Very small features can disappear at the layer sampling scale. Each painted surface is limited to two million triangles; malformed states, mismatched lengths and nonfinite coordinates are rejected before use. Complex coplanar paint and geometry edits can still consume substantial memory, and the broader large-model/mobile performance audit remains open.

Supported elevated objects can now pass plate preflight when supports are enabled; this permits intentional support beneath a floating model. Build bounds, reserved areas and collision checks still apply. This does not prove that a user's selected contacts physically support the entire object. Spiral vase mode rejects support paint.

## Verification

Core checks cover independent color/support state, portable validation, assembly ownership, transformed cuts, new caps, hidden sources, and disconnected splits. Browser tests exercise actual exported contacts on horizontal and sloped surfaces, model-plane rounding, automatic/manual modes, block/erase behavior, dedicated support filament, volume overrides, worker cuts and adaptive/manual layer schedules. Desktop and phone UI checks paint, undo/redo, reload, download a project and export G-code while retaining pre-existing filament colors. These checks establish software behavior, not physical printer performance.
