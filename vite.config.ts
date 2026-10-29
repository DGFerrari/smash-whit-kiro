import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Separamos Three.js en su propio chunk: cachea mejor y quita el aviso
        // de "chunk > 500 kB" sobre el bundle principal del juego.
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
});
