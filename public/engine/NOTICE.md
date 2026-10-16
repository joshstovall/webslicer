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
to limit CPU/memory use on high-core devices. The worker and pool bundles also resolve kiri-geo.wasm relative to their module URLs so deployment under a subdirectory works. No slicing algorithms were changed.

Manifold: https://github.com/elalish/manifold (Apache-2.0).
See /wasm/MANIFOLD-LICENSE.txt. Additional embedded dependencies retain their upstream notices at the ends of the JavaScript bundles. React, Mantine, Three.js, Lucide, fflate, idb-keyval, and fonts are distributed through their npm packages, which retain their respective licenses.
