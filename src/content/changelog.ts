/**
 * Novedades / changelog del juego (panel "Novedades" del menú principal).
 *
 * La entrada más reciente va PRIMERO. Para publicar una versión nueva basta
 * con añadir un objeto al principio de `CHANGELOG`:
 *
 *   { version: "0.8.0", date: "2026-12-01", title: "…", tag: "new",
 *     items: ["…", "…"] },
 *
 * `date` en formato ISO (AAAA-MM-DD); es opcional.
 */

export type ChangeTag = "new" | "improve" | "fix";

export interface ChangelogEntry {
  version: string;
  /** Fecha ISO (AAAA-MM-DD). */
  date?: string;
  title: string;
  /** Tipo principal de la versión (color de la etiqueta). */
  tag: ChangeTag;
  items: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "0.7.0",
    date: "2026-11-18",
    title: "Menús más ágiles",
    tag: "improve",
    items: [
      "Navegación completa con teclado y mando, con leyenda de controles abajo.",
      "Atajos en los botones (Esc para volver, C para continuar, R aleatorio…).",
      "Nuevas transiciones entre menús con el color e icono de cada sección.",
      "Panel de novedades en el menú principal.",
      "Gacha renovado: cofre animado, cartas que se giran y un Inventario en su propia pantalla.",
      "Tras 30 segundos sin actividad, el menú vuelve a la pantalla de título.",
      "El tutorial destaca más mientras no lo hayas completado.",
      "La descripción de cada modo ya no desplaza el menú.",
      "La pantalla VS antes del combate dura al menos 3 segundos.",
      "Arreglado: Enter no aceptaba en el menú de pausa.",
      "Arreglado: los retratos de las tarjetas del HUD no siempre se veían.",
    ],
  },
  {
    version: "0.6.0",
    title: "Habilidades especiales",
    tag: "new",
    items: [
      "Cada luchador tiene ataques únicos: proyectiles, golpes múltiples, armadura, intangibilidad y reflejo.",
      "Al cargar el ataque fuerte al máximo, el personaje brilla al rojo vivo.",
      "La tabla de movimientos de la pausa marca los ataques especiales.",
    ],
  },
  {
    version: "0.5.0",
    title: "Un estilo por luchador",
    tag: "new",
    items: [
      "Movimientos propios para cada personaje (ligeros y fuertes en 4 direcciones).",
      "Golpes exagerados: el puño o el pie crecen al impactar.",
      "Entrenamiento: menú para cambiar de personaje sin salir.",
    ],
  },
  {
    version: "0.4.0",
    title: "12 luchadores",
    tag: "new",
    items: [
      "8 personajes originales y 4 invitados crossover, entre ellos El Primo.",
      "Tarjeta «Aleatorio» en la selección de personaje.",
      "Fichas de jugador más compactas con Jugador / CPU / Off siempre visibles.",
    ],
  },
  {
    version: "0.3.0",
    title: "Nace KiroBrawl",
    tag: "improve",
    items: [
      "Rediseño completo de la interfaz y nuevo logo.",
      "Efectos de cómic: destellos, ondas de choque y líneas de velocidad.",
      "Escenarios 3D nuevos y modelos de personaje renovados.",
      "Opciones gráficas detalladas pensadas para portátiles.",
      "Pantallas de carga con porcentaje real.",
    ],
  },
  {
    version: "0.2.0",
    title: "Online y comunidad",
    tag: "new",
    items: [
      "Multijugador online por sala con código (hasta 4 jugadores).",
      "Clasificación, monedas y gacha de tokens.",
      "Inicio de sesión con Google y apodo propio.",
    ],
  },
  {
    version: "0.1.0",
    title: "Primer combate",
    tag: "new",
    items: [
      "Combate de plataformas con daño en %, escudos, esquivas y furia.",
      "Batalla local contra amigos o la CPU, entrenamiento y tutorial.",
      "Repeticiones automáticas de cada partida.",
    ],
  },
];

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-11-18" → "18 nov 2026" (sin depender de la zona horaria). */
export function formatChangelogDate(iso: string | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${Number(m[3])} ${month} ${m[1]}`;
}
