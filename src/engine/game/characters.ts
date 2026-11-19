/**
 * Registro de PERSONAJES.
 *
 * De momento todos los luchadores se comportan EXACTAMENTE IGUAL (misma física,
 * mismos ataques). La gracia de tenerlos como definiciones separadas es poder
 * darles movimientos especiales distintos en el futuro sin tocar el resto del
 * juego: cada personaje tiene su id estable (que se guarda en el replay) y sus
 * datos de presentación (nombre, color). Cuando toque, se le añadirá aquí su
 * set de ataques/especial.
 *
 * El "sandbag" es un personaje EXCLUSIVO de entrenamiento (el saco de boxeo de
 * Smash): mismo cuerpo y física, pero es el muñeco de pruebas.
 */

/**
 * Ids estables de personaje (NO cambiar los existentes: se guardan en los
 * replays). Añadir ids nuevos es seguro: todos comparten física y ataques.
 */
export type CharacterId =
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "kael"
  | "nova"
  | "rook"
  | "kaito"
  | "taro"
  | "bolt"
  | "gloop"
  | "unit7"
  | "sandbag";

export interface CharacterDef {
  id: CharacterId;
  /** Nombre visible en el selector y el HUD. */
  name: string;
  /** Color identificativo (cuerpo, HUD, flecha). */
  color: string;
  /** ¿Es el muñeco de entrenamiento? (no seleccionable en batalla). */
  sandbag?: boolean;
}

/** Catálogo de personajes jugables + el sandbag de entrenamiento. */
export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  blue: { id: "blue", name: "Azul", color: "#7fb2ff" },
  red: { id: "red", name: "Rojo", color: "#c45b7a" },
  yellow: { id: "yellow", name: "Amarillo", color: "#f0c23a" },
  green: { id: "green", name: "Verde", color: "#5fcf80" },
  kael: { id: "kael", name: "Kael", color: "#24c8b4" },
  nova: { id: "nova", name: "Nova", color: "#ff5fd2" },
  rook: { id: "rook", name: "Rook", color: "#8f7dff" },
  kaito: { id: "kaito", name: "Kaito", color: "#ff7a2f" },
  taro: { id: "taro", name: "Taro", color: "#4a6bff" },
  bolt: { id: "bolt", name: "Bolt", color: "#d9ff3a" },
  gloop: { id: "gloop", name: "Gloop", color: "#40e8ff" },
  unit7: { id: "unit7", name: "Unit-7", color: "#c8d0e0" },
  sandbag: { id: "sandbag", name: "Saco", color: "#d8b48a", sandbag: true },
};

/** Personajes originales de KiroBrawl (en orden de parrilla). */
export const ORIGINAL_CHARACTERS: CharacterId[] = ["kael", "red", "yellow", "green", "nova", "rook", "kaito", "taro"];
/** Personajes invitados (crossover), al final de la parrilla. */
export const CROSSOVER_CHARACTERS: CharacterId[] = ["blue", "bolt", "gloop", "unit7"];

/** Personajes seleccionables en el modo batalla (en orden de parrilla). */
export const SELECTABLE_CHARACTERS: CharacterId[] = [...ORIGINAL_CHARACTERS, ...CROSSOVER_CHARACTERS];

/** Devuelve la definición de un personaje, con un fallback seguro. */
export function getCharacter(id: CharacterId | undefined): CharacterDef {
  return (id && CHARACTERS[id]) || CHARACTERS.blue;
}
