import { FIXED_DT } from "../config.ts";
import { World } from "../game/world.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import { ReplayPlayer, type ReplayData } from "../game/replay.ts";
import { PauseMenu } from "./pauseMenu.ts";
import { audio } from "../core/audio.ts";

/**
 * Reproductor de replays con controles tipo vídeo.
 *
 * Re-ejecuta la simulación de forma determinista (mismo seed + inputs grabados)
 * y la dibuja con el Renderer/Camera del juego. Permite reproducir, pausar,
 * cambiar de velocidad, y buscar (seek) adelante/atrás: como la física es
 * determinista, para ir a un paso N simplemente re-simulamos desde 0 hasta N
 * (barato: miles de pasos por frame sin render intermedio).
 *
 * Además ofrece CÁMARA LIBRE: al activarla, el ratón arrastra la cámara y la
 * rueda hace zoom, para inspeccionar la acción desde donde quieras.
 */
export interface ReplayScreenCallbacks {
  onExit: () => void;
}

export class ReplayScreen {
  private readonly root: HTMLDivElement;
  private readonly seek: HTMLInputElement;
  private readonly timeLabel: HTMLSpanElement;
  private readonly playPauseBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly freeCamBtn: HTMLButtonElement;
  /** Botón flotante para volver a mostrar la barra cuando está oculta. */
  private readonly showBarBtn: HTMLButtonElement;
  private pauseMenu: PauseMenu | null = null;
  /** ¿Está el menú de pausa abierto? (congela la reproducción). */
  private menuPaused = false;

  private player: ReplayPlayer | null = null;
  private world: World | null = null;
  private currentStep = 0;
  private playing = false;
  private speed = 1;
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;

  // Cámara libre.
  private freeCam = false;
  private camX = 0;
  private camY = 0;
  private camZoom = 1;
  private dragging = false;
  private dragLastX = 0;
  private dragLastY = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly camera: Camera,
    private readonly cb: ReplayScreenCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.id = "replay-bar";

    // Ocultar la barra (ver gameplay limpio). Reaparece con el botón flotante.
    const hide = document.createElement("button");
    hide.className = "replay-btn";
    hide.textContent = "⤫ Ocultar";
    hide.title = "Ocultar controles";
    hide.addEventListener("click", () => this.setBarHidden(true));
    this.root.appendChild(hide);

    // Retroceder un paso.
    const back = document.createElement("button");
    back.className = "replay-btn";
    back.textContent = "⏮";
    back.title = "Atrás";
    back.addEventListener("click", () => this.stepBy(-6));
    this.root.appendChild(back);

    // Play/Pausa.
    this.playPauseBtn = document.createElement("button");
    this.playPauseBtn.className = "replay-btn replay-btn-main";
    this.playPauseBtn.textContent = "▶";
    this.playPauseBtn.addEventListener("click", () => this.togglePlay());
    this.root.appendChild(this.playPauseBtn);

    // Avanzar un paso.
    const fwd = document.createElement("button");
    fwd.className = "replay-btn";
    fwd.textContent = "⏭";
    fwd.title = "Adelante";
    fwd.addEventListener("click", () => this.stepBy(6));
    this.root.appendChild(fwd);

    // Velocidad.
    this.speedBtn = document.createElement("button");
    this.speedBtn.className = "replay-btn";
    this.speedBtn.textContent = "1x";
    this.speedBtn.addEventListener("click", () => this.cycleSpeed());
    this.root.appendChild(this.speedBtn);

    // Barra de búsqueda.
    this.seek = document.createElement("input");
    this.seek.type = "range";
    this.seek.className = "replay-seek";
    this.seek.min = "0";
    this.seek.value = "0";
    this.seek.addEventListener("input", () => {
      this.seekTo(Number(this.seek.value));
    });
    this.root.appendChild(this.seek);

    // Etiqueta de tiempo.
    this.timeLabel = document.createElement("span");
    this.timeLabel.className = "replay-time";
    this.timeLabel.textContent = "0:00 / 0:00";
    this.root.appendChild(this.timeLabel);

