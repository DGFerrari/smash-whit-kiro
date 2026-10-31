import type { WSContext } from "hono/ws";

/**
 * Salas de SIGNALING para el online P2P (WebRTC). El servidor NO transporta la
 * partida: solo ayuda a que dos navegadores se encuentren e intercambien los
 * mensajes de presentación de WebRTC (oferta/respuesta/ICE). Una vez conectados
 * P2P, los datos del juego van directos entre ellos (gratis, sin pasar por aquí).
 *
 * Estado EN MEMORIA (no en BD): una sala es efímera, dura lo que la partida.
 * Cada sala tiene como mucho 2 miembros: host (quien la crea) y guest.
 */

export interface Member {
  ws: WSContext;
  role: "host" | "guest";
}

export interface Room {
  code: string;
  members: Member[];
  createdAt: number;
}

const rooms = new Map<string, Room>();

/** Genera un código de sala corto y legible (sin caracteres ambiguos). */
function genCode(): string {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0/I/1
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

/** Crea una sala nueva con `ws` como host. Devuelve el código. */
export function createRoom(ws: WSContext): string {
  const code = genCode();
  rooms.set(code, { code, members: [{ ws, role: "host" }], createdAt: Date.now() });
  return code;
}

/** Resultado de intentar unirse a una sala. */
export type JoinResult =
  | { ok: true; room: Room }
  | { ok: false; reason: "not-found" | "full" };

/** Une `ws` a la sala `code` como guest. */
export function joinRoom(code: string, ws: WSContext): JoinResult {
  const room = rooms.get(code);
  if (!room) return { ok: false, reason: "not-found" };
  if (room.members.length >= 2) return { ok: false, reason: "full" };
  room.members.push({ ws, role: "guest" });
  return { ok: true, room };
}

/** Devuelve la sala en la que está este ws (o null). */
export function roomOf(ws: WSContext): Room | null {
  for (const room of rooms.values()) {
    if (room.members.some((m) => m.ws === ws)) return room;
  }
  return null;
}

/** El "otro" miembro de la sala (el peer), o null si está solo. */
export function peerOf(room: Room, ws: WSContext): Member | null {
  return room.members.find((m) => m.ws !== ws) ?? null;
}

/** Quita a `ws` de su sala; si queda vacía, la elimina. Devuelve el peer que quedaba. */
export function leave(ws: WSContext): Member | null {
  const room = roomOf(ws);
  if (!room) return null;
  room.members = room.members.filter((m) => m.ws !== ws);
  const peer = room.members[0] ?? null;
  if (room.members.length === 0) rooms.delete(room.code);
  return peer;
}

/** Limpia salas viejas que quedaron huérfanas (red de seguridad). */
export function sweepStaleRooms(maxAgeMs = 1000 * 60 * 30): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > maxAgeMs) rooms.delete(code);
  }
}
