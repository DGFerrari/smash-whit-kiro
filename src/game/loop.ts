import { FIXED_DT, MAX_STEPS_PER_FRAME } from "../config.ts";
import { createInputState, KeyboardInput, type InputState } from "../core/input.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import type { World } from "./world.ts";

/**
 * Bucle principal con timestep fijo + acumulador (patrón "Fix Your Timestep").
 *
 *  - La FÍSICA avanza en pasos fijos de FIXED_DT (determinista).
 *  - La CÁMARA y el RENDER se actualizan una vez por frame (son visuales).
 *  - `alpha` interpola el render entre pasos de física para verse suave.
 *
 * El loop no decide de modos ni de pantallas: simula un World y lo dibuja. La
 * capa superior (main) crea/destruye el loop al entrar/salir de una partida y
 * escucha `onGameOver` para mostrar la pantalla de fin.
 */
export class GameLoop {
  /** Un dispositivo de teclado por combatiente (P1 y P2). */
  private readonly inputs: KeyboardInput[];
  private readonly inputStates: InputState[];

  private running = false;
  private paused = false;
  private lastTime = 0;
  private accumulator = 0;
  private rafId = 0;
  private gameOverNotified = false;

  constructor(
    private readonly world: World,
    private readonly renderer: Renderer,
    private readonly camera: Camera,
    /** Se llama una vez cuando la partida termina (solo versus). */
    private readonly onGameOver?: (winnerIndex: number) => void,
  ) {
    // P1 siempre; P2 solo tiene efecto real si el mundo lo usa (versus).
    this.inputs = [new KeyboardInput("p1"), new KeyboardInput("p2")];
    this.inputStates = [createInputState(), createInputState()];
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const i of this.inputs) i.attach();
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    for (const i of this.inputs) i.detach();
    cancelAnimationFrame(this.rafId);
  }

  /** Llamar cuando cambie el tamaño de la ventana. */
  onResize(): void {
    this.renderer.resize();
    this.camera.resize(this.renderer.cssWidth, this.renderer.cssHeight);
  }

  /**
   * Pausa o reanuda la simulación. Pausado: la física no avanza, pero el render
   * y la cámara siguen (para ver la animación del zoom de pausa). La cámara
   * recibe el aviso para aplicar el zoom extra y el reencuadre al jugador.
   */
  setPaused(value: boolean): void {
    this.paused = value;
    this.camera.setPaused(value);
  }

  private frame = (now: number): void => {
    if (!this.running) return;

    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25;

    let alpha = 1;

    if (this.paused) {
      // Pausado: no avanzamos física. Mantenemos el input "fresco" para no
      // registrar un salto fantasma al reanudar, y no acumulamos tiempo.
      this.accumulator = 0;
    } else {
      this.accumulator += frameTime;

      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        for (let i = 0; i < this.inputs.length; i++) {
          this.inputs[i].sample(this.inputStates[i]);
        }
        this.world.step(this.inputStates, FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }

      if (steps >= MAX_STEPS_PER_FRAME) {
        this.accumulator = 0;
      }

      alpha = this.accumulator / FIXED_DT;

      // Notifica fin de partida una sola vez.
      if (this.world.gameOver && !this.gameOverNotified) {
        this.gameOverNotified = true;
        this.onGameOver?.(this.world.winnerIndex);
      }
    }

    // La cámara encuadra a todos los combatientes vivos (visual, por frame).
    this.camera.follow(this.world);

    this.renderer.render(this.world, this.camera, alpha);

    this.rafId = requestAnimationFrame(this.frame);
  };
}
