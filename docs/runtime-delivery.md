# Version-consistent slicing runtime

Production builds load the slicing engine from `runtime/<revision>/engine/bridge.html`. The revision covers the complete engine/WASM snapshot and the frame's version-stamp template. All relative imports, worker URLs and WASM requests remain inside that revision's directory. A cached engine from an older release therefore cannot silently service newer controls that require another revision.

`scripts/runtime-bundle.mjs` reads the inputs once and uses that captured byte set for both the revision and emitted files. The frame carries its revision in a metadata tag. The application accepts its ready message only when the revision matches its compiled expectation. Development keeps the stable `engine/bridge.html` path and a `development` identity, so source-import browser tests and hot reload continue to work.

Deploy the complete `dist` folder, including `runtime/` and the hashed application assets. Keep the same relative layout under the configured Vite base path. The original top-level `engine/` and `wasm/` copies remain available for older application tabs and development-compatible tooling; the current production app uses the versioned snapshot. This adds a second server-side copy of the engine, but a current job downloads only its selected revision.

`runtime-manifest.json` describes the emitted revision, entry and every packaged file's length and SHA-256. `npm run verify:runtime` verifies all files, rejects unlisted files, reconstructs the content identity, and checks that the built application references it. Deployment runs this after the production build and before upload. The existing `vendor-manifest.json` continues to track the vendored/source files and original provenance.

An engine that fails to become ready within 30 seconds reports a connection/reload error and releases its frame. A mismatched ready message is rejected before model buffers are transferred or slicing workers start. Repeated ready messages do not dispatch the job again. Once ready, the normal ten-minute slicing limit applies. Failure and retry preserve the project.

A deployment does not retain every previous runtime directory indefinitely. An already-open older versioned app can use its cached files; if an uncached old file is gone, it must reload to select the current revision. This change does not install a service worker or guarantee offline availability. Full offline installation and cache lifecycle management remain part of the broader goal.

## Verification

Run `npm run build` before the complete browser suite. `tests/e2e/runtime-release.spec.ts` serves the production build through a local HTTP server with real cache headers. It warms both a legacy engine and a previous versioned engine, confirms the old frame is actually cached, reproduces its lack of tree support, then deploys the current app at the same origin and checks the actual worker/helper/WASM requests and exported G-code. Other cases exercise a mismatched frame and a frame that never starts, then verify cleanup and successful retry without losing the saved model.

`TEST_RUNTIME_DIST=/absolute/build/path` selects an alternate build for these tests. This supports verification of both root hosting and the `/webslicer/` base path. Unit tests cover deterministic snapshots, helper/worker/WASM invalidation, unmodified source files, malformed frame input, symlink rejection and corrupted/stale deployment artifacts. See the current checkpoint in `multicolor-progress.md` for verified results and publication state.
