import "./style.css";
import { World, FIGHTER_COLORS, FIGHTER_LABELS, type GameMode } from "./game/world.ts";
import { Renderer } from "./render/renderer.ts";
import { Camera } from "./render/camera.ts";
import { GameLoop } from "./game/loop.ts";
import { PauseMenu } from "./ui/pauseMenu.ts";
import { MainMenu, MatchOverScreen } from "./ui/mainMenu.ts";

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
 *   menú principal -> partida (training/versus) -> fin de partida -> menú.
 * Cada partida crea su propio World + GameLoop + PauseMenu y los destruye al
 * salir, para no arrastrar estado entre partidas.
 */
class App {
  private loop: GameLoop | null = null;
  private world: World | null = null;
  private pauseMenu: PauseMenu | null = null;

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
      this.toMenu();
    },
  });

  start(): void {
    this.toMenu();
  }

  /** Vuelve al menú principal, destruyendo la partida en curso si la hay. */
  private toMenu(): void {
    this.teardownMatch();
    this.mainMenu.show();
  }

  private startMatch(mode: GameMode): void {
    this.mainMenu.hide();
    this.teardownMatch();

    const world = new World(mode);
    this.world = world;

    camera.resize(renderer.cssWidth, renderer.cssHeight);
    camera.setPaused(false);
    camera.snapTo(world);

    const loop = new GameLoop(world, renderer, camera, (winnerIndex) => {
      this.onGameOver(winnerIndex);
    });
    this.loop = loop;

    this.pauseMenu = new PauseMenu({
      mode,
      onOpen: () => loop.setPaused(true),
      onClose: () => loop.setPaused(false),
      onQuitToMenu: () => this.toMenu(),
    });

    loop.start();
  }

  private onGameOver(winnerIndex: number): void {
    const label = winnerIndex >= 0 ? FIGHTER_LABELS[winnerIndex] : "nadie";
    const color = winnerIndex >= 0 ? FIGHTER_COLORS[winnerIndex] : "#f1f4fa";
    // Dejamos el loop corriendo un instante no hace falta: paramos la partida.
    this.teardownMatch();
    this.matchOver.show(label, color);
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
