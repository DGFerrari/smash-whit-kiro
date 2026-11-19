/**
 * Modelos GLTF de personajes (R11.1, R14).
 *
 * Fuente: KayKit Character Pack: Adventurers 1.0, de Kay Lousberg
 * (www.kaylousberg.com), licencia CC0 1.0. Archivos sin modificar en
 * `public/models/characters/`. El saco de entrenamiento no tiene modelo
 * externo: usa siempre el Modelo_Respaldo procedimental.
 *
 * Cada modelo trae todos los accesorios del pack; `keepNodes` indica cuáles
 * se muestran (el resto se oculta). Los clips del pack se asignan a los
 * estados de animación del juego; `timeScale` acelera los ataques para que
 * duren lo mismo que en la simulación.
 */
import type { CharacterId } from "../../engine/game/characters.ts";
import type { AnimState } from "./animator.ts";

export interface CharacterModelAsset {
  url: string;
  sizeHint: number;
  /** Accesorios visibles (el resto de nodos con malla de arma/accesorio se ocultan). */
  keepNodes: readonly string[];
  /** Nodos que son accesorios del pack (candidatos a ocultarse). */
  accessoryNodes: readonly string[];
  clips: Partial<Record<AnimState, string>>;
  timeScale: Partial<Record<AnimState, number>>;
}

const COMMON_CLIPS: Partial<Record<AnimState, string>> = {
  idle: "Idle",
  run: "Running_A",
  jump: "Jump_Idle",
  fall: "Jump_Idle",
  shield: "Blocking",
  dodge: "Dodge_Forward",
  stun: "Hit_A",
  wallSlide: "Jump_Idle",
  celebrate: "Cheer",
  charge: "2H_Melee_Idle",
};

const COMMON_SPEED: Partial<Record<AnimState, number>> = {
  light: 1.9,
  heavy: 1.5,
  dodge: 1.7,
  stun: 1.4,
  run: 1.25,
};

/**
 * Modelos externos DESACTIVADOS: el juego usa los personajes procedimentales
 * (fallbackModel.ts). Para reactivarlos, vuelve a descargar los .glb del pack
 * KayKit en `public/models/characters/`, añade su entrada en `credits.json` y
 * pon esto a `true`.
 */
const USE_EXTERNAL_MODELS = false;

const KAYKIT_MODELS: Partial<Record<CharacterId, CharacterModelAsset>> = {
  // Azul — Caballero con espadón y capa.
  blue: {
    url: "models/characters/blue.glb",
    sizeHint: 3659532,
    accessoryNodes: ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Round_Shield", "Spike_Shield", "1H_Sword", "2H_Sword", "Knight_Helmet", "Knight_Cape"],
    keepNodes: ["2H_Sword", "Knight_Helmet", "Knight_Cape"],
    clips: { ...COMMON_CLIPS, idle: "2H_Melee_Idle", light: "1H_Melee_Attack_Stab", heavy: "2H_Melee_Attack_Slice" },
    timeScale: COMMON_SPEED,
  },
  // Vesper — Bárbara a puño limpio.
  red: {
    url: "models/characters/red.glb",
    sizeHint: 3613268,
    accessoryNodes: ["1H_Axe_Offhand", "Barbarian_Round_Shield", "1H_Axe", "2H_Axe", "Mug", "Barbarian_Hat", "Barbarian_Cape"],
    keepNodes: ["Barbarian_Cape"],
    clips: { ...COMMON_CLIPS, idle: "Unarmed_Idle", charge: "Unarmed_Idle", light: "Unarmed_Melee_Attack_Punch_A", heavy: "Unarmed_Melee_Attack_Kick" },
    timeScale: COMMON_SPEED,
  },
  // Sol — Mago con bastón.
  yellow: {
    url: "models/characters/yellow.glb",
    sizeHint: 3589240,
    accessoryNodes: ["Spellbook", "Spellbook_open", "1H_Wand", "2H_Staff", "Mage_Hat", "Mage_Cape"],
    keepNodes: ["2H_Staff", "Mage_Hat", "Mage_Cape"],
    clips: { ...COMMON_CLIPS, charge: "Spellcasting", light: "Spellcast_Shoot", heavy: "Spellcast_Long" },
    timeScale: { ...COMMON_SPEED, heavy: 2.4 },
  },
  // Ivy — Pícara encapuchada con dos cuchillos.
  green: {
    url: "models/characters/green.glb",
    sizeHint: 3597652,
    accessoryNodes: ["Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Knife", "Throwable", "Rogue_Cape"],
    keepNodes: ["Knife_Offhand", "Knife", "Rogue_Cape"],
    clips: { ...COMMON_CLIPS, light: "Dualwield_Melee_Attack_Stab", heavy: "Dualwield_Melee_Attack_Slice" },
    timeScale: COMMON_SPEED,
  },
};

export const CHARACTER_MODELS: Partial<Record<CharacterId, CharacterModelAsset>> = USE_EXTERNAL_MODELS
  ? KAYKIT_MODELS
  : {};

/** Id del asset del modelo en el AssetLoader. */
export function modelAssetId(id: CharacterId): string {
  return `model:${id}`;
}
