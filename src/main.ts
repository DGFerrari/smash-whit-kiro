import "./style.css";
import { World, FIGHTER_COLORS, FIGHTER_LABELS, type GameMode } from "./game/world.ts";
import { Renderer } from "./render/renderer.ts";
import { Camera } from "./render/camera.ts";
import { GameLoop } from "./game/loop.ts";
import { PauseMenu } from "./ui/pauseMenu.ts";
import { MainMenu, MatchOverScreen, type FighterResult } from "./ui/mainMenu.ts";
import { LoadingScreen, Countdown, KOFlash } from "./ui/overlays.ts";
import { ReplayScreen } from "./ui/replayScreen.ts";
import {
  ReplayRecorder,
  downloadReplay,
  loadReplayFile,
  type ReplayData,
} from "./game/replay.ts";

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

  /** Grabador activo de la partida actual (null si no se graba). */
  private recorder: ReplayRecorder | null = null;
  /** Replay grabado de la última partida (para ofrecer descargarlo al acabar). */
  private lastReplay: ReplayData | null = null;

  private readonly loading = new LoadingScreen();
  private readonly countdown = new Countdown();
  private readonly koFlash = new KOFlash();

  private readonly mainMenu = new MainMenu({
    onPlay: (mode, record) => void this.startMatch(mode, record),
    onLoadReplay: (file) => void this.openReplay(file),
  });

  private readonly matchOver = new MatchOverScreen({
    onRematch: () => {
      const mode = this.world?.mode ?? "versus";
      const record = this.recorder !== null;
      this.matchOver.hide();
      void this.startMatch(mode, record);
    },
    onMenu: () => {
      this.matchOver.hide();
      void this.toMenu();
    },
  });

  private readonly replayScreen = new ReplayScreen(renderer, camera, {
    onExit: () => void this.toMenu(),
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

  private async startMatch(mode: GameMode, record: boolean): Promise<void> {
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

    // Grabación de replay: si se pidió, creamos el grabador con el seed del
    // mundo (clave para que el replay reproduzca exactamente la misma partida).
    this.recorder = record ? new ReplayRecorder(mode, world.seed) : null;

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
      // Grabación: registramos los inputs de cada paso.
      onStep: (inputs) => this.recorder?.record(inputs),
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
    const isDraw = world?.draw ?? winnerIndex < 0;
    const label = isDraw
      ? "Empate"
      : winnerIndex >= 0
        ? FIGHTER_LABELS[winnerIndex]
        : "nadie";
    const color = isDraw
      ? "#f1f4fa"
      : winnerIndex >= 0
        ? FIGHTER_COLORS[winnerIndex]
        : "#f1f4fa";

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

    // Si se estaba grabando, finalizamos el replay y lo descargamos.
    if (this.recorder && this.recorder.length > 0) {
      this.lastReplay = this.recorder.build();
      downloadReplay(this.lastReplay);
    }

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
    this.recorder = null;
  }

  /** Carga un archivo de replay y lo reproduce en el ReplayScreen. */
  private async openReplay(file: File): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const data = await loadReplayFile(file);
      await this.loading.cover();
      this.mainMenu.hide();
      this.teardownMatch();
      await this.loading.fill(500);
      this.replayScreen.start(data);
      await this.loading.reveal();
    } catch (err) {
      console.error(err);
      window.alert("No se pudo cargar el replay: archivo no válido.");
      this.mainMenu.show();
    } finally {
      this.busy = false;
    }
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
