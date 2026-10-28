import { FIXED_DT, MAX_STEPS_PER_FRAME } from "../config.ts";
import { createInputState, KeyboardInput } from "../core/input.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import type { World } from "./world.ts";

/**
 * Bucle principal con timestep fijo + acumulador (patrón "Fix Your Timestep").
 *
 *  - La FÍSICA avanza en pasos fijos de FIXED_DT (determinista).
 *  - La CÁMARA y el RENDER se actualizan una vez por frame (son visuales).
 *  - `alpha` interpola el render entre pasos de física para verse suave.
 */
export class GameLoop {
  private readonly input = new KeyboardInput();
  private readonly inputState = createInputState();

  private running = false;
  private paused = false;
  private lastTime = 0;
  private accumulator = 0;
  private rafId = 0;

  constructor(
    private readonly world: World,
    private readonly renderer: Renderer,
    private readonly camera: Camera,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.input.attach();
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    this.input.detach();
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
   * recibe el aviso para aplicar el zoom extra.
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
        this.input.sample(this.inputState);
        this.world.step(this.inputState, FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }

      if (steps >= MAX_STEPS_PER_FRAME) {
        this.accumulator = 0;
      }

      alpha = this.accumulator / FIXED_DT;
    }

    // La cámara sigue al jugador (visual, una vez por frame).
    this.camera.follow(this.world.player);

    this.renderer.render(
      this.world.player,
      this.world.dummy,
      this.world.platforms,
      this.camera,
      this.world.lives,
      alpha,
    );

    this.rafId = requestAnimationFrame(this.frame);
  };
}
