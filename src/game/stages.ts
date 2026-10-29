/**
 * Registro de ESCENARIOS (mapas).
 *
 * La GEOMETRÍA de juego es la misma para las variantes de "isla" (para no
 * cambiar el balance): lo que cambia es el TEMA visual (colores de las
 * plataformas y fondo), para que se distingan al máximo. El escenario de
 * entrenamiento tiene su propia geometría (suelo de borde a borde + rejilla).
 *
 * El id del escenario se guarda en el replay, así que NO cambiar los ids.
 */

/** Tipo de geometría del escenario. */
export type StageKind = "island" | "trainingGrid";

/**
 * Estilo de fondo que dibuja el renderer.
 *  - neonCity: skyline de ciudad neón (isla Neón).
 *  - meadow: cielo pastel suave estilo pradera/acantilado (isla Pradera).
 *  - sanctuary: cielo nuboso pastel con mar y montaña (isla Santuario).
 *  - grid: oculto, el renderer dibuja la rejilla (entrenamiento).
 */
export type StageBackdrop = "neonCity" | "grid" | "meadow" | "sanctuary";

/**
 * Los ids NO cambian (se guardan en los replays): `sunsetIsland` y `voidIsland`
 * son ahora, respectivamente, la isla PRADERA y la isla SANTUARIO (solo cambia
 * su tema visual, nombre y fondo; la geometría sigue igual para no tocar el
 * balance).
 */
export type StageId =
  | "neonIsland"
  | "sunsetIsland"
  | "voidIsland"
  | "training";

export interface StageTheme {
  /** Cuerpo/lateral de la isla sólida. */
  solidSide: number;
  /** Tapa superior (donde se pisa). */
  solidTop: number;
  /** Plataformas atravesables (one-way). */
  oneWay: number;
  /** Color de fondo de la escena 3D. */
  background: number;
}

export interface StageDef {
  id: StageId;
  name: string;
  kind: StageKind;
  backdrop: StageBackdrop;
  theme: StageTheme;
  /** ¿Es el escenario de entrenamiento? (no seleccionable en batalla). */
  training?: boolean;
}

export const STAGES: Record<StageId, StageDef> = {
  neonIsland: {
    id: "neonIsland",
    name: "Isla Neón",
    kind: "island",
    backdrop: "neonCity",
    theme: { solidSide: 0x3a4a66, solidTop: 0x5b7fa6, oneWay: 0x7fb2ff, background: 0x0a0f24 },
  },
  // Isla PRADERA: acantilado rocoso marrón con tapa de hierba verde, cielo
  // pastel suave (inspirada en una pradera sobre un risco).
  sunsetIsland: {
    id: "sunsetIsland",
    name: "Isla Pradera",
    kind: "island",
    backdrop: "meadow",
    theme: { solidSide: 0x6b5a42, solidTop: 0x5fa045, oneWay: 0x8cc06a, background: 0xbcd6e8 },
  },
  // Isla SANTUARIO: roca musgosa oscura con tapa verde frondosa y plataformas
  // tipo cristal, sobre un cielo nuboso pastel con mar y montaña.
  voidIsland: {
    id: "voidIsland",
    name: "Isla Santuario",
    kind: "island",
    backdrop: "sanctuary",
    theme: { solidSide: 0x3c3a30, solidTop: 0x4e8a3e, oneWay: 0x9fd8e8, background: 0xe9d6dc },
  },
  training: {
    id: "training",
    name: "Entrenamiento",
    kind: "trainingGrid",
    backdrop: "grid",
    theme: { solidSide: 0x3a4a66, solidTop: 0x5b7fa6, oneWay: 0x7fb2ff, background: 0xf3f5f8 },
    training: true,
  },
};

/** Escenarios seleccionables en batalla (en orden). */
export const SELECTABLE_STAGES: StageId[] = ["neonIsland", "sunsetIsland", "voidIsland"];

export function getStage(id: StageId | undefined): StageDef {
  return (id && STAGES[id]) || STAGES.neonIsland;
}
