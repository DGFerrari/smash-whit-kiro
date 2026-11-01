import { SignalingClient } from "./signaling.ts";

/**
 * Red del online P2P en topología ESTRELLA (hasta 4 jugadores).
 *
 *  - El HOST (slot 0) mantiene una conexión WebRTC con CADA guest.
 *  - Cada GUEST mantiene UNA conexión con el host.
 *  - Para que dos guests "se hablen", el host hace de relay (a nivel de juego,
 *    no de red): el bucle de partida reenvía inputs. Aquí solo gestionamos los
 *    canales de datos y a quién se envía.
 *
 * Sin TURN (solo STUN público): en la mayoría de redes domésticas conecta P2P;
 * en NAT muy estrictas podría fallar (aceptable para portafolio/amigos).
 */

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export interface NetworkHandlers {
  /** Sala creada (host): comparte este código. */
  onRoomCode?: (code: string) => void;
  /** Tu slot asignado (0 = host, 1..3 = guest). */
  onSlot?: (slot: number) => void;
  /** Un canal P2P con `slot` quedó listo. */
  onPeerConnected?: (slot: number) => void;
  /** Mensaje recibido de `from` (slot). */
  onMessage?: (from: number, data: string) => void;
  /** Un miembro se fue (slot). slot 0 = host → la sala se cerró. */
  onPeerLeft?: (slot: number) => void;
  /** Error (sala no encontrada/llena, fallo de conexión…). */
  onError?: (reason: string) => void;
}

/** Una conexión WebRTC con un peer concreto (identificado por su slot). */
class PeerLink {
  readonly pc: RTCPeerConnection;
  channel: RTCDataChannel | null = null;
  open = false;
  /** ¿Ya tenemos descripción remota? Hasta entonces, encolamos los ICE. */
  remoteReady = false;
  /** Candidatos ICE llegados antes que la descripción remota. */
  readonly pendingIce: RTCIceCandidateInit[] = [];
  /** ¿Ya avisamos del cierre de este link? (evita avisos duplicados). */
  closedNotified = false;

  constructor(
    readonly slot: number,
    private readonly signaling: SignalingClient,
    private readonly net: OnlineNetwork,
  ) {
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) {
        this.signaling.sendSignal(this.slot, { kind: "ice", candidate: e.candidate.toJSON() });
      }
    });
    this.pc.addEventListener("connectionstatechange", () => {
      const st = this.pc.connectionState;
      if (st === "failed" || st === "disconnected" || st === "closed") {
        this.net.handleLinkClosed(this.slot);
      }
    });
  }

  attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.addEventListener("open", () => {
      this.open = true;
      this.net.handleLinkOpen(this.slot);
    });
    channel.addEventListener("message", (e) => this.net.handleMessage(this.slot, String(e.data)));
    channel.addEventListener("close", () => {
      this.net.handleLinkClosed(this.slot);
    });
  }

  send(data: string): void {
    if (this.channel?.readyState === "open") this.channel.send(data);
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
  }
}

export class OnlineNetwork {
  private signaling: SignalingClient;
  mySlot = 0;
  /** Conexiones por slot del peer. */
  private links = new Map<number, PeerLink>();
  /** Handlers activos reemplazables (los usa el bucle de partida). */
  private messageHandler: ((from: number, data: string) => void) | null = null;
  private peerLeftHandler: ((slot: number) => void) | null = null;
  private peerConnectedHandler: ((slot: number) => void) | null = null;

  constructor(private readonly handlers: NetworkHandlers) {
    this.signaling = new SignalingClient({
      onCreated: (code, slot) => {
        this.mySlot = slot;
        this.handlers.onRoomCode?.(code);
        this.handlers.onSlot?.(slot);
      },
      onJoined: (_code, slot) => {
        this.mySlot = slot;
        this.handlers.onSlot?.(slot);
        // El guest NO ofrece: espera la oferta del host (slot 0) y responde.
        // (El host es SIEMPRE el offerer para evitar "glare" de doble oferta.)
      },
      onPeerJoined: (slot) => {
        // Host: entró un guest → el host es offerer hacia ese guest.
        void this.startOffer(slot);
      },
      onPeerLeft: (slot) => {
        // El servidor avisa de que un miembro se fue. Pasa por el MISMO camino
        // deduplicado que los eventos de WebRTC (si el link no existe, p.ej. un
        // guest se fue antes de conectar su canal, avisamos igual una vez).
        this.dispatchPeerLeft(slot);
      },
      onSignal: (from, data) => void this.onSignal(from, data as SignalMessage),
      onError: (reason) => this.handlers.onError?.(reason),
    });
  }

  host(): void {
    this.signaling.createRoom();
  }

  join(code: string): void {
    this.signaling.joinRoom(code);
  }

  /** Reemplaza el handler de mensajes (lo usa el bucle de partida). */
  setMessageHandler(handler: (from: number, data: string) => void): void {
    this.messageHandler = handler;
  }

  /** Reemplaza el handler de "peer se fue" (lo usa el bucle de partida). */
  setPeerLeftHandler(handler: (slot: number) => void): void {
    this.peerLeftHandler = handler;
  }

  /** Reemplaza el handler de "canal P2P con slot listo". */
  setPeerConnectedHandler(handler: (slot: number) => void): void {
    this.peerConnectedHandler = handler;
    // Reavisa de los que ya estaban conectados (por si se registra tarde).
    for (const slot of this.connectedSlots()) handler(slot);
  }

  /** Envía a TODOS los peers conectados. */
  broadcast(data: string): void {
    for (const link of this.links.values()) link.send(data);
  }

  /** Envía a un slot concreto. */
  sendTo(slot: number, data: string): void {
    this.links.get(slot)?.send(data);
  }

  /** Slots de los peers con canal abierto (no incluye el mío). */
  connectedSlots(): number[] {
    return [...this.links.values()].filter((l) => l.open).map((l) => l.slot);
  }

  private closed = false;

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Soltamos los handlers del juego para que nada siga reaccionando tras cerrar.
    this.messageHandler = null;
    this.peerLeftHandler = null;
    this.peerConnectedHandler = null;
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.signaling.close();
  }

  // --- WebRTC ---------------------------------------------------------------

  /** Inicia una conexión como OFFERER hacia `slot` (crea el DataChannel). */
  private async startOffer(slot: number): Promise<void> {
    const link = new PeerLink(slot, this.signaling, this);
    this.links.set(slot, link);
    const channel = link.pc.createDataChannel("game", { ordered: true });
    link.attachChannel(channel);
    const offer = await link.pc.createOffer();
    await link.pc.setLocalDescription(offer);
    this.signaling.sendSignal(slot, { kind: "offer", sdp: offer });
  }

  /** Procesa un mensaje WebRTC del slot `from`. */
  private async onSignal(from: number, msg: SignalMessage): Promise<void> {
    let link = this.links.get(from);
    if (msg.kind === "offer") {
      // Somos el ANSWERER para este peer: creamos el link y respondemos.
      if (!link) {
        link = new PeerLink(from, this.signaling, this);
        this.links.set(from, link);
        link.pc.addEventListener("datachannel", (e) => link!.attachChannel(e.channel));
      }
      await link.pc.setRemoteDescription(msg.sdp);
      await this.flushIce(link);
      const answer = await link.pc.createAnswer();
      await link.pc.setLocalDescription(answer);
      this.signaling.sendSignal(from, { kind: "answer", sdp: answer });
    } else if (msg.kind === "answer") {
      if (!link) return;
      await link.pc.setRemoteDescription(msg.sdp);
      await this.flushIce(link);
    } else if (msg.kind === "ice") {
      // Si aún no hay descripción remota, encolamos el candidato.
      if (!link || !link.remoteReady) {
        link?.pendingIce.push(msg.candidate);
        return;
      }
      try {
        await link.pc.addIceCandidate(msg.candidate);
      } catch {
        /* candidato tardío: ignorar */
      }
    }
  }

  /** Marca la descripción remota como lista y vacía los ICE encolados. */
  private async flushIce(link: PeerLink): Promise<void> {
    link.remoteReady = true;
    const pending = link.pendingIce.splice(0);
    for (const cand of pending) {
      try {
        await link.pc.addIceCandidate(cand);
      } catch {
        /* candidato tardío: ignorar */
      }
    }
  }

  // Llamados por PeerLink.
  handleLinkOpen(slot: number): void {
    if (this.closed) return;
    this.handlers.onPeerConnected?.(slot);
    this.peerConnectedHandler?.(slot);
  }
  handleMessage(from: number, data: string): void {
    if (this.closed) return;
    if (this.messageHandler) this.messageHandler(from, data);
    else this.handlers.onMessage?.(from, data);
  }
  handleLinkClosed(slot: number): void {
    this.dispatchPeerLeft(slot);
  }

  /**
   * Punto ÚNICO de aviso de "peer se fue", DEDUPLICADO por slot. Un mismo cierre
   * llega por varias vías (señalización del servidor, `close` del datachannel y
   * `connectionstatechange` a failed/disconnected/closed); sin deduplicar, el
   * handler del juego recibía el aviso 2-3 veces y se bugueaba. Aquí marcamos el
   * link como notificado y solo avisamos la PRIMERA vez.
   */
  private dispatchPeerLeft(slot: number): void {
    if (this.closed) return;
    const link = this.links.get(slot);
    if (link) {
      if (link.closedNotified) return; // ya avisado: ignorar duplicados
      link.closedNotified = true;
      link.close();
      this.links.delete(slot);
    } else {
      // Sin link (p.ej. guest que se fue antes de conectar): dedup por un set.
      if (this.leftSlots.has(slot)) return;
      this.leftSlots.add(slot);
    }
    if (this.peerLeftHandler) this.peerLeftHandler(slot);
    else this.handlers.onPeerLeft?.(slot);
  }

  /** Slots ya avisados como "se fueron" que no tenían link (dedup auxiliar). */
  private readonly leftSlots = new Set<number>();
}

type SignalMessage =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };
