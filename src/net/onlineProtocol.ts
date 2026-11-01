import type { CharacterId } from "../engine/game/characters.ts";
import type { StageId } from "../engine/game/stages.ts";
import type { ReplayData } from "../engine/game/replay.ts";

/** Resumen por combatiente para la pantalla de fin de partida online. */
export interface OnlineFighterResult {
  slot: number;
  label: string;
  color: string;
  character: CharacterId;
  dealt: number;
  taken: number;
  blocked: number;
  kos: number;
  deaths: number;
  isWinner: boolean;
}

/**
 * Protocolo del LOBBY online (topología estrella). El HOST mantiene el estado
 * autoritativo del lobby y lo DIFUNDE entero cuando cambia; los guests mandan
 * al host sus acciones. Así con N jugadores todos ven lo mismo sin lógica de
 * merge compleja.
 *
 * Mensajes de LOBBY (prefijo "L" + JSON). Van aparte del protocolo de PARTIDA
 * (inputs "gi:/hf:", texto plano por rendimiento).
 */

/** Estado completo del lobby (lo difunde el host). */
export interface LobbyState {
  /** Fase actual. */
  phase: "characters" | "stage";
  /** Personaje elegido por cada slot (null = sin elegir / vacío). */
  picks: Array<CharacterId | null>;
  /** Qué slots están ocupados (true/false por índice). */
  occupied: boolean[];
  /** Apodo mostrado de cada slot (o "" si vacío). */
  names: string[];
  /** Mapa elegido (fase stage). */
  stage: StageId;
}

export type LobbyMsg =
  // guest -> host: me presento con mi apodo (al entrar).
  | { t: "hello"; name: string }
  // guest -> host: he elegido este personaje.
  | { t: "pick"; character: CharacterId }
  // host -> todos: estado completo del lobby.
  | { t: "state"; state: LobbyState }
  // host -> todos: arrancad la partida con esta config.
  | { t: "start"; seed: number; characters: CharacterId[]; stage: StageId; names: string[] }
  // host -> todos: la partida terminó. Lleva el resultado y el replay COMPLETO
  // (para que cada cliente lo envíe al servidor a puntuar con su slot).
  | {
      t: "result";
      winnerSlot: number;
      draw: boolean;
      results: OnlineFighterResult[];
      replay: ReplayData;
    }
  // guest -> host: he aceptado el resultado (listo para seguir).
  | { t: "confirm"; slot: number }
  // host -> todos: quién ha aceptado ya (para pintar la lista en todos).
  | { t: "confirmed"; slots: number[] }
  // host -> todos: acción post-partida (revancha o volver al lobby).
  | { t: "post"; action: "rematch" | "lobby" };

export function encodeLobby(msg: LobbyMsg): string {
  return "L" + JSON.stringify(msg);
}

export function decodeLobby(data: string): LobbyMsg | null {
  if (!data.startsWith("L")) return null;
  try {
    return JSON.parse(data.slice(1)) as LobbyMsg;
  } catch {
    return null;
  }
}
