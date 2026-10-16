# Stratum — browser 3D slicer

A responsive, local-first FDM printing workspace built with **React 19, Vite, TypeScript, Mantine, and Three.js**. Actual slicing and G-code generation run in browser workers using a locally vendored **Kiri:Moto 4.7.3** engine. No model-upload backend is needed.

## Run

```sh
npm ci
npm run dev
```

Open the URL Vite prints. In sandboxed environments where native file events are unavailable, use `WATCH_POLLING=true npm run dev` for live reload. The development server binds to all interfaces, so a phone or tablet on the same network can use the host's LAN address. For remote use, deploy the production build over HTTPS.

```sh
npm run build
npm run preview
```

Deploy the entire `dist/` folder. For a subdirectory, build with `VITE_BASE_PATH=/webslicer/ npm run build`. Preserve the `engine/` and `wasm/` folders and serve `.wasm` as `application/wasm`. No cross-origin isolation headers are required. Fonts and the slicing engine are bundled locally. Selecting a vendor printer initially fetches its pinned official G-code templates. Successfully loaded templates are cached by revision for later selection without GitHub connectivity; saved projects also retain them. Browser-local projects are tied to the origin: download a project file before changing hosts or clearing site data.

## GitHub Pages

Live app: https://joshstovall.github.io/webslicer/

The `.github/workflows/deploy.yml` workflow installs locked dependencies, runs core tests, builds with the repository base path, and deploys `dist/` to GitHub Pages on pushes to `main` or manual dispatch. Repository Settings → Pages must use **GitHub Actions** as its source. Node.js 24 is used for CI.

To check the same build locally:

```sh
VITE_BASE_PATH=/webslicer/ npm run build
VITE_BASE_PATH=/webslicer/ npm run preview -- --port 4174
# In another terminal:
TEST_URL=http://localhost:4174/webslicer/ npm run test:e2e -- tests/e2e/workspace.spec.ts --grep "real slicing|phone"
```

## Features

- Touch orbit, pinch zoom, and two-finger pan; desktop camera controls and keyboard shortcuts.
- Import binary/ASCII STL, multipart OBJ, and 3MF components with material assignments and relative transforms; inspect linear G-code and Bambu print packages.
- Select, rename, move, rotate, uniformly/nonuniformly scale, ground, fit to bed, and duplicate models and linked assemblies. Link selected parts into multi-color assemblies, detach or separate them, and set material overlap priority. Assign filament by part, create linked color bands by height, or paint surfaces with round-brush, flat-face and replace-color tools.
- Cap horizontal cuts, split disconnected parts, and lay models on a side.
- Arrange models, detect bounding-box collisions, check build-volume/adhesion clearance, and manage multiple build plates.
- Starter calibration cube, cylinder, sphere, torus, and watertight hollow helix planter.
- Printer dimensions, nozzle/filament sizes, editable machine G-code, per-filament settings, support filament, purge tower, directional purge volumes, and PLA/PETG/ABS/ASA/TPU presets.
- Bambu X1 Carbon, P1S, P1P, A1 and A1 mini AMS profiles, plus the four-head Snapmaker U1 (0.4 mm variants). Bambu print packages include thumbnails and filament metadata.
- Layer heights, adaptive layers, wall order, thin walls, seam placement, spiral vase, top/bottom layers, and six infill patterns.
- Automatic normal/tree supports, support angle/density/separation, skirt/brim/raft, print/travel speeds, volumetric flow, temperature, cooling, retraction, Z hop, and flow ratio.
- Real slicing with progress and cancellation. A job owns an isolated frame and its workers, all removed on cancellation/completion.
- Toolpath preview from the actual generated G-code, layer scrubbing/playback, single-layer view, feature visibility, travel moves, and speed colors.
- Motion-time estimate, filament length/weight, material cost, raw G-code inspection, and export.
- Undo/redo, IndexedDB recovery, portable compressed `.webslicer` projects, binary STL export, reusable local print presets, and JSON preset import/export.
- User-initiated upload to OctoPrint or Moonraker; credentials remain in session memory. Upload never starts a print.
- Mantine dialogs, menus, inputs, responsive bottom drawers, focus management, and reduced-motion styling.

## Printer setup and supported scope

