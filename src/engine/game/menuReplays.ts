import type { ReplayData } from "./replay.ts";

/**
 * Carga todos los replays que haya en `src/replays/*.json` para usarlos como
 * fondo del menú principal. Añadir un replay al fondo es tan simple como soltar
 * su .json en esa carpeta: `import.meta.glob` los descubre en build-time, así
 * que no hay que listarlos a mano.
 *
 * Son estáticos (eager): se incluyen en el bundle. Para muchos/grandes replays
 * convendría cargarlos bajo demanda, pero para unos pocos de menú va de sobra.
 */
const modules = import.meta.glob<ReplayData>("../replays/*.json", {
  eager: true,
  import: "default",
});

/** Lista de replays del menú (puede estar vacía si la carpeta no tiene .json). */
export const MENU_REPLAYS: ReplayData[] = Object.keys(modules)
  .sort() // orden estable por nombre de archivo
  .map((k) => modules[k])
  .filter((r): r is ReplayData => !!r && Array.isArray(r.steps) && r.steps.length > 0);
