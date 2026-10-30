import { defineConfig } from "vite";

// GitHub Pages sirve el sitio bajo /<nombre-del-repo>/, así que en la build de
// producción las rutas de assets deben colgar de esa subcarpeta. En dev (y en
// `preview`) usamos la raíz "/". Se activa con la variable GITHUB_PAGES=1, que
// pone el workflow de despliegue (ver .github/workflows/deploy.yml).
const isPages = Boolean(process.env.GITHUB_PAGES);
const base = isPages ? "/smash-whit-kiro/" : "/";

// URL del backend según el entorno (mismo patrón que `base`): en la build de
// Pages apuntamos al server desplegado en Render; en dev, al server local.
// `src/net/api.ts` lee import.meta.env.VITE_API_URL.
const apiUrl = isPages
  ? "https://smash-b-server.onrender.com"
  : "http://localhost:8787";

export default defineConfig({
  base,
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
  },
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
