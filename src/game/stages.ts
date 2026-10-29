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

/** Estilo de fondo que dibuja el renderer. */
export type StageBackdrop = "neonCity" | "grid" | "sunset" | "void";

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
  sunsetIsland: {
    id: "sunsetIsland",
    name: "Isla Ocaso",
    kind: "island",
    backdrop: "sunset",
    theme: { solidSide: 0x6b3a2e, solidTop: 0xc27b4a, oneWay: 0xffb36b, background: 0x3a1430 },
  },
  voidIsland: {
    id: "voidIsland",
    name: "Isla Vacío",
    kind: "island",
    backdrop: "void",
    theme: { solidSide: 0x2a2f3a, solidTop: 0x4a5566, oneWay: 0x9fe6d0, background: 0x05060a },
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
