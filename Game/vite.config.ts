import { defineConfig } from "vite";

export default defineConfig({
  server: {
    fs: {
      // Allow serving Havok wasm/js correctly in dev (Vite otherwise breaks it)
      allow: ["../.."],
    },
  },
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
  },
  build: {
    // Ensure public assets are copied correctly
    copyPublicDir: true,
  },
});
