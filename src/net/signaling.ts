/**
 * Cliente de SIGNALING para el online P2P (topología estrella). Habla por
 * WebSocket con el servidor solo para emparejar e intercambiar los mensajes de
 * WebRTC entre el host (slot 0) y cada guest (slots 1..3).
 */

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";

function wsUrl(): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/api/online/ws`;
}

export interface SignalingHandlers {
  /** Sala creada (eres host, slot 0). */
  onCreated?: (code: string, slot: number) => void;
  /** Te uniste (eres guest), con tu slot asignado. */
  onJoined?: (code: string, slot: number) => void;
  /** Entró un guest en tu sala (lo recibe el host), con su slot. */
  onPeerJoined?: (slot: number) => void;
  /** Un miembro se fue (su slot). Si slot 0 = el host: la sala se cerró. */
  onPeerLeft?: (slot: number) => void;
  /** Mensaje WebRTC reenviado por otro miembro (con su slot de origen). */
  onSignal?: (from: number, data: unknown) => void;
  /** Error del signaling (sala no encontrada / llena / conexión caída). */
  onError?: (reason: string) => void;
}

export class SignalingClient {
  private ws: WebSocket | null = null;

  constructor(private readonly handlers: SignalingHandlers) {}

  private connect(onOpen: () => void): void {
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", (e) => {
      let msg: {
        type?: string;
        code?: string;
        slot?: number;
        from?: number;
        data?: unknown;
        reason?: string;
      };
      try {
        msg = JSON.parse(e.data as string) as typeof msg;
      } catch {
        return;
      }
      switch (msg.type) {
        case "created":
          this.handlers.onCreated?.(msg.code ?? "", msg.slot ?? 0);
          break;
        case "joined":
          this.handlers.onJoined?.(msg.code ?? "", msg.slot ?? 1);
          break;
        case "peer-joined":
          this.handlers.onPeerJoined?.(msg.slot ?? -1);
          break;
        case "peer-left":
          this.handlers.onPeerLeft?.(msg.slot ?? -1);
          break;
        case "signal":
          this.handlers.onSignal?.(msg.from ?? -1, msg.data);
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

  createRoom(): void {
    this.connect(() => this.send({ type: "create" }));
  }

  joinRoom(code: string): void {
    this.connect(() => this.send({ type: "join", code: code.trim().toUpperCase() }));
  }

  /** Envía un mensaje WebRTC dirigido a un slot concreto. */
  sendSignal(to: number, data: unknown): void {
    this.send({ type: "signal", to, data });
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
