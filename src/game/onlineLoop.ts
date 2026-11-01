import { ENGINE_VERSION, FIXED_DT } from "../engine/config.ts";
import { createInputState, KeyboardInput, type InputState } from "../core/input.ts";
import { packInput, unpackInto, type ReplayData } from "../engine/game/replay.ts";
import type { World } from "../engine/game/world.ts";
import type { CharacterId } from "../engine/game/characters.ts";
import type { StageId } from "../engine/game/stages.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import type { OnlineNetwork } from "../net/peer.ts";

/**
 * Bucle de partida ONLINE con LOCKSTEP + input-delay, topología ESTRELLA para
 * N jugadores (2..4). El HOST (slot 0) es la autoridad del tiempo:
 *
 *  - Cada jugador captura su input y lo programa para el frame f+DELAY.
 *  - Los GUESTS mandan su input al host:  "gi:<frame>:<packed>".
 *  - El HOST, cuando tiene los inputs de TODOS para el frame f, los empaqueta y
 *    los DIFUNDE:  "hf:<frame>:<p0>,<p1>,...". El host avanza ese frame.
 *  - Los GUESTS avanzan un frame solo cuando reciben su paquete "hf" del host
 *    (siguen al host; no deciden el tiempo). Así hay una sola fuente de verdad
 *    del orden de frames y la sincronización es robusta.
 *
 * El motor es determinista, así que con los mismos inputs todos ven lo mismo.
 */

const DELAY = 3;

export interface OnlineLoopCallbacks {
  onGameOver?: (winnerIndex: number) => void;
  onFinish?: () => void;
  onStall?: (stalled: boolean) => void;
  /** Texto de la cuenta atrás de intro ("3","2","1","¡YA!") o null para ocultar. */
  onCountdown?: (text: string | null) => void;
  /**
   * Mensaje de red que NO es de la partida (no empieza por "gi:"/"hf:"), p.ej.
   * el "result" de fin de partida del host. El loop lo reenvía aquí para que la
   * app lo gestione, evitando que se pierda si llega mientras el loop sigue
   * activo (el host difunde el resultado antes de que el guest pare su loop).
   */
  onPostMessage?: (from: number, data: string) => void;
}

/** Guion de la cuenta atrás online (texto + duración en segundos). */
const INTRO_STEPS: Array<{ text: string | null; dur: number }> = [
  { text: "3", dur: 0.8 },
  { text: "2", dur: 0.8 },
  { text: "1", dur: 0.8 },
  { text: "¡YA!", dur: 0.6 },
];

/** Config de la partida online, necesaria para reconstruir el replay. */
export interface OnlineMatchInfo {
  seed: number;
  characters: CharacterId[];
  stage: StageId;
  labels: string[];
}

export class OnlineLoop {
  private readonly input = new KeyboardInput("p1");
  private readonly scratch: InputState = createInputState();
  private readonly stepInputs: InputState[];

  /** Nº de jugadores de la partida (= slots ocupados). */
  private readonly playerCount: number;
  private readonly isHost: boolean;

  /**
   * HOST: historial de inputs por frame (todos los slots), para poder construir
   * un replay COMPLETO al terminar y que cada cliente lo envíe al servidor a
   * puntuar. Los guests no graban (no tienen los inputs de todos).
   */
  private readonly recordedSteps: number[][] = [];

  /** HOST: inputs recibidos por frame y por slot. frameInputs[frame][slot]. */
  private readonly hostInbox = new Map<number, Map<number, number>>();
  /** GUEST: paquetes de frame completos recibidos del host. frame -> inputs[]. */
  private readonly guestFrames = new Map<number, number[]>();
  /** Mis inputs ya programados (para no reenviar). */
  private readonly scheduledLocal = new Set<number>();

  private frame = 0;
  private running = false;
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private stalled = false;
  private finishing = false;
  private finishTimer = 0;
  private gameOverNotified = false;

  /** Fase de intro (cuenta atrás) antes de arrancar el lockstep. */
  private intro = true;
  private introElapsed = 0;
  private introStepIndex = -1;

