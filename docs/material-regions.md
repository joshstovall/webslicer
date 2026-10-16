# Painted and overlapping materials

Surface painting stores a separate surface tessellation (`paintTriangles` and `faceTools`) beside the original closed mesh. Round-brush subdivision therefore cannot introduce T-junctions into the source solid. Flat-face painting covers a coplanar face; replace-color changes that material across the selected part. Every drag is one history entry. Paint colors, tessellation, and world-space depth persist in portable projects and follow assembly transforms.

When slicing, a cancellable worker loads **Manifold 3.5.4** from the locked npm dependency and its local WebAssembly asset. Painted triangles form inward prisms of the chosen depth. These masks intersect the original solid and are subtracted from its core, creating disjoint closed regions. Unpainted interior retains the object's base filament. At an inward intersection of two painted masks, the higher filament slot takes precedence; visible patches retain their assigned surface areas except at shared boundaries. Very thin features remain subject to the nozzle and layer resolution.

For an assembly with intersecting solids, later parts in the object list take precedence over earlier parts. The earlier solid has the occupied volume subtracted before toolpaths are generated. Same-filament regions are unioned, preventing duplicate internal extrusion. This operation requires closed, consistently oriented input geometry and reports an error rather than silently dropping invalid parts. Unpainted, non-overlapping models bypass the worker.

The app independently decodes the painted-3MF hexadecimal subdivision format documented by OrcaSlicer's `FacetsAnnotation` serialization and `TriangleSelector` subdivision behavior. Paint trees are read right-to-left; leaf colors include the extended high-slot encoding; one-, two-, and three-edge splits retain their spatial ordering. The source mesh remains intact while decoded patches become the paint tessellation. Core vertex colors with multiple materials are divided into discrete nearest-vertex regions in barycentric coordinates, because a physical filament cannot interpolate RGB.

Format references:

- https://github.com/OrcaSlicer/OrcaSlicer/blob/main/src/libslic3r/Model.cpp
- https://github.com/OrcaSlicer/OrcaSlicer/blob/main/src/libslic3r/TriangleSelector.cpp
- https://manifoldcad.org/docs/jsapi/classes/manifold.Manifold.html

Manifold is Apache-2.0 licensed; the license is included at `public/wasm/MANIFOLD-LICENSE.txt`. The package lock records its exact version and package integrity. No Orca source implementation is bundled in this decoder.

Cuts, splits, and height assignments now run through the same cancellable material worker when paint or a multipart object requires it. They convert paint into closed, assigned material parts. A cut caps each material region, links all colors on each side, then grounds/flips the whole side together. Height assignment preserves all colors below its plane and unions the chosen material above it. The assembly-edit toggle determines whether the selected part or its whole linked object is edited.

Splitting first unions the regions to find physical connected objects, then intersects each object's volume with each material. Touching colors stay together. Decomposition can produce separate cavity surfaces; signed-volume classification and solid-angle containment reattach cavities to their enclosing shell, leaving a solid island inside a cavity as a separate object. Splitting an already connected object is a no-op and retains editable paint.

Edits preserve hidden parts without subtracting them from visible geometry. Cancellation or failure leaves the original project intact; a completed operation is one undo entry. The 200-part portable-project limit is checked before replacing the source. Converted solid parts retain filament colors, relative placement, and visibility through recovery and export.

Material processing retains Manifold's internal topology through edits. Before exporting Float32 triangles, it simplifies sub-micron Boolean slivers with a 0.0001 mm tolerance. This prevents repeat edits from losing material through tiny collapsed edges. Regression tests include nonuniform scaling, rotation, repeated cuts, cavity/island separation, and per-material volume conservation.
