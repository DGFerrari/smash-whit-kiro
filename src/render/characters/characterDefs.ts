import { CHARACTERS, type CharacterId } from "../../engine/game/characters";
import type { AnimState } from "./animator";
import type { MaterialType } from "./materials";

/**
 * Definiciones visuales de los personajes (diseño: `CharacterVisualDef`).
 * El color dominante coincide con el color identificativo del motor (HUD,
 * flecha) y es exclusivo entre los cuatro seleccionables.
 */

export type FallbackSilhouette =
  | "lancer"
  | "luchador"
  | "brawler"
  | "mage"
  | "ranger"
  | "idol"
  | "tank"
  | "ninja"
  | "chef"
  | "pilot"
  | "slime"
  | "robot"
  | "sack";

export interface CharacterVisualDef {
  id: CharacterId;
  /** Relativo a `import.meta.env.BASE_URL`. */
  modelUrl: string;
  format: "gltf" | "vrm";
  dominantColor: string;
  materialMap: Record<string, MaterialType>;
  animationClips: Partial<Record<AnimState, string>>;
  fallback: { silhouette: FallbackSilhouette; accent: string };
  portraitSeed: number;
}

export const CHARACTER_VISUALS: Readonly<Record<CharacterId, CharacterVisualDef>> = {
  blue: {
    id: "blue",
    modelUrl: "models/characters/blue.glb",
    format: "gltf",
    dominantColor: CHARACTERS.blue.color,
    materialMap: {},
    animationClips: {},
    // Luchador enmascarado (Jugador 1).
    fallback: { silhouette: "luchador", accent: "#ff9a1f" },
    portraitSeed: 1101,
  },
  red: {
    id: "red",
    modelUrl: "models/characters/red.glb",
    format: "gltf",
    dominantColor: CHARACTERS.red.color,
    materialMap: {},
    animationClips: {},
    fallback: { silhouette: "brawler", accent: "#ff7a3d" },
    portraitSeed: 2203,
  },
  yellow: {
    id: "yellow",
    modelUrl: "models/characters/yellow.glb",
    format: "gltf",
    dominantColor: CHARACTERS.yellow.color,
    materialMap: {},
    animationClips: {},
    fallback: { silhouette: "mage", accent: "#7ff0ff" },
    portraitSeed: 3307,
  },
  green: {
    id: "green",
    modelUrl: "models/characters/green.glb",
    format: "gltf",
    dominantColor: CHARACTERS.green.color,
    materialMap: {},
    animationClips: {},
    fallback: { silhouette: "ranger", accent: "#f2e6c4" },
    portraitSeed: 4409,
  },
  kael: visual("kael", "lancer", "#e8c15a", 1201),
  nova: visual("nova", "idol", "#fff27a", 1303),
  rook: visual("rook", "tank", "#ffcf4a", 1409),
  kaito: visual("kaito", "ninja", "#e8263a", 1511),
  taro: visual("taro", "chef", "#ff6a2a", 1613),
  bolt: visual("bolt", "pilot", "#1c2030", 1717),
  gloop: visual("gloop", "slime", "#ffd23f", 1819),
  unit7: visual("unit7", "robot", "#ff3d5a", 1921),
  sandbag: {
    id: "sandbag",
    modelUrl: "models/characters/sandbag.glb",
    format: "gltf",
    dominantColor: CHARACTERS.sandbag.color,
    materialMap: {},
    animationClips: {},
    fallback: { silhouette: "sack", accent: "#d8453b" },
    portraitSeed: 5501,
  },
};

function visual(id: CharacterId, silhouette: FallbackSilhouette, accent: string, portraitSeed: number): CharacterVisualDef {
  return {
    id,
    modelUrl: `models/characters/${id}.glb`,
    format: "gltf",
    dominantColor: CHARACTERS[id].color,
    materialMap: {},
    animationClips: {},
    fallback: { silhouette, accent },
    portraitSeed,
  };
}

/** Definición visual de `id` (con `blue` como valor seguro). */
export function getCharacterVisual(id: CharacterId | undefined): CharacterVisualDef {
  return (id && CHARACTER_VISUALS[id]) || CHARACTER_VISUALS.blue;
}