Generic printer choices use **Marlin-compatible** start/end sequences. Bambu and Snapmaker presets load pinned official templates and use printer-specific adapters for multi-tool jobs. Tool-change adapters preserve planned motion and retraction state; see `docs/machine-state.md` for their contracts and source evidence. Review those sequences for your exact firmware, leveling procedure, and machine. This software has been tested through browser-generated G-code, **not on physical printers**. Inspect toolpaths before printing. Motion-time estimates exclude heating and acceleration.

This is an independent FDM slicer. Multi-color support is in active development; see `docs/multicolor-progress.md` for the remaining implementation and validation work. Part assignments and height bands generate real tool changes. Painted 3MF trees and core triangle/vertex colors are converted into printable material regions. A local Manifold worker creates closed paint shells and resolves overlaps between assembly parts. Cuts, splits, and height assignments preserve painted materials as linked solid parts. Height colors replace the material above the boundary while retaining existing colors below it. Modifier meshes, support painting, STEP import, resin slicing, and proprietary printer cloud integrations remain outside the implemented feature set. 3MF component geometry, part filament assignments, and filament palettes are imported; other Orca project process settings are not imported. Imported G2/G3 arc moves are explicitly reported as unsupported by the linear viewer. The engine exports linear moves. Printer uploads require CORS and compatible HTTP/HTTPS connectivity.

Mesh files are assumed to use millimeters (3MF's declared units are honored by its loader). Separate objects use conservative AABB collision checks. Linked assembly parts may touch or interlock. Open **Manage assembly** in Object properties to choose linked parts and adjust overlap priority. The top part in its priority list wins overlapping volume; same-filament regions are merged. Linking and separating preserve world positions, paint, and filament assignments. Each change supports undo/redo and project recovery. Painting and overlap resolution require closed, consistently oriented meshes. See `docs/material-regions.md` for material-region behavior. Cuts require closed, manifold contours. Import is limited to 100 MB; splitting is limited to 500,000 triangles and 200 parts. Complex models can consume significant browser memory.

## Tests

```sh
npm test
npm run build
# Start the dev server, then:
TEST_URL=http://localhost:5173 npm run test:e2e
```

The Playwright suite uses the installed Chrome channel. Change `channel` in `playwright.config.ts` if using Playwright's bundled Chromium. The automated suite covers core geometry, material processing and persistence plus browser integration tests. Run it for the current counts and results. Core tests cover geometry transforms, packing, bounds checks, STL round trips, hollow-mesh cuts, connected components, G-code interpretation, settings mapping, and project validation. Browser tests cover the real engine, downloads, cancellation, project recovery, desktop interactions, phone/tablet layouts, 3MF unit conversion, LAN origins, engine failure recovery, and mocked printer uploads.

## Architecture

- `src/App.tsx`: project/history lifecycle, tool actions, Mantine workspace and dialogs.
- `src/components/Viewport.tsx`: on-demand Three.js rendering, orbit/transform controls, and G-code paths.
- `src/components/SettingsPanel.tsx`: process, printer, and material controls.
- `src/lib/geometry.ts` / `mesh-tools.ts`: import, transforms, packing, export, cut, and split.
- `src/lib/profiles.ts`: typed settings mapped to Kiri:Moto process/device fields.
- `src/lib/slicer.ts`: isolated engine lifecycle, progress, timeout, and cancellation.
- `src/lib/gcode.ts`: absolute/relative movement and extrusion interpreter.
- `src/lib/project.ts`: IndexedDB, validated compressed project persistence, downloads.
- `public/engine/bridge.js`: same-origin frame bridge into the vendored engine.

### Engine snapshot

Vendored bundles were obtained from GridSpace's public runtime on October 15, 2026; the runtime reports 4.7.3. See `public/engine/NOTICE.md` and `vendor-manifest.json` for provenance and checksums. The worker bundle caps its pool at four workers; worker and pool geometry WASM paths are relative to their modules for subdirectory hosting. The pool must stay enabled because asynchronous polygon operations depend on it even when slice parallelism is disabled. The engine is lazy-loaded only when slicing. Updating it requires retesting profile mappings, worker protocol, matching WebAssembly files, support generation, and G-code output together.
