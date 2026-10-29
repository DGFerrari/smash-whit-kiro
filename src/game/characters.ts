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

/** Ids estables de personaje (NO cambiar: se guardan en los replays). */
export type CharacterId = "blue" | "red" | "yellow" | "green" | "sandbag";

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
  sandbag: { id: "sandbag", name: "Saco", color: "#d8b48a", sandbag: true },
};

/** Personajes seleccionables en el modo batalla (en orden de parrilla). */
export const SELECTABLE_CHARACTERS: CharacterId[] = ["blue", "red", "yellow", "green"];

/** Devuelve la definición de un personaje, con un fallback seguro. */
export function getCharacter(id: CharacterId | undefined): CharacterDef {
  return (id && CHARACTERS[id]) || CHARACTERS.blue;
}
