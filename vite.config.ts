import { defineConfig } from "vite";

// GitHub Pages sirve el sitio bajo /<nombre-del-repo>/, así que en la build de
// producción las rutas de assets deben colgar de esa subcarpeta. En dev (y en
// `preview`) usamos la raíz "/". Se activa con la variable GITHUB_PAGES=1, que
// pone el workflow de despliegue (ver .github/workflows/deploy.yml).
const base = process.env.GITHUB_PAGES ? "/smash-whit-kiro/" : "/";

export default defineConfig({
  base,
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
