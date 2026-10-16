import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  optimizeDeps: { include: ["manifold-3d"] },
  server: {
    host: "0.0.0.0",
    watch: { usePolling: process.env.WATCH_POLLING === "true", interval: 400 },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], react: ["react", "react-dom"] },
      },
    },
  },
});
