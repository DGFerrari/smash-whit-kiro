import { FIXED_DT, MAX_STEPS_PER_FRAME } from "../engine/config.ts";
import { createInputState, KeyboardInput, type InputState } from "../core/input.ts";
import { PLAYER_SLOTS } from "../core/bindings.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import type { World } from "../engine/game/world.ts";

/** Avisos que el loop manda a la capa de presentación (overlays). */
export interface LoopCallbacks {
  /** Fin de partida (solo versus). */
  onGameOver?: (winnerIndex: number) => void;
  /** Texto de la cuenta atrás de intro ("3","2","1","GO!") o null para ocultar. */
  onCountdown?: (text: string | null) => void;
  /** Empieza un KO dramático (cámara lenta): índice del golpeado. */
  onDramaticKO?: (victimIndex: number) => void;
  /** Destello del KO dramático en [0..1] (1 = pleno), para el overlay. */
  onKOFlash?: (intensity: number) => void;
  /** La partida acaba de terminar: mostrar "FINISH" (empieza la cámara lenta). */
  onFinish?: () => void;
  /** Se llama tras muestrear los inputs de cada paso (para grabar el replay). */
  onStep?: (inputs: InputState[]) => void;
}

/** Fases de una partida gestionadas por el loop. */
type Phase = "intro" | "playing";

/** Guion de la intro: cuánto dura cada tramo (s) y qué muestra. */
/**
 * Foco de un tramo de intro: índice de un jugador concreto, o "all" (encuadre
 * que contiene a todos). El guion se GENERA según cuántos jugadores haya, para
 * que la cámara recorra a todos antes de empezar.
 */
type IntroFocus = number | "all";
interface IntroStep {
  dur: number;
  text: string | null;
  focus: IntroFocus;
}

/**
 * Bucle principal con timestep fijo + acumulador (patrón "Fix Your Timestep").
 *
 *  - La FÍSICA avanza en pasos fijos de FIXED_DT (determinista).
 *  - La CÁMARA y el RENDER se actualizan una vez por frame (son visuales).
 *  - `alpha` interpola el render entre pasos de física para verse suave.
 *
 * Añade dos capas de "presentación" que NO rompen el determinismo:
 *  - Fase de intro: cuenta atrás 3·2·1·GO con cámara cinemática; la física no
 *    avanza hasta "GO!".
 *  - Cámara lenta (timeScale) en el KO dramático: escala el tiempo que
 *    alimenta el acumulador, pero cada paso sigue siendo de FIXED_DT.
 */
export class GameLoop {
  private readonly inputs: KeyboardInput[];
  private readonly inputStates: InputState[];

  private running = false;
  private paused = false;
  private lastTime = 0;
  private accumulator = 0;
  private rafId = 0;
  private gameOverNotified = false;

  private phase: Phase = "intro";
  private introElapsed = 0;
  /** Guion de la intro, generado según el nº de jugadores (recorre a todos). */
  private readonly introSteps: IntroStep[];

  /** Escala de tiempo (1 = normal; <1 = cámara lenta). */
  private timeScale = 1;
  private targetTimeScale = 1;
  /** Temporizador de la cámara lenta del KO dramático (s de reloj real). */
  private slowmoTimer = 0;
  private koVictim = -1;

  /** Temporizador de la cámara "quedándose" en el punto de muerte (s). */
  private deathFocusTimer = 0;

  /**
   * Final de partida en cámara lenta: al perder la última vida alguien, no
   * mostramos el podio al instante. Entramos en cámara lenta, enseñamos
   * "FINISH" y, tras este tiempo, avisamos a la app para el podio.
   */
  private finishTimer = 0;
  private finishing = false;

  constructor(
    private readonly world: World,
    private readonly renderer: Renderer,
    private readonly camera: Camera,
    private readonly cb: LoopCallbacks = {},
  ) {
    // Un KeyboardInput y un InputState por combatiente del mundo (hasta 4). A
    // los que no son humanos (CPU/dummy) el World les ignora el input, pero
    // mantener el array alineado por índice simplifica todo.
    const n = world.fighters.length;
    this.inputs = [];
    this.inputStates = [];
    for (let i = 0; i < n; i++) {
      this.inputs.push(new KeyboardInput(PLAYER_SLOTS[i] ?? "p1"));
      this.inputStates.push(createInputState());
    }

    this.introSteps = this.buildIntroSteps(n);
  }

