# Variable layer heights across materials

Enable **Advanced → Quality → Adaptive layer height** and choose a minimum layer height. The first layer retains its configured height. Subsequent layers share one schedule across the entire plate, including separate objects, linked parts, painted material regions and dedicated support filaments. A detail on one part can therefore change the layer heights on other parts.

The planner collects transformed mesh vertex heights after material preparation, sorts their union and divides feasible intervals into layers between the configured minimum and normal layer height. This automatic mode uses mesh feature heights; it does not claim an angular surface-error optimizer. Manual curves are available separately below. Close features that cannot be separated within the minimum height do not force thinner layers. The final interval is redistributed where possible; if no exact partition exists (for example, equal minimum/maximum heights), the closest legal top is used. As with fixed slicing, sub-layer details and very thin parts may not produce a printable cross-section.

Physical heights use integer microns. Mesh sampling uses the engine's 1 µm midpoint grid, which can differ from the mathematical midpoint by 0.5 µm; physical print tops and extrusion heights are retained separately. Minimum/maximum heights must admit at least one micron-sized increment. The first height rounds to this precision. A schedule exceeding 100,000 layers fails explicitly. There is no per-part layer schedule that can drift away from a neighboring material.

## Manual height curves

Enable **Advanced → Quality → Manual layer heights**, set the minimum and normal layer-height limits, and open **Edit layer curve**. The normal height is the upper bound. Manual and automatic adaptive modes are mutually exclusive. One curve applies to every object, material and support on each plate using the shared process settings; it is not a separate per-object schedule.

Drag control points, tap/click the graph to insert one, or use the control-point selector and exact numeric fields. Touch targets have a 44 px hit diameter and choose the nearest point when targets overlap. Keyboard arrows change a focused point by 0.1 mm in model Z or 0.01 mm in target height. Add point inserts into the largest gap; Remove point retains at least two points and the fixed Z=0 anchor. Reset flat makes a constant curve. Apply commits the complete edit as one undo step; Cancel discards the draft.

The curve linearly interpolates target heights in model-space Z and extends its endpoint values beyond the control points. Z excludes the raft offset. The first layer retains its separate configured height. For each later layer, the planner solves `height = curve(previous top + height/2)` by bounded bisection, then rounds to microns. This avoids iteration oscillation on steep curves. A short final remainder rebalances the shortest feasible tail; if exact fitting is impossible, the nearest legal final top is used. The editor previews the model-layer count and final top, excluding rafts and possible empty cross-sections. It does not claim a particular physical surface quality.

Curves contain 2–128 finite, strictly ordered points beginning at Z=0, with at least 0.001 mm between points and a 2,000 mm coordinate ceiling. Targets must stay between the selected minimum and normal heights, which must also meet the selected nozzle profile's limits. Invalid imported curves or conflicting modes are rejected. Invalid process limits/targets fail before worker creation. Engine precision and 100,000-layer limits fail explicitly instead of silently truncating output.

Projects, recovery and process presets preserve the curve. A nozzle-diameter change disables manual mode and retains the saved control points; review or reset them before enabling it for the new nozzle. Changes to normal/minimum heights do not silently reshape a saved curve: incompatible points remain visible and must be corrected.

## Engine integration

The original Stratum helper `public/engine/layer-plan.js` builds the automatic or manual shared schedule once, before dispatching parts. The worker uses its midpoint/height pairs for geometry slicing and its physical tops for preparation. Synthetic support widgets inherit the same indices and raft offset. Existing raft layers and the intentional raft-to-model gap retain their separate heights. Rafts use the configured support tool when supports are enabled, otherwise the first model tool. Purge-tower foundations extend from the bed through raft levels and fill the model separation gap, while the model retains its intentional gap. See `docs/purge-planning.md`.

The pinned engine's adaptive path previously treated layer tops as sampling planes, shifting the first print elevation by half a layer. Its preparation also rounded the merged planes to 0.01 mm and reused the nominal height for later extrusion calculations. The shared path fixes these three behaviors. Model-wall extrusion is independently checked against actual exported Z increments, alongside the existing exact purge-volume audit.

The engine adds an empty end slice to detect top surfaces. Its `z` is an internal index, not a physical print height. Stratum excludes these heightless markers from final preparation for both fixed and adaptive jobs, while retaining real empty slices below elevated material parts. Otherwise a short part could add a purge-only layer at an unrelated elevation inside a taller part's print.

Upstream reference: Kiri:Moto [slice processing](https://github.com/GridSpace/grid-apps/blob/d138275bbe9d4e4030d8cb8b2dcf66607da9295a/src/kiri/mode/fdm/work/slice.js) and [preparation](https://github.com/GridSpace/grid-apps/blob/d138275bbe9d4e4030d8cb8b2dcf66607da9295a/src/kiri/mode/fdm/work/prepare.js), under its MIT license. `scripts/patch-adaptive-layers.py` reproduces the incremental worker modification from release `9debe20`; runtime/helper checksums are in `vendor-manifest.json`.

## Verification and limits

Core checks cover interval feasibility, part-order independence, duplicate landmarks, a short final interval, equal min/max, odd-micron first layers, dense irregular geometry and bounded failure. Real-engine checks cover unequal-height multi-tool parts, fixed-height short parts, extrusion per actual layer height, linked stacked colors without false bridges, normal/tree dedicated supports, raft offsets and variable-height spiral extrusion. Desktop Bambu and phone U1 UI checks enable the setting, recover it after reload and export real multicolor jobs.

Manual-curve checks additionally cover interpolation, steep transitions, tail fitting, malformed imports, nozzle changes, raw E/XY extrusion, touch/pointer editing, cancel, undo/redo, recovery and portable downloads. Raft cases include sparse nonzero model/support slots, no generated supports, single-material jobs, tower foundations and actual Bambu/U1 template compilation.

These checks establish software behavior for the tested cases. They do not establish physical printer performance or complete the broader multi-color printer audit.
