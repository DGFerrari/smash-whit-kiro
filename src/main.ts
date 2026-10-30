import "./style.css";
import { World, type GameMode, type MatchConfig } from "./engine/game/world.ts";
import { CharacterSelect, StageSelect } from "./ui/selectScreens.ts";
import { HandCursor } from "./ui/handCursor.ts";
import { Renderer } from "./render/renderer.ts";
import { Camera } from "./render/camera.ts";
import { GameLoop } from "./game/loop.ts";
import { PauseMenu } from "./ui/pauseMenu.ts";
import { MainMenu, MatchOverScreen, type FighterResult } from "./ui/mainMenu.ts";
import { TutorialScreen } from "./ui/tutorialScreen.ts";
import { LoadingScreen, Countdown, KOFlash } from "./ui/overlays.ts";
import { ReplayScreen } from "./ui/replayScreen.ts";
import { ReplayListScreen } from "./ui/replayListScreen.ts";
import { MenuBackground } from "./ui/menuBackground.ts";
import { confirmDialog } from "./ui/confirmDialog.ts";
import {
  ReplayRecorder,
  type ReplayData,
  type ReplayResult,
} from "./engine/game/replay.ts";
import { downloadReplay, loadReplayFile } from "./ui/replayFile.ts";
import { saveReplay } from "./game/replayStore.ts";
import {
  getMe,
  startGoogleLogin,
  logout,
  submitMatch,
  updateNickname,
  type AuthUser,
} from "./net/api.ts";
import { NicknameDialog } from "./ui/nicknameDialog.ts";

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
    onOpenTutorial: () => void this.openTutorial(),
    onLogin: () => startGoogleLogin(),
    onLogout: () => void this.onLogout(),
    onChangeNickname: () => this.openNicknameDialog(),
  });

  /** Usuario con sesión actual (o null). Para precargar el apodo en el diálogo. */
  private currentUser: AuthUser | null = null;

  /** Diálogo para cambiar el apodo (guarda en el servidor). */
  private readonly nicknameDialog = new NicknameDialog({
    onSave: async (nickname) => {
      const res = await updateNickname(nickname);
      if (res.kind === "ok") {
        // Refrescamos el widget del menú con el nuevo apodo.
        if (this.currentUser) this.currentUser.nickname = res.nickname;
        this.mainMenu.setUser(
          this.currentUser
            ? { nickname: res.nickname, avatarUrl: this.currentUser.avatarUrl }
            : null,
        );
        // Y el selector de personajes (etiqueta de P1), que si no se quedaba
        // con el apodo anterior al entrar a Batalla.
        this.charSelect.setLocalNickname(res.nickname);
        return { ok: true as const, nickname: res.nickname };
      }
      return { ok: false as const, message: res.message };
    },
  });

  private readonly tutorialScreen = new TutorialScreen(renderer, camera, {
    // Al salir/completar el tutorial, volvemos al menú.
    onExit: () => void this.toMenu(),
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
      onConfirm: (characters, controllers, cpuDifficulties, labels) => {
        this.pendingConfig = {
          ...this.pendingConfig,
          characters,
          controllers,
          cpuDifficulty: cpuDifficulties,
          labels,
        };
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
    // La partida ya se guardó sola; este botón abre la lista de repeticiones,
    // pero primero pregunta por si fue un toque accidental.
    onViewReplays: () => void this.confirmViewReplays(),
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
      // Con transición de iris, igual que el resto de cambios de pantalla.
      void this.transition(() => {
        this.replayListScreen.hide();
        this.showMenu();
      });
    },
  });

  /** Fondo animado del menú (replays en bucle). Se inicia perezosamente. */
  private menuBg: MenuBackground | null = null;

  start(): void {
    this.showMenu();
    // Comprobamos la sesión en segundo plano: el menú se muestra ya y el widget
    // de cuenta se rellena cuando responda el servidor (si está disponible).
    void this.checkAuth();
  }

  /** Consulta la sesión al servidor y actualiza el widget de cuenta del menú. */
  private async checkAuth(): Promise<void> {
    // Si volvemos de un login, limpiamos el ?login=ok/error de la URL para que
    // no se quede pegado (es solo una señal del redirect de OAuth).
    const params = new URLSearchParams(window.location.search);
    if (params.has("login")) {
      params.delete("login");
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState(null, "", clean);
    }
    const user = await getMe();
    this.currentUser = user;
    this.mainMenu.setUser(
      user ? { nickname: user.nickname, avatarUrl: user.avatarUrl } : null,
    );
    // El selector de personajes necesita el apodo para la etiqueta de P1.
    this.charSelect.setLocalNickname(user?.nickname ?? null);

    // Primer login: obligamos a elegir apodo (no se puede cerrar hasta guardar).
    if (user && !user.nicknameChosen) {
      this.nicknameDialog.open(user.nickname, true);
    }
  }

  /** Cierra sesión y refresca el widget del menú. */
  private async onLogout(): Promise<void> {
    await logout();
    this.currentUser = null;
    this.mainMenu.setUser(null);
    this.charSelect.setLocalNickname(null);
  }

  /** Abre el diálogo para cambiar el apodo (precargado con el actual). */
  private openNicknameDialog(): void {
    if (!this.currentUser) return;
    this.nicknameDialog.open(this.currentUser.nickname);
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

    // Siempre grabamos (para la lista de repeticiones). Guardamos también los
    // controllers para reproducir bien las partidas con CPU.
    // Normalizamos la dificultad a array por slot para el replay (v5).
    const cpuDiffs = Array.isArray(config.cpuDifficulty)
      ? config.cpuDifficulty
      : config.cpuDifficulty
        ? config.characters.map(() => config.cpuDifficulty as "easy" | "normal" | "hard")
        : undefined;
    this.recorder = new ReplayRecorder(
      mode,
      world.seed,
      config.characters,
      config.stage,
      config.controllers,
      cpuDiffs,
      config.labels,
    );

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
      // Solo se puede pausar cuando la partida ya empezó (no en la cuenta atrás).
      canOpen: () => loop.canPause,
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

    // Puntuación: solo las partidas de VERSUS puntúan (el servidor lo valida).
    // Enviamos el replay y mostramos las monedas ganadas en el podio. No
    // bloquea la UI: el podio se ve ya y la recompensa se rellena al responder.
    if (this.pendingMode === "versus" && this.lastReplay) {
      void this.submitForRewards(this.lastReplay);
    }
  }

  /**
   * Envía la partida al servidor para puntuar y refleja el resultado en el
   * podio (monedas ganadas, o un aviso si no puntúa). Si el usuario no tiene
   * sesión, se invita a iniciarla. Toda la espera tiene indicador de carga.
   */
  private async submitForRewards(replay: ReplayData): Promise<void> {
    this.matchOver.showRewardLoading();
    const outcome = await submitMatch(replay);
    switch (outcome.kind) {
      case "ok":
        this.matchOver.setReward(
          `monedas · ${outcome.reward.grade}`,
          outcome.reward.coinsEarned,
        );
        // Refrescamos el saldo del menú (por si se mira luego).
        void this.checkAuth();
        break;
      case "no-session":
        this.matchOver.setReward("Inicia sesión para ganar monedas", null);
        break;
      case "not-ranked":
        this.matchOver.setReward(outcome.message, null);
        break;
      case "error":
        this.matchOver.setReward(outcome.message, null);
        break;
    }
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

  /** Pregunta antes de salir del podio a ver las repeticiones. */
  private async confirmViewReplays(): Promise<void> {
    const ok = await confirmDialog({
      title: "Ver repeticiones",
      message:
        "¿Quieres ir a la lista de repeticiones? Saldrás de la pantalla de resultados (la partida ya está guardada).",
      confirmText: "Sí, ver repeticiones",
      cancelText: "Quedarme aquí",
    });
    if (!ok) return;
    this.matchOver.hide();
    await this.transition(() => {
      this.replayListScreen.show();
    });
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

  /** Vuelve del reproductor a la lista de repeticiones (con carga completa). */
  private async backToReplayList(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    await this.loading.cover();
    this.teardownMatch();
    await this.loading.fill(400);
    this.replayListScreen.show();
    await this.loading.reveal();
    this.busy = false;
  }

  /** Abre el tutorial (modo guiado sobre el mapa de entrenamiento). */
  private async openTutorial(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    await this.loading.cover();
    this.hideMenu();
    this.teardownMatch();
    await this.loading.fill(600);
    this.tutorialScreen.start();
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
