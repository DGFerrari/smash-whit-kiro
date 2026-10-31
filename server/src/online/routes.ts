import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import { createRoom, joinRoom, roomOf, peerOf, leave } from "./rooms.ts";

/**
 * Signaling del online P2P por WebSocket. Mensajes (JSON) cliente -> servidor:
 *   { type: "create" }                 crea una sala, devuelve el código.
 *   { type: "join", code }             se une a una sala existente.
 *   { type: "signal", data }           se REENVÍA tal cual al peer (WebRTC).
 *
 * Servidor -> cliente:
 *   { type: "created", code }          sala creada (eres host).
 *   { type: "joined", code }           te uniste (eres guest).
 *   { type: "peer-joined" }            el otro jugador entró (al host).
 *   { type: "peer-left" }              el otro jugador se fue.
 *   { type: "signal", data }           mensaje WebRTC reenviado del peer.
 *   { type: "error", reason }          algo falló (sala no existe/llena).
 */

function send(ws: WSContext, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket cerrado: ignorar */
  }
}

/** Crea el router del online. Recibe `upgradeWebSocket` del adaptador de Node. */
export function createOnlineRoutes(upgradeWebSocket: UpgradeWebSocket): Hono {
  const app = new Hono();

  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onMessage(evt, ws) {
        let msg: { type?: string; code?: string; data?: unknown };
        try {
          msg = JSON.parse(String(evt.data)) as typeof msg;
        } catch {
          return;
        }

        switch (msg.type) {
          case "create": {
            const code = createRoom(ws);
            send(ws, { type: "created", code });
            break;
          }
          case "join": {
            const code = (msg.code ?? "").toUpperCase();
            const res = joinRoom(code, ws);
            if (!res.ok) {
              send(ws, { type: "error", reason: res.reason });
              break;
            }
            send(ws, { type: "joined", code });
            const host = peerOf(res.room, ws);
            if (host) send(host.ws, { type: "peer-joined" });
            break;
          }
          case "signal": {
            // Reenvía el mensaje WebRTC al otro miembro de la sala.
            const room = roomOf(ws);
            if (!room) break;
            const peer = peerOf(room, ws);
            if (peer) send(peer.ws, { type: "signal", data: msg.data });
            break;
          }
          default:
            break;
        }
      },
      onClose(_evt, ws) {
        const peer = leave(ws);
        if (peer) send(peer.ws, { type: "peer-left" });
      },
    })),
  );

  return app;
}
