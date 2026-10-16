# Third-party engine notices

Kiri:Moto runtime 4.7.3, Copyright Stewart Allen / GridSpace.
Source: https://github.com/GridSpace/grid-apps
Documentation: https://docs.grid.space/kiri-moto/
License: MIT; see LICENSE.md in this directory.

The engine, worker, and pool bundles were downloaded from https://grid.space/lib/pack/ on 2026-10-15. Bundled upstream copyright and license comments are retained. Matching geometry and Manifold WebAssembly binaries are included under /wasm/.

Local modification: in kiri-work.js, the worker pool size expression
`Math.max(4,Math.round(nY*.75))`
is replaced with
`Math.min(4,Math.max(2,Math.round(nY*.5)))`
to limit CPU/memory use on high-core devices. The worker and pool bundles also resolve kiri-geo.wasm relative to their module URLs so deployment under a subdirectory works. The engine bundle additionally exports its existing worker client as `engineClient`; the bridge uses it to synchronize and slice multiple widgets before joint path planning. No slicing algorithms were changed.

Manifold: https://github.com/elalish/manifold (Apache-2.0).
See /wasm/MANIFOLD-LICENSE.txt. Additional embedded dependencies retain their upstream notices at the ends of the JavaScript bundles. React, Mantine, Three.js, Lucide, fflate, idb-keyval, and fonts are distributed through their npm packages, which retain their respective licenses.

Purge block placement patch: `mkrec` in the FDM preparation path now receives a separate consecutive `blockIndex` for its XY location. It continues to retain the actual extruder index for tool selection and nozzle properties. The original worker used the extruder ID as its physical block offset, pushing high-numbered AMS slots beyond the bed. The block index is retained when rebuilding a belt purge block. The integration regression covers slots 8 and 16 and all four U1 heads. This is a local modification to the MIT-licensed Kiri:Moto worker; its updated checksum is recorded in `vendor-manifest.json`.

The application's separate material-preparation worker uses the npm dependency `manifold-3d` 3.5.4 (Apache-2.0). Vite bundles its JavaScript and WebAssembly locally; package-lock.json records its package integrity. Its license is included at `public/wasm/MANIFOLD-LICENSE.txt`. This is separate from the Manifold runtime embedded in Kiri:Moto.