  /**
   * Construye el guion de la intro recorriendo a cada jugador y cerrando con un
   * encuadre de todos. Reparte la cuenta atrás "3·2·1·GO" a lo largo del
   * recorrido para que la cámara enseñe a todos antes de empezar.
   */
  private buildIntroSteps(n: number): IntroStep[] {
    const steps: IntroStep[] = [];
    // Un vistazo rápido a cada jugador (sin texto, para que el recorrido fluya).
    const perPlayer = Math.min(0.6, 2.4 / Math.max(1, n));
    for (let i = 0; i < n; i++) {
      steps.push({ dur: perPlayer, text: null, focus: i });
    }
    // Cuenta atrás con la cámara ya encuadrando a todos.
    steps.push({ dur: 0.7, text: "3", focus: "all" });
    steps.push({ dur: 0.7, text: "2", focus: "all" });
    steps.push({ dur: 0.7, text: "1", focus: "all" });
    steps.push({ dur: 0.6, text: "GO!", focus: "all" });
    return steps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const i of this.inputs) i.attach();
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.phase = "intro";
    this.introElapsed = 0;
    this.cb.onCountdown?.(this.introSteps[0].text);
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    for (const i of this.inputs) i.detach();
    cancelAnimationFrame(this.rafId);
  }

  onResize(): void {
    this.renderer.resize();
    this.camera.resize(this.renderer.cssWidth, this.renderer.cssHeight);
  }

  setPaused(value: boolean): void {
    // No se puede pausar durante la intro.
    if (this.phase === "intro") return;
    this.paused = value;
    this.camera.setPaused(value);
  }

  /** ¿Se puede pausar ya? (solo cuando la partida ha empezado, no en la intro). */
  get canPause(): boolean {
    return this.phase === "playing";
  }

  private frame = (now: number): void => {
    if (!this.running) return;

    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25;

    let alpha = 1;

    if (this.phase === "intro") {
      alpha = this.updateIntro(frameTime);
    } else if (this.paused) {
      this.accumulator = 0;
    } else {
      alpha = this.updatePlaying(frameTime);
    }

    // Cámara: durante la intro la conduce la cinemática (ya seteada en
    // updateIntro); en juego sigue el encuadre automático.
    this.camera.follow(this.world);

    this.renderer.render(this.world, this.camera, alpha);

    this.rafId = requestAnimationFrame(this.frame);
  };

  /** Intro: cuenta atrás con cámara que recorre a los jugadores. */
  private updateIntro(frameTime: number): number {
    this.introElapsed += frameTime;

    // ¿En qué tramo del guion estamos?
    let acc = 0;
    let current = this.introSteps[this.introSteps.length - 1];
    let finished = true;
    for (const step of this.introSteps) {
      if (this.introElapsed < acc + step.dur) {
        current = step;
        finished = false;
        break;
      }
      acc += step.dur;
    }

    // Cámara cinemática según el foco del tramo.
    this.applyIntroCamera(current.focus);
    this.cb.onCountdown?.(current.text);

    if (finished) {
      // Termina la intro: liberamos la cámara y empezamos a jugar.
      this.camera.clearCinematic();
      this.camera.snapTo(this.world);
      this.phase = "playing";
      this.accumulator = 0;
      this.cb.onCountdown?.(null);
    }
    return 1;
  }

  private applyIntroCamera(focus: IntroFocus): void {
    if (focus === "all") {
      // Encuadre cinemático que contiene a TODOS los jugadores (ligeramente
      // alejado para que se vean enteros). Suavizado por focusOn/cinematic.
      this.camera.cinematicFrameAll(this.world, 0.95);
      return;
    }
    const f = this.world.fighters[focus];
    if (!f) {
      this.camera.cinematicFrameAll(this.world, 0.95);
      return;
    }
    const cx = f.player.pos.x + f.player.width / 2;
    const cy = f.player.pos.y + f.player.height / 2;
    this.camera.focusOn(cx, cy, 1.3);
  }

  /** Fase de juego con acumulador y cámara lenta opcional. */
  private updatePlaying(frameTime: number): number {
    // Suavizado de la escala de tiempo (entra/sale de la cámara lenta).
    this.timeScale += (this.targetTimeScale - this.timeScale) * 0.25;

    // Cámara "quedándose" en el punto de muerte: mientras el temporizador corre,
    // forzamos un enfoque cinemático en ese punto; al acabar, liberamos.
    if (this.deathFocusTimer > 0) {
      this.deathFocusTimer -= frameTime;
      if (this.deathFocusTimer <= 0) this.camera.clearCinematic();
    }

    // Cámara lenta del KO dramático.
    if (this.slowmoTimer > 0) {
      this.slowmoTimer -= frameTime;
      // Destello que decae con el tiempo restante.
      this.cb.onKOFlash?.(Math.max(0, this.slowmoTimer / 0.9));
      if (this.slowmoTimer <= 0) {
        // Si NO estamos en el remate de fin de partida, volvemos a tiempo real.
        if (!this.finishing) this.targetTimeScale = 1;
        this.cb.onKOFlash?.(0);
      }
    }

    this.accumulator += frameTime * this.timeScale;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      for (let i = 0; i < this.inputs.length; i++) {
        this.inputs[i].sample(this.inputStates[i]);
      }
      // Grabación de replay: registramos los inputs de ESTE paso antes de usarlos.
      this.cb.onStep?.(this.inputStates);
      this.world.step(this.inputStates, FIXED_DT);
      steps++;
      this.accumulator -= FIXED_DT;

      // ¿El mundo señaló un KO dramático? Arrancamos la cámara lenta.
      if (this.world.pendingDramaticKO !== null && this.slowmoTimer <= 0) {
        this.koVictim = this.world.pendingDramaticKO;
        this.world.pendingDramaticKO = null;
        this.slowmoTimer = 0.9;
        this.targetTimeScale = 0.25;
        this.cb.onDramaticKO?.(this.koVictim);
      }

      // ¿Alguien murió? Congelamos la cámara en el encuadre que tenía JUSTO
      // antes de la muerte (no saltamos al punto del muerto), para que el
      // jugador vivo siga viendo su zona mientras se aprecia el rayo.
      if (this.world.pendingDeathFocus) {
        this.world.pendingDeathFocus = null;
        this.camera.freeze();
        this.deathFocusTimer = 1.8;
      }
    }

    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const alpha = this.accumulator / FIXED_DT;

    // Fin de partida: la primera vez entramos en cámara lenta + "FINISH"; solo
    // avisamos para el podio cuando el temporizador de remate se agota.
    if (this.world.gameOver && !this.finishing && !this.gameOverNotified) {
      this.finishing = true;
      this.finishTimer = 2.4; // s de reloj real en cámara lenta
      this.targetTimeScale = 0.18; // cámara MUY lenta para el remate
      this.cb.onFinish?.();
    }
    if (this.finishing && !this.gameOverNotified) {
      this.finishTimer -= frameTime;
      if (this.finishTimer <= 0) {
        this.gameOverNotified = true;
        this.cb.onGameOver?.(this.world.winnerIndex);
      }
    }

    return alpha;
  }
}
