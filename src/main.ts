import "./style.css";
import { World, type GameMode, type MatchConfig } from "./game/world.ts";
import { CharacterSelect, StageSelect } from "./ui/selectScreens.ts";
import { HandCursor } from "./ui/handCursor.ts";
import { Renderer } from "./render/renderer.ts";
import { Camera } from "./render/camera.ts";
import { GameLoop } from "./game/loop.ts";
import { PauseMenu } from "./ui/pauseMenu.ts";
import { MainMenu, MatchOverScreen, type FighterResult } from "./ui/mainMenu.ts";
import { LoadingScreen, Countdown, KOFlash } from "./ui/overlays.ts";
import { ReplayScreen } from "./ui/replayScreen.ts";
import { ReplayListScreen } from "./ui/replayListScreen.ts";
import { MenuBackground } from "./ui/menuBackground.ts";
import {
  ReplayRecorder,
  downloadReplay,
  loadReplayFile,
  type ReplayData,
  type ReplayResult,
} from "./game/replay.ts";
import { saveReplay } from "./game/replayStore.ts";

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
  /** Replay grabado de la última partida (se guarda solo al terminar). */
  private lastReplay: ReplayData | null = null;

  /** Config elegida de la partida en curso (para grabación y revancha). */
  private pendingMode: GameMode = "versus";
  private pendingConfig: MatchConfig = {
    characters: ["blue", "red"],
    stage: "neonIsland",
  };

  private readonly loading = new LoadingScreen();
  private readonly countdown = new Countdown();
  private readonly koFlash = new KOFlash();
  /** Cursor de mano cartoon (sustituye al cursor nativo). */
  private readonly hand = new HandCursor();

  private readonly mainMenu = new MainMenu({
    onPlay: (mode) => this.onPlay(mode),
    onOpenReplays: () => void this.openReplayList(),
  });

  // Selección de personajes (batalla).
  private readonly charSelect = new CharacterSelect(
    {
      onBack: () => {
        void this.transition(() => {
          this.charSelect.hide();
          this.showMenu();
        });
      },
      onConfirm: (characters) => {
        this.pendingConfig = { ...this.pendingConfig, characters };
        void this.transition(() => {
          this.charSelect.hide();
          this.stageSelect.show();
        });
      },
    },
    this.hand,
  );

  // Selección de escenario (batalla).
  private readonly stageSelect = new StageSelect(
    {
      onBack: () => {
        void this.transition(() => {
          this.stageSelect.hide();
          this.charSelect.show();
        });
      },
      onConfirm: (stage) => {
        this.pendingConfig = { ...this.pendingConfig, stage };
        this.stageSelect.hide();
        void this.startMatch("versus", this.pendingConfig);
      },
    },
    this.hand,
  );

  private readonly matchOver = new MatchOverScreen({
    onRematch: () => {
      this.matchOver.hide();
      void this.startMatch(this.pendingMode, this.pendingConfig);
    },
    onMenu: () => {
      this.matchOver.hide();
      void this.toMenu();
    },
    // La partida ya se guardó sola; este botón abre la lista de repeticiones.
    onViewReplays: () => {
      this.matchOver.hide();
      this.replayListScreen.show();
    },
  });

  private readonly replayScreen = new ReplayScreen(renderer, camera, {
    // Al salir del reproductor volvemos a la lista, no al menú.
    onExit: () => void this.backToReplayList(),
  });

  private readonly replayListScreen = new ReplayListScreen({
    onPlay: (data) => void this.playReplayFromList(data),
    onExport: (data) => downloadReplay(data),
    onImportFile: (file) => loadReplayFile(file),
    onBack: () => {
      this.replayListScreen.hide();
      this.showMenu();
    },
  });

  /** Fondo animado del menú (replays en bucle). Se inicia perezosamente. */
  private menuBg: MenuBackground | null = null;

  start(): void {
    this.showMenu();
  }

  /**
   * El menú pidió jugar un modo. Batalla pasa por selección de personajes y
   * escenario; entrenamiento arranca directo con su config por defecto.
   */
  private onPlay(mode: GameMode): void {
    if (mode === "versus") {
      // Transición de iris del menú a la selección de personajes. Paramos el
      // fondo de replays: las pantallas de selección van sobre fondo negro.
      void this.transition(() => {
        this.hideMenu();
        this.charSelect.show();
      });
    } else {
      // Entrenamiento: jugador azul contra el saco en el escenario de práctica.
      const config: MatchConfig = {
        characters: ["blue", "sandbag"],
        stage: "training",
      };
      void this.startMatch("training", config);
    }
  }

  /** Muestra el menú y arranca el fondo de replays en bucle. */
  private showMenu(): void {
    this.mainMenu.show();
    if (!this.menuBg) this.menuBg = new MenuBackground(renderer, camera);
    this.menuBg.start();
  }

  /** Oculta el menú y detiene el fondo de replays. */
  private hideMenu(): void {
    this.mainMenu.hide();
    this.menuBg?.stop();
  }

  /**
   * Transición de iris para cambiar de pantalla DENTRO de los menús (sin tocar
   * el loop): cierra el iris, ejecuta `swap` (ocultar/mostrar overlays) y abre.
   */
  private async transition(swap: () => void): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    await this.loading.cover(320);
    swap();
    await this.loading.reveal(380);
    this.busy = false;
  }

  /** Vuelve al menú principal con transición de iris de por medio. */
  private async toMenu(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    // Iris se cierra tapando la escena actual.
    await this.loading.cover();
    this.teardownMatch();
    this.showMenu();
    // Con la pantalla tapada, el anillo de carga se llena.
    await this.loading.fill(500);
    // Iris se abre revelando el menú.
    await this.loading.reveal();
    this.busy = false;
  }

  private async startMatch(mode: GameMode, config: MatchConfig): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    // Recordamos la config para la grabación y la revancha.
    this.pendingMode = mode;
    this.pendingConfig = config;

    // Iris se cierra tapando el menú/selección.
    await this.loading.cover();
    this.hideMenu();
    this.charSelect.hide();
    this.stageSelect.hide();
    this.teardownMatch();
    // Con la pantalla tapada, el anillo de carga se llena.
    await this.loading.fill(600);

    const world = new World(mode, undefined, config);
    this.world = world;
    this.lastReplay = null;

    // Siempre grabamos (para poder ofrecer la descarga del replay al terminar).
    this.recorder = new ReplayRecorder(mode, world.seed, config.characters, config.stage);

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
    const winner =
      winnerIndex >= 0 ? world?.fighters[winnerIndex] : undefined;
    const label = isDraw ? "Empate" : winner?.label ?? "nadie";
    const color = isDraw ? "#f1f4fa" : winner?.color ?? "#f1f4fa";

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

    // Resumen de resultado que se guarda dentro del replay (para la lista).
    const replayResult: ReplayResult | undefined = world
      ? {
          winnerLabel: label,
          winnerColor: color,
          draw: isDraw,
          durationSec: this.recorder ? this.recorder.length / 60 : 0,
          fighters: world.fighters.map((f) => ({
            label: f.label,
            color: f.color,
            character: f.characterId,
            dealt: f.player.stats.dealt,
            taken: f.player.stats.taken,
            blocked: f.player.stats.blocked,
            kos: f.player.stats.kos,
            deaths: f.player.stats.deaths,
            isWinner: f.index === winnerIndex,
          })),
        }
      : undefined;

    // Finalizamos el replay grabado (se guarda automáticamente abajo).
    this.lastReplay =
      this.recorder && this.recorder.length > 0
        ? this.recorder.build(replayResult)
        : null;

    // Guardado AUTOMÁTICO dentro del navegador (si hubo algo que grabar).
    if (this.lastReplay) {
      saveReplay(this.lastReplay);
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

  /** Abre la lista de repeticiones guardadas (desde el menú). */
  private async openReplayList(): Promise<void> {
    // No tocamos this.busy aquí: transition() ya lo gestiona (y si lo
    // pusiéramos a true antes, transition abortaría por su propio guard).
    await this.transition(() => {
      this.hideMenu();
      this.replayListScreen.show();
    });
  }

  /** Vuelve del reproductor a la lista de repeticiones. */
  private async backToReplayList(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    await this.loading.cover();
    this.teardownMatch();
    this.replayListScreen.show();
    await this.loading.reveal();
    this.busy = false;
  }

  /** Reproduce un replay elegido en la lista. */
  private async playReplayFromList(data: ReplayData): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.loading.cover();
      this.replayListScreen.hide();
      this.teardownMatch();
      await this.loading.fill(500);
      this.replayScreen.start(data);
      await this.loading.reveal();
    } catch (err) {
      console.error(err);
      window.alert("No se pudo reproducir el replay.");
      this.replayListScreen.show();
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
