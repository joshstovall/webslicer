# Regional print speed and extrusion flow

Open **Object modifiers**, add a primitive or imported closed volume, and select **Print speed and flow**. Purple volumes affect model walls, skins, thin fill and sparse infill. Enable the speed and/or extrusion-flow override and set its multiplier from 10–300%. A value of 100% retains the base value. For example, speed 50% and flow 120% halve the planned speed and increase extrusion per millimeter by 20% inside the volume.

Overrides compose with the existing feature, first-layer and spool settings. Later volumes win independently for each enabled setting: a speed-only volume does not reset an earlier flow override. Disabling an override restores the preceding volume or base setting. Changing the volume's effect retains its values but applies only the selected effect. Travel, retraction, supports, adhesion, purge towers and station flushing retain their own settings.

The editor uses the same local positions, rotations, nonuniform scales and imported-volume workflow as infill modifiers. Modifiers follow their owning part and linked material regions. Hidden owners and disabled volumes do not participate. Unrelated objects retain their own settings even if geometries overlap; the ordinary plate collision checks still apply in the UI. Undo/redo, recovery, portable projects and material-preserving geometry edits retain the settings and volume placement. Spiral vase mode remains incompatible with modifiers.

## Engine integration

The original Stratum helper runs in the slicing worker after native path preparation, before bridge classification and G-code export. It looks up each planned move's source widget and physical layer, then slices that owner's modifier volumes at the matching model sampling plane. Fixed, adaptive and manually specified layer heights use the same physical-top lookup; raft offsets are removed through the owning widget's layer mapping.

For model extrusion, intersections with polygon boundaries split moves into intervals. Point containment handles holes and nested islands. Each interval receives the last applicable speed and flow multipliers. Adjacent intervals with identical settings are merged; neutral overrides do not add subdivisions. The original endpoint, tool and object identity are preserved. Fan/type changes precede the first interval and retraction follows the last, avoiding extra retractions at modifier boundaries. The adapter does not add walls or alter the underlying fill pattern.

Native feature speeds may already have been limited during planning. Regional speed multiplies that planned speed. Final spool-specific volumetric limiting and whole-layer cooling then run on the modified G-code, so an increased speed or flow request can result in a lower actual feed rate. Preview speed, consumption, cost and motion estimates are computed from the resulting G-code. As elsewhere, motion estimates exclude acceleration and heating.

Masks are cached only for the current layer. Polygon/ring bounds skip impossible intersections, and weakly held geometry caches are released with their cross-sections. The adapter permits at most two million additional path intervals before failing with a detail-reduction message. Existing 32-volume/500,000-triangle per-owner limits still apply. Surface classification follows the native layer sampling and exported coordinate precision; very small features can vanish. The broader large-model/mobile performance audit remains unfinished.

## Raft footprint repair

An elevated supported model exposed an existing native raft failure: the engine collected only model top polygons from the first slice, yielding an empty footprint even when supports reached the bed. Raft/skirt footprints now include first-slice support polygons and union them with model footprints. A requested raft with no base contact reports a useful error and releases its workers. This does not prove that user-selected support contacts are physically sufficient.

## Verification and remaining scope

Core tests check exact boundaries, independent priority, holes/islands, collinear/tangent edges, neutral settings, event placement, validation and geometry-edit preservation. Browser tests independently integrate exported extrusion and feed rates across a region, checking 150% flow/50% speed, unchanged outside paths and the final volumetric limit under fixed/adaptive/manual schedules. Other cases exercise a rotated nonuniform torus across linked materials, unrelated-object isolation, raft offsets, unchanged support/purge output, and empty-raft error cleanup. Desktop/phone workflows edit, undo, recover, save and export real regional settings.

This adds regional speed and flow; regional wall counts are described in `wall-modifiers.md`. Regional top/bottom overrides are described in `skin-modifiers.md`. Direct volume manipulation is described in `modifier-handles.md`. Branching trees and the other broader slicer requirements remain active. No physical printer validation has occurred.
