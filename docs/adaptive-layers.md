# Adaptive layers across materials

Enable **Advanced → Quality → Adaptive layer height** and choose a minimum layer height. The first layer retains its configured height. Subsequent layers share one schedule across the entire plate, including separate objects, linked parts, painted material regions and dedicated support filaments. A detail on one part can therefore change the layer heights on other parts.

The planner collects transformed mesh vertex heights after material preparation, sorts their union and divides feasible intervals into layers between the configured minimum and normal layer height. This is a mesh-feature-height method; it does not claim an angular surface-error optimizer or a manually painted layer-height curve. Close features that cannot be separated within the minimum height do not force thinner layers. The final interval is redistributed where possible; if no exact partition exists (for example, equal minimum/maximum heights), the closest legal top is used. As with fixed slicing, sub-layer details and very thin parts may not produce a printable cross-section.

Physical heights use integer microns. Mesh sampling uses the engine's 1 µm midpoint grid, which can differ from the mathematical midpoint by 0.5 µm; physical print tops and extrusion heights are retained separately. Minimum/maximum heights must admit at least one micron-sized increment. The first height rounds to this precision. A schedule exceeding 100,000 layers fails explicitly. There is no per-part layer schedule that can drift away from a neighboring material.

## Engine integration

The original Stratum helper `public/engine/layer-plan.js` builds the shared schedule once, before dispatching parts. The worker uses its midpoint/height pairs for geometry slicing and its physical tops for preparation. Synthetic support widgets inherit the same indices and raft offset. Existing raft layers and the intentional raft-to-model gap retain their separate heights.

The pinned engine's adaptive path previously treated layer tops as sampling planes, shifting the first print elevation by half a layer. Its preparation also rounded the merged planes to 0.01 mm and reused the nominal height for later extrusion calculations. The shared path fixes these three behaviors. Model-wall extrusion is independently checked against actual exported Z increments, alongside the existing exact purge-volume audit.

The engine adds an empty end slice to detect top surfaces. Its `z` is an internal index, not a physical print height. Stratum excludes these heightless markers from final preparation for both fixed and adaptive jobs, while retaining real empty slices below elevated material parts. Otherwise a short part could add a purge-only layer at an unrelated elevation inside a taller part's print.

Upstream reference: Kiri:Moto [slice processing](https://github.com/GridSpace/grid-apps/blob/d138275bbe9d4e4030d8cb8b2dcf66607da9295a/src/kiri/mode/fdm/work/slice.js) and [preparation](https://github.com/GridSpace/grid-apps/blob/d138275bbe9d4e4030d8cb8b2dcf66607da9295a/src/kiri/mode/fdm/work/prepare.js), under its MIT license. `scripts/patch-adaptive-layers.py` reproduces the incremental worker modification from release `9debe20`; runtime/helper checksums are in `vendor-manifest.json`.

## Verification and limits

Core checks cover interval feasibility, part-order independence, duplicate landmarks, a short final interval, equal min/max, odd-micron first layers, dense irregular geometry and bounded failure. Real-engine checks cover unequal-height multi-tool parts, fixed-height short parts, extrusion per actual layer height, linked stacked colors without false bridges, normal/tree dedicated supports, raft offsets and variable-height spiral extrusion. Desktop Bambu and phone U1 UI checks enable the setting, recover it after reload and export real multicolor jobs.

These checks establish software behavior for the tested cases. They do not establish physical printer performance or complete the broader multi-color printer audit.
