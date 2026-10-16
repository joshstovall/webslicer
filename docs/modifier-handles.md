# Direct modifier manipulation

Open **Object modifiers**, choose a volume, and select **Move**, **Rotate**, or **Scale**. Drag the colored axis handles in the 3D view with a mouse, pen, or one finger. Move also has plane handles; scale includes a central uniform handle. Tap or click another visible volume belonging to this part to select it. Disabled volumes remain available in the list but have no viewport handles.

**Hide modifier settings** leaves the volume selector, transform modes and Apply/Cancel available while making more room for the model on phones. The chosen camera view is preserved when collapsing or expanding. Numeric position, rotation and scale fields remain available for exact values. Background project actions are unavailable while the modifier draft is open; the canvas remains interactive for orbit, zoom and direct manipulation.

Moves use world axes. Rotation and scale use the volume's axes. The editor converts the handle pose back into the owning part's local coordinates. A root-level handle avoids decomposing the shear that a rotated modifier inherits from a nonuniformly scaled parent; the actual volume continues to render with the complete parent × modifier matrix. Scaling cannot produce a zero or negative scale. This does not add arbitrary shear editing or mirroring.

Changes update the draft on pointer release. A native pointer cancellation or window blur restores the active drag; a second touch cancels an active modifier drag. Closing the editor releases its handle and camera lock. **Apply modifiers** commits all draft changes as one undo step. **Cancel** discards them. Applied transforms survive redo, recovery and portable project download, and the same local coordinates feed the existing slicing pipeline.

Verification uses actual visible handle pixels and real browser mouse/touch events, rather than invoking Three control methods. Desktop, tablet and phone tests cover movement, rotation, scale, touch cancellation, parent transform preservation, undo/redo, discarded edits, recovery, direct selection, disabled/deleted volumes and real exported infill outside a transformed zero-density region. Core checks compare full world matrices under a rotated nonuniform parent and verify world translations and local scale/rotation behavior.

This feature does not implement branching tree supports, complete Orca project import, STEP, shape-aware packing, additional printer integrations, or physical-printer validation. Those remain part of the broader slicer work.
