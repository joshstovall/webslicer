import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import {
  snapshotRuntime,
  runtimeBundlePlugin,
} from "./scripts/runtime-bundle.mjs";
export default defineConfig(({ command }) => {
  const runtime =
    command === "build"
      ? snapshotRuntime(fileURLToPath(new URL("./public", import.meta.url)))
      : undefined;
  return {
    define: {
      __STRATUM_RUNTIME_REVISION__: JSON.stringify(
        runtime?.revision ?? "development",
      ),
    },
    base: process.env.VITE_BASE_PATH || "/",
    plugins: [react(), ...(runtime ? [runtimeBundlePlugin(runtime)] : [])],
    optimizeDeps: { include: ["manifold-3d", "occt-import-js"] },
    server: {
      host: "0.0.0.0",
      watch: {
        usePolling: process.env.WATCH_POLLING === "true",
        interval: 400,
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: { three: ["three"], react: ["react", "react-dom"] },
        },
      },
    },
  };
});