    // Cámara libre.
    this.freeCamBtn = document.createElement("button");
    this.freeCamBtn.className = "replay-btn";
    this.freeCamBtn.textContent = "📷 Cámara libre";
    this.freeCamBtn.addEventListener("click", () => this.toggleFreeCam());
    this.root.appendChild(this.freeCamBtn);

    document.body.appendChild(this.root);

    // Botón flotante (esquina) para volver a mostrar la barra oculta.
    this.showBarBtn = document.createElement("button");
    this.showBarBtn.id = "replay-show-bar";
    this.showBarBtn.textContent = "⚙";
    this.showBarBtn.title = "Mostrar controles";
    this.showBarBtn.addEventListener("click", () => this.setBarHidden(false));
    document.body.appendChild(this.showBarBtn);
  }

  /** Oculta/muestra la barra de controles (ver gameplay limpio). */
  private setBarHidden(hidden: boolean): void {
    this.root.classList.toggle("hidden", hidden);
    this.showBarBtn.classList.toggle("visible", hidden);
  }

  /** Carga un replay y empieza a reproducir desde el principio. */
  start(data: ReplayData): void {
    this.player = new ReplayPlayer(data);
    this.rebuildWorld();
    this.currentStep = 0;
    this.seek.max = String(Math.max(0, this.player.totalSteps - 1));
    this.seek.value = "0";
    this.playing = true;
    this.menuPaused = false;
    this.updatePlayPause();
    this.disableFreeCam();
    this.setBarHidden(false);

    this.root.classList.add("open");
    this.attachCamControls();

    // Menú de pausa (Esc): reutilizamos el del juego. Al abrir, congelamos la
    // reproducción; al cerrar, la reanudamos; "volver al menú" sale del replay.
    this.pauseMenu = new PauseMenu({
      mode: "versus", // oculta la página de Dummy (no aplica en replay)
      onOpen: () => {
        this.menuPaused = true;
      },
      onClose: () => {
        this.menuPaused = false;
      },
      onQuitToMenu: () => this.exit(),
    });

    this.lastTime = performance.now();
    this.accumulator = 0;
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.frame);
  }

  private exit(): void {
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this.root.classList.remove("open");
    this.setBarHidden(false);
    this.detachCamControls();
    this.camera.clearCinematic();
    if (this.pauseMenu) {
      this.pauseMenu.destroy();
      this.pauseMenu = null;
    }
    this.cb.onExit();
  }

  /** Re-crea el mundo con la semilla/modo del replay (estado inicial). */
  private rebuildWorld(): void {
    if (!this.player) return;
    this.world = new World(this.player.data.mode, this.player.data.seed, {
      characters: this.player.data.characters,
      stage: this.player.data.stage,
    });
    this.camera.clearCinematic();
    this.camera.resize(this.renderer.cssWidth, this.renderer.cssHeight);
    this.camera.snapTo(this.world);
  }

  /** Simula desde 0 hasta `target` pasos (sin render), para seek/rewind. */
  private simulateTo(target: number): void {
    if (!this.player || !this.world) return;
    const t = Math.max(0, Math.min(this.player.totalSteps, target));
    // Silenciamos el audio durante el re-salto (si no, sonarían miles de golpes).
    audio.setSilent(true);
    // Si vamos hacia atrás, reiniciamos y re-simulamos desde cero.
    if (t < this.currentStep) {
      this.rebuildWorld();
      this.currentStep = 0;
    }
    while (this.currentStep < t) {
      const inputs = this.player.inputsAt(this.currentStep);
      this.world.step(inputs, FIXED_DT);
      this.currentStep++;
    }
    audio.setSilent(false);
  }

  private frame = (now: number): void => {
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25;

    if (this.player && this.world) {
      if (this.playing && !this.menuPaused) {
        this.accumulator += frameTime * this.speed;
        let guard = 0;
        while (this.accumulator >= FIXED_DT && guard < 600) {
          if (this.currentStep >= this.player.totalSteps) {
            this.playing = false;
            this.updatePlayPause();
            break;
          }
          const inputs = this.player.inputsAt(this.currentStep);
          this.world.step(inputs, FIXED_DT);
          this.currentStep++;
          this.accumulator -= FIXED_DT;
          guard++;
        }
        this.seek.value = String(this.currentStep);
        this.updateTimeLabel();
      }

      // Cámara: libre (manual) o seguimiento automático del replay.
      if (this.freeCam) {
        this.camera.setManual(this.camX, this.camY, this.camZoom);
      } else {
        this.camera.follow(this.world);
      }
      this.renderer.render(this.world, this.camera, 1);
    }

    this.rafId = requestAnimationFrame(this.frame);
  };

  private togglePlay(): void {
    if (!this.player) return;
    // Si está al final, al darle play reinicia.
    if (this.currentStep >= this.player.totalSteps) {
      this.simulateTo(0);
      this.seek.value = "0";
    }
    this.playing = !this.playing;
    this.updatePlayPause();
  }

  private updatePlayPause(): void {
    this.playPauseBtn.textContent = this.playing ? "⏸" : "▶";
  }

  private stepBy(delta: number): void {
    this.playing = false;
    this.updatePlayPause();
    this.simulateTo(this.currentStep + delta);
    this.seek.value = String(this.currentStep);
    this.updateTimeLabel();
  }

  private seekTo(step: number): void {
    this.simulateTo(step);
    this.updateTimeLabel();
  }

  private cycleSpeed(): void {
    const speeds = [0.25, 0.5, 1, 2, 4];
    const i = speeds.indexOf(this.speed);
    this.speed = speeds[(i + 1) % speeds.length];
    this.speedBtn.textContent = `${this.speed}x`;
  }

  private updateTimeLabel(): void {
    if (!this.player) return;
    const cur = this.currentStep / 60;
    const tot = this.player.totalSteps / 60;
    this.timeLabel.textContent = `${fmt(cur)} / ${fmt(tot)}`;
  }

  // --- Cámara libre --------------------------------------------------------

  private toggleFreeCam(): void {
    if (this.freeCam) {
      this.disableFreeCam();
    } else {
      this.enableFreeCam();
    }
  }

  private enableFreeCam(): void {
    this.freeCam = true;
    this.freeCamBtn.classList.add("active");
    // Partimos de donde esté la cámara ahora.
    this.camX = this.camera.focusX;
    this.camY = this.camera.focusY;
    this.camZoom = this.camera.currentZoom;
  }

  private disableFreeCam(): void {
    this.freeCam = false;
    this.freeCamBtn.classList.remove("active");
    this.camera.clearCinematic();
  }

  private attachCamControls(): void {
    const canvas = document.querySelector<HTMLCanvasElement>("#game");
    if (!canvas) return;
    canvas.addEventListener("mousedown", this.onDown);
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mouseup", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private detachCamControls(): void {
    const canvas = document.querySelector<HTMLCanvasElement>("#game");
    if (!canvas) return;
    canvas.removeEventListener("mousedown", this.onDown);
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseup", this.onUp);
    canvas.removeEventListener("wheel", this.onWheel);
  }

  private onDown = (e: MouseEvent): void => {
    if (!this.freeCam) return;
    this.dragging = true;
    this.dragLastX = e.clientX;
    this.dragLastY = e.clientY;
  };

  private onMove = (e: MouseEvent): void => {
    if (!this.freeCam || !this.dragging) return;
    // Convertimos el arrastre de pantalla a mundo según el zoom actual.
    const k = 1 / Math.max(0.1, this.camZoom);
    this.camX -= (e.clientX - this.dragLastX) * k;
    // La Y de mundo va hacia abajo: arrastrar abajo mueve el foco hacia abajo.
    this.camY += (e.clientY - this.dragLastY) * k;
    this.dragLastX = e.clientX;
    this.dragLastY = e.clientY;
  };

  private onUp = (): void => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.freeCam) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    this.camZoom = Math.max(0.3, Math.min(2.5, this.camZoom * factor));
  };
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}
