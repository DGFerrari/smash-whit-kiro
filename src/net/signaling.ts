/**
 * Cliente de SIGNALING para el online P2P. Habla por WebSocket con el servidor
 * (/api/online/ws) solo para EMPAREJAR a dos jugadores e intercambiar los
 * mensajes de presentación de WebRTC. Una vez conectados P2P, la partida va
 * directa entre navegadores y esto deja de usarse (salvo para detectar cierres).
 *
 * Mensajes del servidor: created/joined/peer-joined/peer-left/signal/error
 * (ver server/src/online/routes.ts).
 */

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";

/** URL del WebSocket a partir de la base HTTP (http->ws, https->wss). */
function wsUrl(): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/api/online/ws`;
}

export type Role = "host" | "guest";

export interface SignalingHandlers {
  /** Sala creada (eres host): te da el código para compartir. */
  onCreated?: (code: string) => void;
  /** Te uniste a una sala (eres guest). */
  onJoined?: (code: string) => void;
  /** El otro jugador entró en tu sala (lo recibe el host). */
  onPeerJoined?: () => void;
  /** El otro jugador se fue / se desconectó. */
  onPeerLeft?: () => void;
  /** Mensaje de WebRTC reenviado por el peer (oferta/respuesta/ICE). */
  onSignal?: (data: unknown) => void;
  /** Error del signaling (sala no encontrada / llena / conexión caída). */
  onError?: (reason: string) => void;
}

export class SignalingClient {
  private ws: WebSocket | null = null;

  constructor(private readonly handlers: SignalingHandlers) {}

  /** Abre el WebSocket y ejecuta `onOpen` cuando esté listo. */
  private connect(onOpen: () => void): void {
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", (e) => {
      let msg: { type?: string; code?: string; data?: unknown; reason?: string };
      try {
        msg = JSON.parse(e.data as string) as typeof msg;
      } catch {
        return;
      }
      switch (msg.type) {
        case "created":
          this.handlers.onCreated?.(msg.code ?? "");
          break;
        case "joined":
          this.handlers.onJoined?.(msg.code ?? "");
          break;
        case "peer-joined":
          this.handlers.onPeerJoined?.();
          break;
        case "peer-left":
          this.handlers.onPeerLeft?.();
          break;
        case "signal":
          this.handlers.onSignal?.(msg.data);
          break;
        case "error":
          this.handlers.onError?.(msg.reason ?? "unknown");
          break;
      }
    });
    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = null;
    });
    ws.addEventListener("error", () => this.handlers.onError?.("ws-error"));
  }

  /** Crea una sala nueva (serás host). */
  createRoom(): void {
    this.connect(() => this.send({ type: "create" }));
  }

  /** Se une a una sala existente por código (serás guest). */
  joinRoom(code: string): void {
    this.connect(() => this.send({ type: "join", code: code.trim().toUpperCase() }));
  }

  /** Envía un mensaje de WebRTC al peer (a través del servidor). */
  sendSignal(data: unknown): void {
    this.send({ type: "signal", data });
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Cierra el signaling (tras establecer el P2P ya no hace falta, pero lo
   *  mantenemos abierto para enterarnos si el peer se va). */
  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
