import type { CharacterId } from "../engine/game/characters.ts";
import type { StageId } from "../engine/game/stages.ts";

/**
 * Protocolo de mensajes del LOBBY online (por el canal P2P). Se serializan como
 * JSON con un campo `t` (tipo). Separado del protocolo de la PARTIDA (inputs
 * "i:..." y config "cfg:..."), que son mensajes de texto plano por rendimiento.
 *
 * Modelo: cada jugador difunde SU selección de personaje; el HOST además dicta
 * la fase (personajes/mapa) y el mapa elegido, y el arranque de la partida.
 */

export type LobbyMsg =
  // Un jugador cambió su personaje seleccionado.
  | { t: "pick"; character: CharacterId }
  // (host) Cambia la fase del lobby.
  | { t: "phase"; phase: "characters" | "stage" }
  // (host) Resalta/elige un mapa (los guests lo ven en vivo).
  | { t: "stage"; stage: StageId }
  // (host) Arranca la partida con esta semilla y la config acordada.
  | { t: "start"; seed: number; characters: CharacterId[]; stage: StageId }
  // Fin de partida: este jugador confirma que vio el resultado.
  | { t: "confirm" }
  // (host) Tras confirmar todos: qué hacer (revancha o volver al lobby/menú).
  | { t: "post"; action: "rematch" | "lobby" };

/** Serializa un mensaje de lobby para enviarlo por el canal. */
export function encodeLobby(msg: LobbyMsg): string {
  return "L" + JSON.stringify(msg);
}

/** Intenta parsear un mensaje de lobby; null si no lo es. */
export function decodeLobby(data: string): LobbyMsg | null {
  if (!data.startsWith("L")) return null;
  try {
    return JSON.parse(data.slice(1)) as LobbyMsg;
  } catch {
    return null;
  }
}
