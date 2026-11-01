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
  submitOnlineMatch,
  updateNickname,
  type AuthUser,
} from "./net/api.ts";
import { NicknameDialog } from "./ui/nicknameDialog.ts";
import { RankingScreen } from "./ui/rankingScreen.ts";
import { GachaScreen } from "./ui/gachaScreen.ts";
import { OnlineScreen } from "./ui/onlineScreen.ts";
import { OnlineLobby } from "./ui/onlineLobby.ts";
import { OnlineLoop } from "./game/onlineLoop.ts";
import { OnlinePostMatch } from "./ui/onlinePostMatch.ts";
import { OnlinePauseMenu } from "./ui/onlinePauseMenu.ts";
import {
  decodeLobby,
  encodeLobby,
  type OnlineFighterResult,
} from "./net/onlineProtocol.ts";
import type { OnlineNetwork } from "./net/peer.ts";
import type { CharacterId } from "./engine/game/characters.ts";
import type { StageId } from "./engine/game/stages.ts";

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
    onOpenRanking: () => void this.openRanking(),
    onOpenGacha: () => void this.openGacha(),
    onOpenOnline: () => void this.openOnline(),
    onLogin: () => startGoogleLogin(),
    onLogout: () => void this.onLogout(),
    onChangeNickname: () => this.openNicknameDialog(),
  });

  /** Pantalla de clasificación (ranking). */
  private readonly rankingScreen = new RankingScreen({
    onBack: () => {
      void this.transition(() => {
        this.rankingScreen.hide();
        this.showMenu();
      });
    },
  });

  /** Pantalla de cofres (gacha) + mochila de tokens. */
  private readonly gachaScreen = new GachaScreen({
    onBack: () => {
      void this.transition(() => {
        this.gachaScreen.hide();
        this.showMenu();
      });
    },
  });

  /** Pantalla de online (crear/unirse a sala P2P). */
  private readonly onlineScreen = new OnlineScreen({
    onBack: () => {
      void this.transition(() => {
        this.onlineScreen.hide();
        this.showMenu();
      });
    },
    onReady: (net, code) => this.openOnlineLobby(net, code),
  });

  /** Lobby online (selección de personaje/mapa sincronizada, hasta 4). */
  private readonly onlineLobby = new OnlineLobby(
    {
      onBack: () => {
        this.onlineNet = null;
        void this.transition(() => {
          this.onlineLobby.hide();
          this.showMenu();
        });
      },
      onStart: (seed, characters, stage, names) =>
        this.startOnlineMatch(seed, characters, stage, names),
    },
    this.hand,
  );

  /** Menú de pausa online (no congela el juego; botón para salir). */
  private readonly onlinePause = new OnlinePauseMenu({
    onQuit: () => this.quitOnline(),
    // No abrir durante la cuenta atrás (mientras aún no hay partida jugándose).
    canOpen: () => this.onlineLoop !== null,
  });

  /** Pantalla de fin de partida online (stats + aceptar + decisión del host). */
  private readonly onlinePost = new OnlinePostMatch({
    onAccept: () => this.onlineAccept(),
    onRematch: () => this.onlineHostDecide("rematch"),
    onLobby: () => this.onlineHostDecide("lobby"),
  });

  /** Red de la sesión online actual (compartida entre lobby y partida). */
  private onlineNet: OnlineNetwork | null = null;
  /** Bucle de la partida online en curso (null si no hay). */
  private onlineLoop: OnlineLoop | null = null;
  /** Config de la última partida online (para revancha con misma gente). */
  private onlineInfo: {
    characters: CharacterId[];
    stage: StageId;
    names: string[];
    slots: number[];
  } | null = null;
  /** HOST: slots que han aceptado el resultado post-partida. */
  private onlineConfirmed = new Set<number>();
  /** Código de la sala online actual (para re-mostrarlo al volver al lobby). */
  private onlineRoomCode = "";
  /** ¿Estamos ya en la pantalla post-partida? (evita entrar dos veces). */
  private inOnlinePost = false;

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

  /** Abre la clasificación (ranking) desde el menú. */
  private async openRanking(): Promise<void> {
    await this.transition(() => {
      this.hideMenu();
      this.rankingScreen.show();
    });
  }

  /** Abre los cofres (gacha) desde el menú. */
  private async openGacha(): Promise<void> {
    await this.transition(() => {
      this.hideMenu();
      this.gachaScreen.show();
    });
  }

  /** Abre el online (crear/unirse a sala P2P) desde el menú. */
  private async openOnline(): Promise<void> {
    await this.transition(() => {
      this.hideMenu();
      this.onlineScreen.show();
    });
  }

  /** La red está lista: pasamos de la sala al lobby de selección. */
  private openOnlineLobby(net: OnlineNetwork, roomCode: string): void {
    this.onlineNet = net;
    this.onlineRoomCode = roomCode;
    const myName = this.currentUser?.nickname ?? `Jugador ${net.mySlot + 1}`;
    void this.transition(() => {
      this.onlineScreen.hide();
      this.onlineLobby.open(net, myName, roomCode);
    });
  }

  /**
   * Arranca la partida ONLINE con la config acordada en el lobby. Todos los
   * clientes construyen el MISMO mundo (misma semilla → determinista) y lanzan
   * el bucle de lockstep (host-relay). Los apodos vienen como etiquetas.
   */
  private startOnlineMatch(
    seed: number,
    characters: CharacterId[],
    stage: StageId,
    names: string[],
  ): void {
    const net = this.onlineNet;
    if (!net) return;

    // Slots ocupados (= índices de jugador en orden). En online siempre 0..n-1.
    const slots = characters.map((_, i) => i);
    this.onlineInfo = { characters, stage, names, slots };
    this.onlineConfirmed = new Set();
    this.inOnlinePost = false;

    const config: MatchConfig = {
      characters,
      stage,
      controllers: characters.map(() => "human" as const),
      labels: names,
    };
    const world = new World("versus", seed, config);
    this.world = world;

    void this.transition(() => {
      this.onlineLobby.hide();
      this.onlinePost.hide();
      this.onlineLoop = new OnlineLoop(
        world,
        renderer,
        camera,
        net,
        { seed, characters, stage, labels: names },
        {
          onGameOver: (winnerIndex) => this.onOnlineGameOver(winnerIndex),
          onCountdown: (text) => this.countdown.set(text),
          // Al terminar: cartel "FINISH" dramático (como en offline) antes de
          // la pantalla de resultados.
          onFinish: () => this.matchOver.showFinish(),
          // Mensajes post-partida que llegan mientras el loop sigue vivo
          // (p.ej. el "result" del host): los procesa el flujo post-partida.
          onPostMessage: (from, data) => this.onOnlineMessage(from, data),
        },
      );
      // Si algún jugador se desconecta durante la partida, cortamos y avisamos.
      net.setPeerLeftHandler((slot) => this.onOnlinePeerLeft(slot));
      camera.resize(renderer.cssWidth, renderer.cssHeight);
      this.onlineLoop.start();
      // Activa el menú de pausa online (Escape lo abre; no congela el juego).
      this.onlinePause.setActive(true);
    });
  }

  /**
   * Fin de partida online. El HOST arma el resultado y el replay completo y los
   * difunde; todos (host incluido) muestran la pantalla post-partida y envían el
   * replay al servidor con SU slot para puntuar. El resto del flujo (aceptar,
   * decisión del host) va por `onOnlineMessage`.
   */
  private onOnlineGameOver(winnerIndex: number): void {
    const net = this.onlineNet;
    const loop = this.onlineLoop;
    const world = this.world;
    if (!net || !loop) return;

    // A partir de aquí la red la gestiona el flujo post-partida.
    net.setMessageHandler((from, data) => this.onOnlineMessage(from, data));

    if (net.mySlot === 0) {
      // HOST: arma el resultado + replay y lo difunde; luego muestra su pantalla.
      const results = this.collectOnlineResults(winnerIndex);
      const draw = (world?.draw ?? winnerIndex < 0) || winnerIndex < 0;
      const replay = loop.buildReplay();
      if (replay) {
        net.broadcast(
          encodeLobby({ t: "result", winnerSlot: winnerIndex, draw, results, replay }),
        );
      }
      this.enterOnlinePost(results, winnerIndex, draw, replay);
    } else {
      // GUEST: para el loop y ESPERA el "result" del host (lleva el replay).
      this.onlineLoop?.stop();
      this.onlineLoop = null;
    }
  }

  /** Recoge las stats de todos los combatientes del mundo (en orden de slot). */
  private collectOnlineResults(winnerIndex: number): OnlineFighterResult[] {
    const world = this.world;
    if (!world) return [];
    return world.fighters.map((f) => ({
      slot: f.index,
      label: f.label,
      color: f.color,
      character: f.characterId,
      dealt: f.player.stats.dealt,
      taken: f.player.stats.taken,
      blocked: f.player.stats.blocked,
      kos: f.player.stats.kos,
      deaths: f.player.stats.deaths,
      isWinner: f.index === winnerIndex,
    }));
  }

  /** Muestra la pantalla post-partida y envía el replay al servidor a puntuar. */
  private enterOnlinePost(
    results: OnlineFighterResult[],
    winnerSlot: number,
    draw: boolean,
    replay: ReplayData | null,
  ): void {
    const net = this.onlineNet;
    if (!net) return;
    if (this.inOnlinePost) return; // ya mostrada (evita entrar dos veces)
    this.inOnlinePost = true;
    this.onlineLoop?.stop();
    this.onlineLoop = null;
    this.onlinePause.setActive(false); // la partida terminó: cierra la pausa
    this.countdown.set(null);
    this.koFlash.set(0);
    this.matchOver.hide(); // quita el cartel "FINISH" antes del panel online

    const slots = this.onlineInfo?.slots ?? results.map((r) => r.slot);
    this.onlinePost.show(results, winnerSlot, draw, net.mySlot, net.mySlot === 0, slots);

    if (replay) {
      // Guardamos el replay localmente con los NOMBRES correctos de los
      // jugadores (vienen en `labels`) y el resumen de resultado, igual que
      // offline. Lo hace cada cliente con el replay completo (host o guest).
      this.saveOnlineReplay(replay, results, winnerSlot, draw);
      // Enviar al servidor para puntuar (si tengo sesión).
      void this.submitOnlineForRewards(replay, net.mySlot);
    }
  }

  /** Completa el replay online con su resumen de resultado y lo guarda. */
  private saveOnlineReplay(
    replay: ReplayData,
    results: OnlineFighterResult[],
    winnerSlot: number,
    draw: boolean,
  ): void {
    const winner = results.find((r) => r.slot === winnerSlot);
    const result: ReplayResult = {
      winnerLabel: draw ? "Empate" : winner?.label ?? "nadie",
      winnerColor: draw ? "#f1f4fa" : winner?.color ?? "#f1f4fa",
      draw,
      durationSec: replay.steps.length / 60,
      fighters: results
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map((r) => ({
          label: r.label,
          color: r.color,
          character: r.character,
          dealt: r.dealt,
          taken: r.taken,
          blocked: r.blocked,
          kos: r.kos,
          deaths: r.deaths,
          isWinner: r.slot === winnerSlot,
        })),
    };
    // El replay ya trae `labels` con los nombres del lobby. Adjuntamos el
    // resumen y lo guardamos en el navegador (aparece en la lista de replays).
    saveReplay({ ...replay, result });
  }

  private async submitOnlineForRewards(replay: ReplayData, slot: number): Promise<void> {
    const outcome = await submitOnlineMatch(replay, slot);
    switch (outcome.kind) {
      case "ok":
        this.onlinePost.setReward(`monedas · ${outcome.reward.grade}`, outcome.reward.coinsEarned);
        void this.checkAuth();
        break;
      case "no-session":
        this.onlinePost.setReward("Inicia sesión para ganar monedas", null);
        break;
      case "not-ranked":
      case "error":
        this.onlinePost.setReward(outcome.message, null);
        break;
    }
  }

  /** Mensajes de red durante el POST-partida (resultado / aceptaciones / decisión). */
  private onOnlineMessage(_from: number, data: string): void {
    const msg = decodeLobby(data);
    if (!msg) return;
    const net = this.onlineNet;
    if (!net) return;

    if (net.mySlot === 0) {
      // HOST
      if (msg.t === "confirm") {
        this.onlineConfirmed.add(msg.slot);
        const slots = [...this.onlineConfirmed];
        net.broadcast(encodeLobby({ t: "confirmed", slots }));
        this.onlinePost.setConfirmed(slots);
      }
    } else {
      // GUEST
      if (msg.t === "result") {
        // Recibo el resultado y el replay del host: muestro la pantalla.
        this.enterOnlinePost(msg.results, msg.winnerSlot, msg.draw, msg.replay);
      } else if (msg.t === "confirmed") {
        this.onlinePost.setConfirmed(msg.slots);
      } else if (msg.t === "post") {
        this.applyOnlinePost(msg.action);
      }
    }
  }

  /** El jugador local pulsa "Aceptar". */
  private onlineAccept(): void {
    const net = this.onlineNet;
    if (!net) return;
    if (net.mySlot === 0) {
      // El host se auto-confirma y redifunde.
      this.onlineConfirmed.add(0);
      const slots = [...this.onlineConfirmed];
      net.broadcast(encodeLobby({ t: "confirmed", slots }));
      this.onlinePost.setConfirmed(slots);
    } else {
      net.sendTo(0, encodeLobby({ t: "confirm", slot: net.mySlot }));
    }
  }

  /** Solo HOST: decide qué hacer tras aceptar todos. */
  private onlineHostDecide(action: "rematch" | "lobby"): void {
    const net = this.onlineNet;
    if (!net || net.mySlot !== 0) return;
    net.broadcast(encodeLobby({ t: "post", action }));
    this.applyOnlinePost(action);
  }

  /** Aplica la decisión del host: revancha (misma gente) o volver al lobby. */
  private applyOnlinePost(action: "rematch" | "lobby"): void {
    const net = this.onlineNet;
    const info = this.onlineInfo;
    this.onlinePost.hide();
    this.inOnlinePost = false;
    if (action === "rematch" && net && info) {
      // Nueva semilla; el host la decide y la difunde al arrancar.
      if (net.mySlot === 0) {
        const seed = (Math.random() * 0xffffffff) >>> 0;
        net.broadcast(
          encodeLobby({
            t: "start",
            seed,
            characters: info.characters,
            stage: info.stage,
            names: info.names,
          }),
        );
        this.startOnlineMatch(seed, info.characters, info.stage, info.names);
      } else {
        // El guest espera el "start" del host (lo escucha abajo).
        net.setMessageHandler((_from, data) => {
          const m = decodeLobby(data);
          if (m && m.t === "start") {
            this.startOnlineMatch(m.seed, m.characters, m.stage, m.names);
          }
        });
      }
    } else {
      // Volver al lobby de selección con la misma red.
      const myName = this.currentUser?.nickname ?? `Jugador ${(net?.mySlot ?? 0) + 1}`;
      if (net) this.onlineLobby.open(net, myName, this.onlineRoomCode);
    }
  }

  /** Un jugador se fue de la partida/sala online: cortamos y volvemos al menú. */
  private onOnlinePeerLeft(slot: number): void {
    this.onlineLoop?.stop();
    this.onlineLoop = null;
    this.onlinePause.setActive(false);
    this.onlinePost.hide();
    const who = slot === 0 ? "El anfitrión" : "Un jugador";
    void confirmDialog({
      title: "Jugador desconectado",
      message: `${who} ha abandonado la partida online. Volverás al menú.`,
      confirmText: "Entendido",
      cancelText: "Volver",
    }).then(() => void this.quitOnline());
  }

  /** Termina la partida online, cierra la red y vuelve al menú. */
  private quitOnline(): void {
    this.onlineLoop?.stop();
    this.onlineLoop = null;
    this.onlinePause.setActive(false);
    this.onlinePost.hide();
    this.inOnlinePost = false;
    this.onlineNet?.close();
    this.onlineNet = null;
    this.onlineInfo = null;
    void this.toMenu();
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