  constructor(
    private readonly world: World,
    private readonly renderer: Renderer,
    private readonly camera: Camera,
    private readonly net: OnlineNetwork,
    private readonly info: OnlineMatchInfo,
    private readonly cb: OnlineLoopCallbacks = {},
  ) {
    this.playerCount = world.fighters.length;
    this.isHost = net.mySlot === 0;
    this.stepInputs = world.fighters.map(() => createInputState());
  }

  /**
   * HOST: construye el replay COMPLETO de la partida (semilla + inputs de todos
   * por frame), en el mismo formato que offline. Lo usará cada cliente para
   * enviarlo al servidor con SU slot y que le puntúe. Devuelve null si no es
   * host o no hay pasos grabados.
   */
  buildReplay(): ReplayData | null {
    if (!this.isHost || this.recordedSteps.length === 0) return null;
    return {
      version: 7,
      engineVersion: ENGINE_VERSION,
      mode: "versus",
      seed: this.info.seed,
      characters: this.info.characters,
      stage: this.info.stage,
      // En online TODOS los combatientes son humanos.
      controllers: this.info.characters.map(() => "human" as const),
      labels: this.info.labels,
      recordedAt: new Date().toISOString(),
      players: this.playerCount,
      steps: this.recordedSteps,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.input.attach();

    // Precargamos los primeros DELAY frames con input neutro (0) de todos.
    for (let f = 0; f < DELAY; f++) {
      if (this.isHost) {
        const m = new Map<number, number>();
        for (let s = 0; s < this.playerCount; s++) m.set(s, 0);
        this.hostInbox.set(f, m);
      } else {
        this.guestFrames.set(f, new Array(this.playerCount).fill(0));
      }
      this.scheduledLocal.add(f);
    }

    this.net.setMessageHandler((from, data) => this.onNetMessage(from, data));
    this.camera.snapTo(this.world);
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.intro = true;
    this.introElapsed = 0;
    this.introStepIndex = -1;
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

  // --- Red ------------------------------------------------------------------

  private onNetMessage(from: number, data: string): void {
    if (this.isHost && data.startsWith("gi:")) {
      // Input de un guest para un frame.
      const [, fStr, pStr] = data.split(":");
      const f = Number(fStr);
      const packed = Number(pStr);
      if (!Number.isFinite(f) || !Number.isFinite(packed)) return;
      let m = this.hostInbox.get(f);
      if (!m) {
        m = new Map();
        this.hostInbox.set(f, m);
      }
      m.set(from, packed);
    } else if (!this.isHost && data.startsWith("hf:")) {
      // Paquete de frame completo del host.
      const [, fStr, inputsStr] = data.split(":");
      const f = Number(fStr);
      if (!Number.isFinite(f)) return;
      const inputs = inputsStr.split(",").map((x) => Number(x) || 0);
      this.guestFrames.set(f, inputs);
    } else {
      // Mensaje ajeno a la partida (p.ej. "result" del host al terminar): lo
      // reenviamos a la app. Esto evita que se pierda si llega mientras el loop
      // del guest sigue activo (el host difunde el resultado antes de que el
      // guest procese su propio fin de partida).
      this.cb.onPostMessage?.(from, data);
    }
  }

  // --- Bucle ----------------------------------------------------------------

  private loop = (now: number): void => {
    if (!this.running) return;
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25;

    // Fase de intro: cuenta atrás local (no avanzamos la simulación todavía).
    if (this.intro) {
      this.updateIntro(frameTime);
      this.camera.follow(this.world);
      this.renderer.render(this.world, this.camera, 0);
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    this.accumulator += frameTime;
    let guard = 0;
    let stalledThisFrame = false;
    while (this.accumulator >= FIXED_DT && guard < 10) {
      const advanced = this.isHost ? this.tryStepHost() : this.tryStepGuest();
      if (!advanced) {
        // No podemos avanzar (esperando inputs del/los peers). NO acumulamos
        // más tiempo: si lo hiciéramos, al reanudar el alpha de interpolación
        // se dispararía (>1) y los personajes se verían "teletransportados".
        stalledThisFrame = true;
        break;
      }
      this.accumulator -= FIXED_DT;
      guard++;
    }

    // Si estamos atascados, descartamos el backlog para no extrapolar.
    if (stalledThisFrame) this.accumulator = 0;

    // alpha SIEMPRE en [0,1): el renderer interpola entre prevPos y pos; con
    // valores >1 extrapolaría y los personajes se verían lejísimos.
    const alpha = Math.min(1, Math.max(0, this.accumulator / FIXED_DT));
    this.camera.follow(this.world);
    this.renderer.render(this.world, this.camera, alpha);
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Cuenta atrás de intro. Al terminar, pasa al lockstep. */
  private updateIntro(frameTime: number): void {
    this.introElapsed += frameTime;
    let acc = 0;
    let idx = -1;
    for (let i = 0; i < INTRO_STEPS.length; i++) {
      if (this.introElapsed < acc + INTRO_STEPS[i].dur) {
        idx = i;
        break;
      }
      acc += INTRO_STEPS[i].dur;
    }
    if (idx === -1) {
      // Fin de la cuenta atrás: empieza la partida.
      this.intro = false;
      this.accumulator = 0;
      this.lastTime = performance.now();
      this.cb.onCountdown?.(null);
      return;
    }
    if (idx !== this.introStepIndex) {
      this.introStepIndex = idx;
      this.cb.onCountdown?.(INTRO_STEPS[idx].text);
    }
  }

  /** Captura mi input y lo programa para el frame f+DELAY (una vez). */
  private scheduleLocalInput(): void {
    const scheduled = this.frame + DELAY;
    if (this.scheduledLocal.has(scheduled)) return;
    this.scheduledLocal.add(scheduled);
    this.input.sample(this.scratch);
    const packed = packInput(this.scratch);
    if (this.isHost) {
      // El host guarda su propio input en su bandeja.
      let m = this.hostInbox.get(scheduled);
      if (!m) {
        m = new Map();
        this.hostInbox.set(scheduled, m);
      }
      m.set(0, packed);
    } else {
      // El guest manda su input al host.
      this.net.sendTo(0, `gi:${scheduled}:${packed}`);
    }
  }

  /** HOST: avanza si tiene los inputs de todos para el frame actual. */
  private tryStepHost(): boolean {
    this.scheduleLocalInput();
    const f = this.frame;
    const m = this.hostInbox.get(f);
    const ready = m && m.size >= this.playerCount;
    if (!ready) {
      this.setStalled(true);
      return false;
    }
    this.setStalled(false);

    // Construye el array de inputs por slot y lo difunde a los guests.
    const inputs: number[] = [];
    for (let s = 0; s < this.playerCount; s++) inputs.push(m.get(s) ?? 0);
    this.net.broadcast(`hf:${f}:${inputs.join(",")}`);

    this.applyFrame(inputs);
    this.hostInbox.delete(f);
    return true;
  }

  /** GUEST: avanza cuando recibe el paquete del host para el frame actual. */
  private tryStepGuest(): boolean {
    this.scheduleLocalInput();
    const f = this.frame;
    const inputs = this.guestFrames.get(f);
    if (!inputs) {
      this.setStalled(true);
      return false;
    }
    this.setStalled(false);
    this.applyFrame(inputs);
    this.guestFrames.delete(f);
    return true;
  }

  /** Aplica los inputs de un frame a la simulación y avanza. */
  private applyFrame(inputs: number[]): void {
    for (let s = 0; s < this.playerCount; s++) {
      unpackInto(inputs[s] ?? 0, this.stepInputs[s]);
    }
    // HOST: grabamos este frame (array de inputs por slot) para el replay.
    if (this.isHost) {
      const packed: number[] = [];
      for (let s = 0; s < this.playerCount; s++) packed.push(inputs[s] ?? 0);
      this.recordedSteps.push(packed);
    }
    this.world.step(this.stepInputs, FIXED_DT);
    this.frame++;
    this.scheduledLocal.delete(this.frame - 1);
    this.checkGameOver();
  }

  private setStalled(v: boolean): void {
    if (v !== this.stalled) {
      this.stalled = v;
      this.cb.onStall?.(v);
    }
  }

  private checkGameOver(): void {
    if (this.world.gameOver && !this.finishing && !this.gameOverNotified) {
      this.finishing = true;
      this.finishTimer = 90;
      this.cb.onFinish?.();
    }
    if (this.finishing && !this.gameOverNotified) {
      this.finishTimer--;
      if (this.finishTimer <= 0) {
        this.gameOverNotified = true;
        this.cb.onGameOver?.(this.world.winnerIndex);
      }
    }
  }
}
