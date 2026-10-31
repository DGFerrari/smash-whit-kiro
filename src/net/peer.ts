import { SignalingClient, type SignalingHandlers } from "./signaling.ts";

/**
 * Conexión P2P por WebRTC entre dos navegadores, usando el signaling solo para
 * emparejar. Una vez abierto el DataChannel, los mensajes (inputs del juego)
 * van DIRECTOS entre los dos clientes, sin pasar por el servidor.
 *
 * Flujo (lo orquesta esta clase):
 *  - host: crea sala -> al entrar el guest, crea el DataChannel y la oferta.
 *  - guest: se une -> recibe la oferta, responde, y recibe el canal.
 *  - ambos: intercambian candidatos ICE por el signaling según aparecen.
 *
 * Sin TURN (solo STUN público): en la mayoría de redes domésticas basta para
 * conectar P2P; en algunas NAT muy estrictas podría fallar (aceptable para
 * portafolio/amigos).
 */

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export interface PeerHandlers {
  /** Sala creada (host): comparte este código con el amigo. */
  onRoomCode?: (code: string) => void;
  /** El canal P2P está abierto y listo para enviar/recibir. */
  onConnected?: (role: "host" | "guest") => void;
  /** Mensaje recibido del peer por el canal de datos. */
  onMessage?: (data: string) => void;
  /** La conexión se cerró o el peer se fue. */
  onClosed?: (reason: string) => void;
  /** Error (sala no encontrada/llena, fallo de conexión…). */
  onError?: (reason: string) => void;
}

export class PeerConnection {
  private signaling: SignalingClient;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private role: "host" | "guest" = "host";
  private connected = false;
  /** Manejador activo de mensajes del canal (reemplazable con setMessageHandler). */
  private messageHandler: ((data: string) => void) | null = null;
  /** Manejador activo de cierre (reemplazable con setClosedHandler). */
  private closedHandler: ((reason: string) => void) | null = null;

  constructor(private readonly handlers: PeerHandlers) {
    const sig: SignalingHandlers = {
      onCreated: (code) => this.handlers.onRoomCode?.(code),
      onJoined: () => {
        /* el guest ya está listo; espera la oferta del host */
      },
      onPeerJoined: () => {
        // El guest entró en la sala del host: el host inicia la negociación.
        void this.startAsHost();
      },
      onPeerLeft: () => this.emitClosed("peer-left"),
      onSignal: (data) => void this.onSignal(data as SignalMessage),
      onError: (reason) => this.handlers.onError?.(reason),
    };
    this.signaling = new SignalingClient(sig);
  }

  /** Crea una sala y espera a que se una el amigo (serás host). */
  host(): void {
    this.role = "host";
    this.signaling.createRoom();
  }

  /** Se une a una sala por código (serás guest). */
  join(code: string): void {
    this.role = "guest";
    this.signaling.joinRoom(code);
  }

  /** Envía un mensaje al peer por el canal P2P (si está abierto). */
  send(data: string): void {
    if (this.channel?.readyState === "open") this.channel.send(data);
  }

  /**
   * Reemplaza el manejador de mensajes del canal (lo usa el bucle online para
   * recibir los inputs una vez establecida la conexión, en vez del onMessage
   * genérico que se pasó al construir).
   */
  setMessageHandler(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  /** Reemplaza el manejador de cierre/desconexión (lo usa el bucle online). */
  setClosedHandler(handler: (reason: string) => void): void {
    this.closedHandler = handler;
  }

  /** Cierra todo (canal, conexión, signaling). */
  close(): void {
    this.channel?.close();
    this.pc?.close();
    this.signaling.close();
    this.channel = null;
    this.pc = null;
  }

  // --- Negociación WebRTC ---------------------------------------------------

  private createPc(): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    // Enviamos cada candidato ICE al peer según los descubre el navegador.
    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) {
        this.signaling.sendSignal({ kind: "ice", candidate: e.candidate.toJSON() });
      }
    });
    pc.addEventListener("connectionstatechange", () => {
      const st = pc.connectionState;
      if (st === "failed" || st === "disconnected" || st === "closed") {
        if (this.connected) this.emitClosed(st);
        else this.handlers.onError?.("connection-" + st);
      }
    });
    return pc;
  }

  /** Host: crea el DataChannel y la oferta. */
  private async startAsHost(): Promise<void> {
    const pc = this.createPc();
    const channel = pc.createDataChannel("game", { ordered: true });
    this.setupChannel(channel);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.sendSignal({ kind: "offer", sdp: offer });
  }

  /** Procesa un mensaje de signaling (oferta/respuesta/ICE del peer). */
  private async onSignal(msg: SignalMessage): Promise<void> {
    if (msg.kind === "offer") {
      // Guest: recibe la oferta, prepara la conexión y responde.
      const pc = this.createPc();
      pc.addEventListener("datachannel", (e) => this.setupChannel(e.channel));
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signaling.sendSignal({ kind: "answer", sdp: answer });
    } else if (msg.kind === "answer") {
      // Host: recibe la respuesta del guest.
      await this.pc?.setRemoteDescription(msg.sdp);
    } else if (msg.kind === "ice") {
      try {
        await this.pc?.addIceCandidate(msg.candidate);
      } catch {
        /* candidato tardío o inválido: ignorar */
      }
    }
  }

  private setupChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.addEventListener("open", () => {
      this.connected = true;
      this.handlers.onConnected?.(this.role);
    });
    channel.addEventListener("message", (e) => {
      const data = String(e.data);
      // Prioridad al handler activo (el bucle online); si no, el genérico.
      if (this.messageHandler) this.messageHandler(data);
      else this.handlers.onMessage?.(data);
    });
    channel.addEventListener("close", () => {
      if (this.connected) this.emitClosed("channel-closed");
    });
  }

  /** Avisa de un cierre al handler activo (loop online) o al genérico. */
  private emitClosed(reason: string): void {
    if (this.closedHandler) this.closedHandler(reason);
    else this.handlers.onClosed?.(reason);
  }
}

/** Mensajes de WebRTC que viajan por el signaling. */
type SignalMessage =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };
