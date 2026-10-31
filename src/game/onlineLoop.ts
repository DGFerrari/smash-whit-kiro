import { FIXED_DT } from "../engine/config.ts";
import { createInputState, KeyboardInput, type InputState } from "../core/input.ts";
import { packInput, unpackInto } from "../engine/game/replay.ts";
import type { World } from "../engine/game/world.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import type { PeerConnection } from "../net/peer.ts";

/**
 * Bucle de partida ONLINE con LOCKSTEP + input-delay (2 jugadores).
 *
 * Ambos clientes simulan el MISMO mundo (misma semilla → determinista). Cada
 * cliente controla a UN jugador (host = índice 0, guest = índice 1) y recibe el
 * input del otro por el canal P2P. Para absorber la latencia usamos un RETARDO:
 * el input capturado en el frame N se aplica en el frame N+DELAY; así da tiempo
 * a que llegue el input del rival antes de necesitarlo. Un frame solo avanza
 * cuando tenemos los inputs de AMBOS para ese frame (si falta, esperamos).
 *
 * Mensajes por el canal (texto): "i:<frame>:<packed>" (input de un frame).
 */

const DELAY = 3; // frames de retardo de input (~50 ms a 60 Hz). Ajustable.

export interface OnlineLoopCallbacks {
  onGameOver?: (winnerIndex: number) => void;
  onCountdown?: (text: string | null) => void;
  onFinish?: () => void;
  /** Aviso de "esperando al rival" (la red va lenta): true = esperando. */
  onStall?: (stalled: boolean) => void;
  /** El rival se desconectó: la partida online no puede continuar. */
  onPeerLeft?: () => void;
}

export class OnlineLoop {
  private readonly input = new KeyboardInput("p1");
  private readonly scratch: InputState = createInputState();
  /** InputStates reutilizados que se pasan a world.step (uno por jugador). */
  private readonly stepInputs: InputState[] = [createInputState(), createInputState()];

  /** Inputs locales por frame (índice = frame). */
  private readonly localInputs = new Map<number, number>();
  /** Inputs del rival por frame. */
  private readonly remoteInputs = new Map<number, number>();

  /** Mi índice de jugador (host=0, guest=1) y el del rival. */
  private readonly myIndex: number;
  private readonly peerIndex: number;

  private frame = 0; // próximo frame de simulación a ejecutar
  private running = false;
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private stalled = false;
  private gameOverNotified = false;
  private finishing = false;
  private finishTimer = 0;

  constructor(
    private readonly world: World,
    private readonly renderer: Renderer,
    private readonly camera: Camera,
    private readonly peer: PeerConnection,
    role: "host" | "guest",
    private readonly cb: OnlineLoopCallbacks = {},
  ) {
    this.myIndex = role === "host" ? 0 : 1;
    this.peerIndex = role === "host" ? 1 : 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.input.attach();

    // Precargamos los primeros DELAY frames con input neutro (0) por ambos
    // lados: así los dos pueden empezar a simular sin esperar.
    for (let f = 0; f < DELAY; f++) {
      this.localInputs.set(f, 0);
      this.remoteInputs.set(f, 0);
    }

    // Recibimos los inputs del rival por el canal P2P.
    this.peer.setMessageHandler((data) => this.onPeerMessage(data));

    this.camera.snapTo(this.world);
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    this.input.detach();
    cancelAnimationFrame(this.rafId);
  }

  onResize(): void {
    this.renderer.resize();
    this.camera.resize(this.renderer.cssWidth, this.renderer.cssHeight);
  }

  /** Procesa un mensaje del rival (su input para un frame concreto). */
  private onPeerMessage(data: string): void {
    if (data.startsWith("i:")) {
      const [, frameStr, packedStr] = data.split(":");
      const f = Number(frameStr);
      const packed = Number(packedStr);
      if (Number.isFinite(f) && Number.isFinite(packed)) {
        this.remoteInputs.set(f, packed);
      }
    }
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25;

    this.accumulator += frameTime;

    let guard = 0;
    while (this.accumulator >= FIXED_DT && guard < 10) {
      if (!this.tryStep()) break; // esperando inputs del rival: no avanzar
      this.accumulator -= FIXED_DT;
      guard++;
    }

    this.camera.follow(this.world);
    this.renderer.render(this.world, this.camera, this.accumulator / FIXED_DT);
    this.rafId = requestAnimationFrame(this.loop);
  };

  /**
   * Intenta ejecutar el frame actual. Devuelve false (y marca "stall") si aún
   * no tenemos el input del rival para este frame.
   */
  private tryStep(): boolean {
    const f = this.frame;

    // 1) Capturar MI input y programarlo para el frame f+DELAY. Lo hago una
    // sola vez por frame (cuando aún no está registrado).
    const scheduled = f + DELAY;
    if (!this.localInputs.has(scheduled)) {
      this.input.sample(this.scratch);
      const packed = packInput(this.scratch);
      this.localInputs.set(scheduled, packed);
      // Envío mi input al rival (para su frame f+DELAY).
      this.peer.send(`i:${scheduled}:${packed}`);
    }

    // 2) ¿Tenemos ambos inputs para el frame f?
    const mine = this.localInputs.get(f);
    const theirs = this.remoteInputs.get(f);
    if (mine === undefined || theirs === undefined) {
      // Falta el del rival: esperamos (stall).
      if (!this.stalled) {
        this.stalled = true;
        this.cb.onStall?.(true);
      }
      return false;
    }
    if (this.stalled) {
      this.stalled = false;
      this.cb.onStall?.(false);
    }

    // 3) Montar los inputs por índice de jugador y avanzar la simulación.
    unpackInto(mine, this.stepInputs[this.myIndex]);
    unpackInto(theirs, this.stepInputs[this.peerIndex]);
    this.world.step(this.stepInputs, FIXED_DT);
    this.frame++;

    // Limpieza de inputs ya consumidos (no crecer sin fin).
    this.localInputs.delete(f);
    this.remoteInputs.delete(f);

    // Fin de partida (mismo patrón que el loop local, sin cámara lenta para no
    // desincronizar: ambos ven el gameOver en el mismo frame).
    if (this.world.gameOver && !this.finishing && !this.gameOverNotified) {
      this.finishing = true;
      this.finishTimer = 90; // ~1.5 s a 60 Hz de "FINISH" antes del podio
      this.cb.onFinish?.();
    }
    if (this.finishing && !this.gameOverNotified) {
      this.finishTimer--;
      if (this.finishTimer <= 0) {
        this.gameOverNotified = true;
        this.cb.onGameOver?.(this.world.winnerIndex);
      }
    }
    return true;
  }
}
