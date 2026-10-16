# STEP model import

Choose `.step` or `.stp` with **Add model**, or drop it onto the workspace. The Mantine review dialog offers Draft (0.15 mm), Balanced (0.05 mm, default), and Fine (0.02 mm) tessellation targets, plus an **Import CAD colors** switch. Angular tolerances are 0.6, 0.35, and 0.2 radians respectively. Curved surfaces gain triangles at finer quality; planar geometry need not change.

Conversion runs locally in a disposable worker using occt-import-js 0.0.23 and Open CASCADE. The converter and its 7.6 MB WASM load only for CAD conversion. Stages are shown without inventing a percentage for the synchronous native tessellator. Cancel terminates the worker immediately; success, errors and a three-minute deadline also terminate it. Cancellation stops the remaining file batch and leaves already imported files intact. A failed current file never partially changes the project.

## Geometry and materials

STEP-declared units convert to millimeters. OCCT applies face/assembly locations before the app receives vertices. A common XY center and minimum Z ground the complete assembly, retaining relative placement. Multiple emitted meshes become linked parts with one pivot; nested CAD hierarchy is flattened. Imported parts participate in the usual arrange, transform, save/recover, undo and slicing workflows.

The importer expands indexed triangles without changing winding. Names are retained, bounded to 200 characters. Part and face colors are converted from OCCT's linear RGB to sRGB, then assigned to the existing filament binding pipeline. The dominant face material fills a part's interior; other faces use the existing printable surface-paint pipeline. This is a material assignment interpretation of CAD display colors, not a claim that the CAD file defines physical multi-material volumes. Turning colors off imports geometry into the project's first filament.

## Limits

- 100 MB input, 200 emitted parts, two million triangles, 64 CAD palette entries and coordinates within ±10 million mm.
- Input size is checked before reading. Geometry limits and finite/index checks run after native tessellation and before expanding triangle buffers. Native tessellation and its JavaScript result can consume significant memory before those checks; these are not hard memory guarantees for mobile browsers.
- Self-contained STEP files are required. External reference files are not loaded. CAD constraints, parametric history, annotations, texture images and nested hierarchy are not transferred.
- Solid, shell and standalone-face meshes can be emitted by the converter. Open surfaces are retained with a general warning; no watertightness or automatic repair guarantee is made. Material-region operations still require closed, consistently oriented meshes.
- B-rep approximation is not an exact geometric representation. For very large assemblies, simplify the source or use Draft quality.

## Library provenance and replacement

The pinned npm package is `occt-import-js@0.0.23`, upstream tag revision `c2148e54b456b571238d35cac037d304053d64b2`. Its OCCT submodule revision is `d2abb6d844231cb8f29be6894440874a4700e4a5`. The adapter source establishes millimeter output, face locations, inclusive triangle color ranges and linear RGB color values. No modifications are made to the upstream library binaries; Vite bundles the JavaScript adapter and emits the WASM as a separate hashed asset.

`public/cad/NOTICE.html` links the LGPL 2.1 texts, OCCT exception, complete wrapper/package archive, OCCT source archive and source checksums. The app serves these files from the same installation. They are downloaded only when requested, not during normal app startup or CAD conversion. The notice includes build/replacement instructions using upstream's Emscripten 3.1.69 scripts and the application's normal build process.

Tests use STEP fixtures from the pinned npm package, preserving upstream fixture provenance there. Coverage includes declared mm/m/in units, face colors, assemblies, quality differences, cancellation/worker disposal, malformed-file recovery and responsive imports through real G-code export. Verification results are recorded in the progress ledger.
