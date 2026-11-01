import type { WSContext } from "hono/ws";

/**
 * Salas de SIGNALING para el online P2P (WebRTC), topología ESTRELLA: el host
 * (slot 0) se conecta por WebRTC con cada guest (slots 1..3). El servidor solo
 * ayuda a emparejar e intercambiar los mensajes de presentación de WebRTC; la
 * partida va P2P (los guests mandan su input al host y el host redistribuye).
 *
 * Hasta 4 miembros por sala. Estado EN MEMORIA (efímero).
 */

export interface Member {
  ws: WSContext;
  /** 0 = host; 1..3 = guests. Es el índice de jugador en la partida. */
  slot: number;
}

export interface Room {
  code: string;
  members: Member[];
  createdAt: number;
}

const MAX_SLOTS = 4;
const rooms = new Map<string, Room>();

function genCode(): string {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}

/** Crea una sala con `ws` como host (slot 0). Devuelve el código. */
export function createRoom(ws: WSContext): string {
  const code = genCode();
  rooms.set(code, { code, members: [{ ws, slot: 0 }], createdAt: Date.now() });
  return code;
}

export type JoinResult =
  | { ok: true; room: Room; slot: number }
  | { ok: false; reason: "not-found" | "full" };

/** Une `ws` a la sala como guest, asignándole el primer slot libre (1..3). */
export function joinRoom(code: string, ws: WSContext): JoinResult {
  const room = rooms.get(code);
  if (!room) return { ok: false, reason: "not-found" };
  if (room.members.length >= MAX_SLOTS) return { ok: false, reason: "full" };
  // Primer slot libre.
  const used = new Set(room.members.map((m) => m.slot));
  let slot = 1;
  while (used.has(slot) && slot < MAX_SLOTS) slot++;
  room.members.push({ ws, slot });
  return { ok: true, room, slot };
}

/** La sala en la que está este ws (o null). */
export function roomOf(ws: WSContext): Room | null {
  for (const room of rooms.values()) {
    if (room.members.some((m) => m.ws === ws)) return room;
  }
  return null;
}

/** El miembro host (slot 0) de una sala. */
export function hostOf(room: Room): Member | null {
  return room.members.find((m) => m.slot === 0) ?? null;
}

/** El miembro con un slot concreto. */
export function memberBySlot(room: Room, slot: number): Member | null {
  return room.members.find((m) => m.slot === slot) ?? null;
}

/** El slot de un ws en su sala (o -1). */
export function slotOf(room: Room, ws: WSContext): number {
  return room.members.find((m) => m.ws === ws)?.slot ?? -1;
}

/**
 * Quita a `ws` de su sala. Devuelve { room, slot, wasHost, remaining } para que
 * el handler avise a los demás. Si la sala queda vacía o se va el host, se
 * elimina (sin host no hay partida en estrella).
 */
export function leave(
  ws: WSContext,
): { room: Room; slot: number; wasHost: boolean; remaining: Member[] } | null {
  const room = roomOf(ws);
  if (!room) return null;
  const slot = slotOf(room, ws);
  const wasHost = slot === 0;
  room.members = room.members.filter((m) => m.ws !== ws);
  const remaining = room.members.slice();
  if (wasHost || room.members.length === 0) rooms.delete(room.code);
  return { room, slot, wasHost, remaining };
}

export function sweepStaleRooms(maxAgeMs = 1000 * 60 * 30): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > maxAgeMs) rooms.delete(code);
  }
}
