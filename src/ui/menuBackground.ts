import { FIXED_DT } from "../config.ts";
import { World } from "../game/world.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import { ReplayPlayer } from "../game/replay.ts";
import { MENU_REPLAYS } from "../game/menuReplays.ts";
import { audio } from "../core/audio.ts";

/**
 * Fondo animado del menú principal: reproduce replays en bucle detrás del menú.
 *
 * Cuenta con su propio requestAnimationFrame. Reutiliza el Renderer/Camera del
 * juego (sin HUD). Al terminar un replay, hace un FUNDIDO a negro, carga el
 * siguiente de la lista (ciclando) y vuelve a aparecer. Si no hay replays en
 * `src/replays/`, simplemente no hace nada (el menú queda sobre fondo plano).
 */
export class MenuBackground {
  /** Capa negra para el fundido entre replays. */
  private readonly fade: HTMLDivElement;

  private index = 0;
  private player: ReplayPlayer | null = null;
  private world: World | null = null;
  private step = 0;
  private running = false;
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private fadeValue = 0; // 0 = visible, 1 = negro
  private phase: "in" | "play" | "out" = "in";

  constructor(
    private readonly renderer: Renderer,
    private readonly camera: Camera,
  ) {
    this.fade = document.createElement("div");
    this.fade.id = "menu-bg-fade";
    document.body.appendChild(this.fade);
  }

  get hasReplays(): boolean {
    return MENU_REPLAYS.length > 0;
  }

  start(): void {
    if (this.running || !this.hasReplays) return;
    this.running = true;
    this.index = 0;
    this.loadCurrent();
    this.fade.classList.add("active");
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.fade.classList.remove("active");
    this.world = null;
    this.player = null;
  }

  private loadCurrent(): void {
    const data = MENU_REPLAYS[this.index % MENU_REPLAYS.length];
    this.player = new ReplayPlayer(data);
    this.world = new World(data.mode, data.seed, {
      characters: data.characters,
      stage: data.stage,
    });
    this.step = 0;
    this.phase = "in";
    this.fadeValue = 1; // arranca en negro y aparece (fade-in)
    this.camera.clearCinematic();
    this.camera.resize(this.renderer.cssWidth, this.renderer.cssHeight);
    this.camera.snapTo(this.world);
  }

  private nextReplay(): void {
    this.index = (this.index + 1) % MENU_REPLAYS.length;
    this.loadCurrent();
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25;

    if (this.player && this.world) {
      // Avanzamos la simulación del replay (siempre a velocidad normal).
      // El fondo del menú es MUDO: silenciamos el audio mientras simula.
      if (this.phase !== "out") {
        audio.setSilent(true);
        this.accumulator += frameTime;
        let guard = 0;
        while (this.accumulator >= FIXED_DT && guard < 600) {
          if (this.step >= this.player.totalSteps) {
            this.phase = "out"; // llegó al final: empezamos a desvanecer
            break;
          }
          this.world.step(this.player.inputsAt(this.step), FIXED_DT);
          this.step++;
          this.accumulator -= FIXED_DT;
          guard++;
        }
        audio.setSilent(false);
      }

      // Fundido: fade-in al entrar, fade-out al terminar -> siguiente replay.
      const fadeSpeed = frameTime / 0.6; // ~0.6 s por fundido
      if (this.phase === "in") {
        this.fadeValue = Math.max(0, this.fadeValue - fadeSpeed);
        if (this.fadeValue <= 0) this.phase = "play";
      } else if (this.phase === "out") {
        this.fadeValue = Math.min(1, this.fadeValue + fadeSpeed);
        if (this.fadeValue >= 1) this.nextReplay();
      }
      this.fade.style.opacity = String(this.fadeValue);

      this.camera.follow(this.world);
      // Render SIN HUD (es solo decorado del menú).
      this.renderer.render(this.world, this.camera, 1, true);
    }

    this.rafId = requestAnimationFrame(this.frame);
  };
}
