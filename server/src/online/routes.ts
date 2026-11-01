import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import {
  createRoom,
  joinRoom,
  roomOf,
  hostOf,
  memberBySlot,
  slotOf,
  leave,
} from "./rooms.ts";

/**
 * Signaling del online P2P (topología ESTRELLA). El servidor empareja e
 * intercambia los mensajes de WebRTC entre el host (slot 0) y cada guest.
 *
 * Cliente -> servidor:
 *   { type: "create" }                      crea sala (serás host, slot 0).
 *   { type: "join", code }                  te unes (te asignan un slot 1..3).
 *   { type: "signal", to, data }            WebRTC dirigido a un slot concreto.
 *
 * Servidor -> cliente:
 *   { type: "created", code, slot: 0 }
 *   { type: "joined", code, slot }          (y al host: { peer-joined, slot })
 *   { type: "peer-joined", slot }           entró un guest (lo recibe el host).
 *   { type: "peer-left", slot }             se fue un miembro.
 *   { type: "signal", from, data }          WebRTC reenviado (con el slot origen).
 *   { type: "error", reason }
 */

function send(ws: WSContext, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket cerrado */
  }
}

export function createOnlineRoutes(upgradeWebSocket: UpgradeWebSocket): Hono {
  const app = new Hono();

  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onMessage(evt, ws) {
        let msg: { type?: string; code?: string; to?: number; data?: unknown };
        try {
          msg = JSON.parse(String(evt.data)) as typeof msg;
        } catch {
          return;
        }

        switch (msg.type) {
          case "create": {
            const code = createRoom(ws);
            send(ws, { type: "created", code, slot: 0 });
            break;
          }
          case "join": {
            const code = (msg.code ?? "").toUpperCase();
            const res = joinRoom(code, ws);
            if (!res.ok) {
              send(ws, { type: "error", reason: res.reason });
              break;
            }
            send(ws, { type: "joined", code, slot: res.slot });
            // Avisamos al host (y solo al host) de que entró un guest.
            const host = hostOf(res.room);
            if (host) send(host.ws, { type: "peer-joined", slot: res.slot });
            break;
          }
          case "signal": {
            // Reenvía el mensaje WebRTC al slot destino, anotando el origen.
            const room = roomOf(ws);
            if (!room) break;
            const from = slotOf(room, ws);
            const dest = memberBySlot(room, msg.to ?? -1);
            if (dest) send(dest.ws, { type: "signal", from, data: msg.data });
            break;
          }
          default:
            break;
        }
      },
      onClose(_evt, ws) {
        const res = leave(ws);
        if (!res) return;
        // Avisa a los que quedan. Si se fue el host, la sala se cerró: todos
        // reciben peer-left del host (slot 0) y deben salir.
        for (const m of res.remaining) {
          send(m.ws, { type: "peer-left", slot: res.slot });
        }
      },
    })),
  );

  return app;
}
