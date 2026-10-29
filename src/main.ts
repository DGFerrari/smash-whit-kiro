import "./style.css";
import { World, FIGHTER_COLORS, FIGHTER_LABELS, type GameMode } from "./game/world.ts";
import { Renderer } from "./render/renderer.ts";
import { Camera } from "./render/camera.ts";
import { GameLoop } from "./game/loop.ts";
import { PauseMenu } from "./ui/pauseMenu.ts";
import { MainMenu, MatchOverScreen, type FighterResult } from "./ui/mainMenu.ts";
import { LoadingScreen, Countdown, KOFlash } from "./ui/overlays.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) {
  throw new Error("No se encontró el canvas #game en el HTML");
}

// El renderer y la cámara se reutilizan entre partidas (son solo "vista").
const renderer = new Renderer(canvas);
const camera = new Camera();
camera.resize(renderer.cssWidth, renderer.cssHeight);

/**
 * Capa de aplicación: una pequeña máquina de estados sobre el loop.
 *   menú principal -> (carga) -> partida -> fin de partida -> menú.
 * Cada partida crea su propio World + GameLoop + PauseMenu y los destruye al
 * salir, para no arrastrar estado entre partidas.
 */
class App {
  private loop: GameLoop | null = null;
  private world: World | null = null;
  private pauseMenu: PauseMenu | null = null;
  private busy = false;

  private readonly loading = new LoadingScreen();
  private readonly countdown = new Countdown();
  private readonly koFlash = new KOFlash();

  private readonly mainMenu = new MainMenu({
    onPlay: (mode) => this.startMatch(mode),
  });

  private readonly matchOver = new MatchOverScreen({
    onRematch: () => {
      const mode = this.world?.mode ?? "versus";
      this.matchOver.hide();
      this.startMatch(mode);
    },
    onMenu: () => {
      this.matchOver.hide();
      void this.toMenu();
    },
  });

  start(): void {
    this.mainMenu.show();
  }

  /** Vuelve al menú principal con transición de iris de por medio. */
  private async toMenu(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    // Iris se cierra tapando la escena actual.
    await this.loading.cover();
    this.teardownMatch();
    this.mainMenu.show();
    // Con la pantalla tapada, el anillo de carga se llena.
    await this.loading.fill(500);
    // Iris se abre revelando el menú.
    await this.loading.reveal();
    this.busy = false;
  }

  private async startMatch(mode: GameMode): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    // Iris se cierra tapando el menú.
    await this.loading.cover();
    this.mainMenu.hide();
    this.teardownMatch();
    // Con la pantalla tapada, el anillo de carga se llena.
    await this.loading.fill(600);

    const world = new World(mode);
    this.world = world;

    camera.resize(renderer.cssWidth, renderer.cssHeight);
    camera.setPaused(false);
    camera.clearCinematic();
    camera.snapTo(world);

    const loop = new GameLoop(world, renderer, camera, {
      onGameOver: (winnerIndex) => this.onGameOver(winnerIndex),
      onCountdown: (text) => this.countdown.set(text),
      onKOFlash: (intensity) => this.koFlash.set(intensity),
      onDramaticKO: () => {
        /* El destello lo maneja onKOFlash; aquí podríamos sonar un golpe. */
      },
      // Al perder la última vida: "FINISH" durante la cámara lenta del remate.
      onFinish: () => this.matchOver.showFinish(),
    });
    this.loop = loop;

    this.pauseMenu = new PauseMenu({
      mode,
      onOpen: () => loop.setPaused(true),
      onClose: () => loop.setPaused(false),
      onQuitToMenu: () => void this.toMenu(),
    });

    // Arrancamos el loop (ya renderiza el primer frame) y abrimos el iris.
    loop.start();
    await this.loading.reveal();
    this.busy = false;
  }

  private onGameOver(winnerIndex: number): void {
    const world = this.world;
    const label = winnerIndex >= 0 ? FIGHTER_LABELS[winnerIndex] : "nadie";
    const color = winnerIndex >= 0 ? FIGHTER_COLORS[winnerIndex] : "#f1f4fa";

    // Recogemos las calificaciones ANTES de destruir el mundo.
    const results: FighterResult[] = (world?.fighters ?? []).map((f) => ({
      label: f.label,
      color: f.color,
      dealt: f.player.stats.dealt,
      taken: f.player.stats.taken,
      blocked: f.player.stats.blocked,
      kos: f.player.stats.kos,
      deaths: f.player.stats.deaths,
      isWinner: f.index === winnerIndex,
    }));

    this.teardownMatch();
    this.koFlash.set(0);
    this.countdown.set(null);
    this.matchOver.show(label, color, results);
  }

  /** Para y elimina la partida actual (loop + menú de pausa + mundo). */
  private teardownMatch(): void {
    if (this.loop) {
      this.loop.stop();
      this.loop = null;
    }
    if (this.pauseMenu) {
      this.pauseMenu.destroy();
      this.pauseMenu = null;
    }
    this.countdown.set(null);
    this.koFlash.set(0);
    this.world = null;
  }

  onResize(): void {
    if (this.loop) {
      this.loop.onResize();
    } else {
      renderer.resize();
      camera.resize(renderer.cssWidth, renderer.cssHeight);
    }
  }
}

const app = new App();
window.addEventListener("resize", () => app.onResize());
app.start();
