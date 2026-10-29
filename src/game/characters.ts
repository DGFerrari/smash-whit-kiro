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

/** Estados de animación lógicos que el render pide según el estado del jugador. */
export type AnimState =
  | "idle"
  | "run"
  | "jump"
  | "fall"
  | "attack"
  | "hit"
  | "shield";

/**
 * Modelo 3D (glTF/glb) opcional de un personaje.
 *
 * Coloca el .glb en `public/models/` y referencia la ruta en `url` (p. ej.
 * "/models/azul.glb"). Si un personaje no define `model`, se dibuja con el cubo
 * redondeado de siempre (fallback), así el juego sigue funcionando sin assets.
 */
export interface CharacterModel {
  /** Ruta del .glb (absoluta desde public/, p. ej. "/models/azul.glb"). */
  url: string;
  /**
   * Escala uniforme para ajustar el modelo a las unidades del juego. El cuerpo
   * del jugador mide 36x56 px; ajusta esto para que el modelo ocupe ~ese alto.
   */
  scale: number;
  /** Desplazamiento vertical (px de mundo) para alinear los pies con la caja. */
  offsetY?: number;
  /**
   * Hacia dónde mira el modelo "de fábrica" sobre el eje X: 1 si mira a +X
   * (derecha), -1 si mira a -X. Se usa para orientarlo según el facing.
   */
  forwardX?: 1 | -1;
  /** ¿Teñir el modelo con el color del personaje? (útil si es un modelo gris). */
  tint?: boolean;
  /**
   * Mapa de estado lógico -> nombre del clip de animación DENTRO del .glb.
   * Distintos modelos nombran sus clips distinto (p. ej. "Idle", "Armature|run").
   * Rellena los que tengas; los que falten caen a "idle".
   */
  clips?: Partial<Record<AnimState, string>>;
}

export interface CharacterDef {
  id: CharacterId;
  /** Nombre visible en el selector y el HUD. */
  name: string;
  /** Color identificativo (cuerpo, HUD, flecha). */
  color: string;
  /** ¿Es el muñeco de entrenamiento? (no seleccionable en batalla). */
  sandbag?: boolean;
  /** Modelo 3D opcional. Sin él, se usa el cubo redondeado. */
  model?: CharacterModel;
}

/**
 * Catálogo de personajes jugables + el sandbag de entrenamiento.
 *
 * Para dar un modelo 3D a un personaje, añade su campo `model`. Ejemplo (déjalo
 * comentado hasta tener el .glb en public/models/):
 *
 *   blue: {
 *     id: "blue", name: "Azul", color: "#7fb2ff",
 *     model: {
 *       url: "/models/azul.glb",
 *       scale: 56,            // ajústalo hasta que el alto cuadre
 *       offsetY: 0,           // sube/baja el modelo para pisar el suelo
 *       forwardX: 1,          // 1 si el modelo mira a la derecha de fábrica
 *       tint: false,
 *       clips: { idle: "Idle", run: "Run", jump: "Jump", fall: "Fall",
 *                attack: "Punch", hit: "Hit", shield: "Block" },
 *     },
 *   },
 */
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
