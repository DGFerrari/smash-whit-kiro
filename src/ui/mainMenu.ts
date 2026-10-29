import type { GameMode } from "../game/world.ts";

/**
 * Menú principal del juego, en dos fases:
 *  1. TÍTULO: logo provisional + "Press start"; se entra con Enter (o clic).
 *  2. SELECCIÓN: título arriba a la izquierda, lista de modos a la izquierda
 *     (con indicador ">" en el seleccionado), botón Jugar abajo a la derecha, y
 *     la descripción del modo abajo en el centro.
 *
 * Es un overlay DOM. Al pulsar Jugar con un modo jugable elegido, llama a
 * onPlay. La opción "dev" se puede seleccionar pero deshabilita Jugar (no está
 * terminada).
 */
export interface MainMenuCallbacks {
  /** Inicia una partida en el modo dado (siempre se graba el replay). */
  onPlay: (mode: GameMode) => void;
  /** Abrir la lista de repeticiones guardadas. */
  onOpenReplays: () => void;
  /** Abrir el tutorial. */
  onOpenTutorial: () => void;
}

/** Valor de una opción del menú: modo jugable, ver replay o tutorial. */
type MenuOption = GameMode | "replay" | "tutorial";

/** Clave de localStorage: ¿el jugador ya ha hecho el tutorial alguna vez? */
const TUTORIAL_DONE_KEY = "smashb.tutorialDone.v1";

/** ¿Se ha completado el tutorial alguna vez? (para el parpadeo del menú). */
export function isTutorialDone(): boolean {
  return localStorage.getItem(TUTORIAL_DONE_KEY) === "1";
}
/** Marca el tutorial como completado (deja de parpadear en el menú). */
export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, "1");
  } catch {
    /* localStorage no disponible: no pasa nada, solo seguirá parpadeando. */
  }
}

interface ModeDef {
  value: MenuOption;
  label: string;
  hint: string;
  /** ¿Es jugable? (dev no lo es: deshabilita el botón Jugar). */
  playable: boolean;
  /** Color de acento del modo. */
  accent: string;
}

const MODES: ModeDef[] = [
  {
    value: "versus",
    label: "Batalla",
    hint: "Dos jugadores en el mismo teclado. Elige personajes y escenario; gana el último en pie.",
    playable: true,
    accent: "#ff6a8b",
  },
  {
    value: "training",
    label: "Entrenamiento",
    hint: "Practica combos y recuperaciones contra un dummy configurable en un escenario con regla de distancias.",
    playable: true,
    accent: "#45c88a",
  },
  {
    value: "replay",
    label: "Replay",
    hint: "Tus partidas se guardan solas. Míralas desde la lista (o importa un .json): pausa, velocidad, avance/retroceso y cámara libre.",
    playable: true,
    accent: "#f0b429",
  },
  {
    value: "tutorial",
    label: "Tutorial",
    hint: "Aprende los controles: moverte, saltar, atacar, el escudo y más, completando objetivos.",
    playable: true,
    accent: "#9b6bff",
  },
];

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly titlePhase: HTMLDivElement;
  private readonly selectPhase: HTMLDivElement;
  private readonly rows = new Map<MenuOption, HTMLButtonElement>();
  private readonly hintEl: HTMLParagraphElement;
  private readonly playBtn: HTMLButtonElement;
  /** Logo compartido entre fases: se desliza del centro a arriba-izquierda. */
  private readonly logo: HTMLHeadingElement;
  private selected: MenuOption | null = null;
  private phase: "title" | "select" = "title";

  constructor(private readonly cb: MainMenuCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "main-menu";

    // Logo ÚNICO compartido: su posición la decide la clase de fase del root,
    // así la transición de centro -> arriba-izquierda es un deslizamiento suave.
    this.logo = document.createElement("h1");
    this.logo.className = "menu-logo";
    this.logo.textContent = "Título";
    this.root.appendChild(this.logo);

    // --- Fase 1: título (solo "Press start"; el logo es el compartido) ---
    this.titlePhase = document.createElement("div");
    this.titlePhase.className = "menu-title-phase";
    const press = document.createElement("div");
    press.className = "menu-press-start";
    press.textContent = "Press start";
    this.titlePhase.appendChild(press);
    this.titlePhase.addEventListener("click", () => this.enterSelect());
    this.root.appendChild(this.titlePhase);

    // --- Fase 2: selección ---
    this.selectPhase = document.createElement("div");
    this.selectPhase.className = "menu-select-phase";

    // Lista de modos (a la izquierda).
    const list = document.createElement("div");
    list.className = "mode-list";
    for (const def of MODES) {
      const row = this.buildModeRow(def);
      this.rows.set(def.value, row);
      list.appendChild(row);
    }
    this.selectPhase.appendChild(list);

    // Descripción del modo (abajo, centrada).
    this.hintEl = document.createElement("p");
    this.hintEl.className = "mode-hint";
    this.hintEl.textContent = "Selecciona un modo.";
    this.selectPhase.appendChild(this.hintEl);

    // Botón Jugar (abajo a la derecha).
    this.playBtn = document.createElement("button");
    this.playBtn.type = "button";
    this.playBtn.className = "menu-btn play-btn";
    this.playBtn.textContent = "jugar";
    this.playBtn.disabled = true;
    this.playBtn.addEventListener("click", () => this.tryPlay());
    this.selectPhase.appendChild(this.playBtn);

    this.root.appendChild(this.selectPhase);
    document.body.appendChild(this.root);

    window.addEventListener("keydown", this.onKey);
  }

  show(): void {
    this.phase = "title";
    this.root.classList.remove("in-select", "mode-chosen");
    this.root.classList.add("open", "in-title");

    // Entramos SIN ningún modo seleccionado.
    this.selected = null;
    for (const row of this.rows.values()) row.classList.remove("selected");
    this.hintEl.textContent = "Selecciona un modo.";
    this.hintEl.style.color = "";
    this.playBtn.disabled = true;

    // Reevaluamos el parpadeo del Tutorial (puede haberse completado ya).
    const tut = this.rows.get("tutorial");
    if (tut) tut.classList.toggle("nudge", !isTutorialDone());
  }

  hide(): void {
    this.root.classList.remove("open");
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.root.classList.contains("open")) return;
    if (this.phase === "title" && e.key === "Enter") {
      e.preventDefault();
      this.enterSelect();
    } else if (this.phase === "select" && e.key === "Enter") {
      e.preventDefault();
      this.tryPlay();
    }
  };

  /** Pasa de la fase título a la de selección. */
  private enterSelect(): void {
    if (this.phase === "select") return;
    this.phase = "select";
    this.root.classList.remove("in-title");
    this.root.classList.add("in-select");
  }

  private tryPlay(): void {
    if (!this.selected) return;
    const def = MODES.find((m) => m.value === this.selected);
    if (!def || !def.playable) return;
    if (this.selected === "replay") {
      // La opción Replay abre la lista de repeticiones guardadas.
      this.cb.onOpenReplays();
      return;
    }
    if (this.selected === "tutorial") {
      this.cb.onOpenTutorial();
      return;
    }
    this.cb.onPlay(this.selected as GameMode);
  }

  private buildModeRow(def: ModeDef): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mode-row";
    btn.style.setProperty("--accent", def.accent);

    // El Tutorial parpadea (clase "nudge") si el jugador nunca lo ha completado.
    if (def.value === "tutorial" && !isTutorialDone()) {
      btn.classList.add("nudge");
    }

    // Indicador ">" que aparece solo en el seleccionado.
    const caret = document.createElement("span");
    caret.className = "mode-caret";
    caret.textContent = "❯";
    btn.appendChild(caret);

    const name = document.createElement("span");
    name.className = "mode-row-label";
    name.textContent = def.label;
    btn.appendChild(name);

    btn.addEventListener("click", () => this.select(def));
    return btn;
  }

  private select(def: ModeDef): void {
    this.selected = def.value;
    for (const [value, row] of this.rows) {
      row.classList.toggle("selected", value === def.value);
    }
    this.root.style.setProperty("--menu-accent", def.accent);
    this.root.classList.add("mode-chosen");
    this.hintEl.textContent = def.hint;
    this.hintEl.style.color = def.accent;

    // La opción "dev" no es jugable: deshabilita Jugar.
    this.playBtn.disabled = !def.playable;
    this.playBtn.style.setProperty("--accent", def.accent);
  }
}

/**
 * Pantalla de fin de partida (versus): primero un "FINISH" dramático, luego un
 * podio con las calificaciones de cada jugador (daño infligido/recibido/
 * bloqueado, KOs, muertes y una nota global).
 */
export interface FighterResult {
  label: string;
  color: string;
  dealt: number;
  taken: number;
  blocked: number;
  kos: number;
  deaths: number;
  isWinner: boolean;
}

export interface MatchOverCallbacks {
  onRematch: () => void;
  onMenu: () => void;
  /** Ir a la lista de repeticiones (la partida ya quedó guardada). */
  onViewReplays: () => void;
}

export class MatchOverScreen {
  private readonly root: HTMLDivElement;
  private readonly finishEl: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly podium: HTMLDivElement;
  private finishTimer = 0;

  constructor(private readonly cb: MatchOverCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "match-over";

    // Cartel "FINISH" que aparece primero.
    this.finishEl = document.createElement("div");
    this.finishEl.className = "finish-text";
    this.finishEl.textContent = "FINISH";
    this.root.appendChild(this.finishEl);

    // Panel con el podio (aparece tras el FINISH).
    this.panel = document.createElement("div");
    this.panel.className = "menu-panel results-panel";

    this.titleEl = document.createElement("h1");
    this.titleEl.className = "menu-title";
    this.panel.appendChild(this.titleEl);

    this.podium = document.createElement("div");
    this.podium.className = "podium";
    this.panel.appendChild(this.podium);

    const actions = document.createElement("div");
    actions.className = "results-actions";

    // Revancha: botón primario (acento, icono de repetir).
    const rematch = document.createElement("button");
    rematch.type = "button";
    rematch.className = "result-btn result-btn-rematch";
    rematch.innerHTML =
      '<span class="result-btn-icon">↻</span><span class="result-btn-text">Revancha</span><span class="result-btn-sub">Misma config</span>';
    rematch.addEventListener("click", () => this.cb.onRematch());
    actions.appendChild(rematch);

    // Ver repeticiones: la partida se guarda sola; este botón lleva a la lista.
    const replays = document.createElement("button");
    replays.type = "button";
    replays.className = "result-btn result-btn-download";
    replays.innerHTML =
      '<span class="result-btn-icon">▶</span><span class="result-btn-text">Ver repeticiones</span><span class="result-btn-sub">Guardada automáticamente</span>';
    replays.addEventListener("click", () => this.cb.onViewReplays());
    actions.appendChild(replays);

    // Menú: botón secundario (neutro, icono de casa).
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "result-btn result-btn-menu";
    menu.innerHTML =
      '<span class="result-btn-icon">⌂</span><span class="result-btn-text">Menú principal</span><span class="result-btn-sub">Salir de la partida</span>';
    menu.addEventListener("click", () => this.cb.onMenu());
    actions.appendChild(menu);
    this.panel.appendChild(actions);

    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
  }

  /** Muestra SOLO el cartel "FINISH" (durante la cámara lenta del remate). */
  showFinish(): void {
    this.root.classList.add("open");
    this.panel.classList.remove("show");
    this.finishEl.classList.remove("show");
    void this.finishEl.offsetWidth;
    this.finishEl.classList.add("show");
  }

  /**
   * Muestra el podio tras el FINISH, con entrada en dos tiempos: primero el
   * GANADOR destacado y, un instante después, se acopla el perdedor.
   */
  show(winnerLabel: string, winnerColor: string, results: FighterResult[]): void {
    this.root.classList.add("open");
    this.finishEl.classList.remove("show");
    this.buildPodium(winnerLabel, winnerColor, results);
    this.panel.classList.add("show");
  }

  private buildPodium(
    winnerLabel: string,
    winnerColor: string,
    results: FighterResult[],
  ): void {
    this.titleEl.textContent =
      winnerLabel === "Empate" ? "¡Empate!" : `¡Gana ${winnerLabel}!`;
    this.titleEl.style.color = winnerColor;

    // Ganador primero; el resto después (orden de entrada).
    const sorted = [...results].sort(
      (a, b) => Number(b.isWinner) - Number(a.isWinner) || b.dealt - a.dealt,
    );

    this.podium.replaceChildren();
    sorted.forEach((r, i) => {
      const card = this.buildCard(r);
      // Entrada escalonada: el ganador entra ya; los demás, con retraso, para
      // que se vea primero al ganador y luego se "acople" el perdedor.
      card.style.animationDelay = r.isWinner ? "0s" : `${0.7 + i * 0.15}s`;
      this.podium.appendChild(card);
    });
    // Marca para que el ganador tenga su efecto extra de realce.
    window.clearTimeout(this.finishTimer);
  }

  private buildCard(r: FighterResult): HTMLElement {
    const card = document.createElement("div");
    card.className = "podium-card";
    card.style.borderColor = r.color;
    if (r.isWinner) card.classList.add("winner");

    const head = document.createElement("div");
    head.className = "podium-head";
    head.style.color = r.color;
    head.textContent = r.isWinner ? `🏆 ${r.label}` : r.label;
    card.appendChild(head);

    const grade = document.createElement("div");
    grade.className = "podium-grade";
    grade.textContent = this.grade(r);
    card.appendChild(grade);

    const rows: Array<[string, string]> = [
      ["Daño infligido", `${Math.round(r.dealt)}%`],
      ["Daño recibido", `${Math.round(r.taken)}%`],
      ["Daño bloqueado", `${Math.round(r.blocked)}%`],
      ["KOs", String(r.kos)],
      ["Muertes", String(r.deaths)],
    ];
    const stats = document.createElement("div");
    stats.className = "podium-stats";
    for (const [k, v] of rows) {
      const row = document.createElement("div");
      row.className = "podium-stat";
      const kEl = document.createElement("span");
      kEl.textContent = k;
      const vEl = document.createElement("span");
      vEl.className = "podium-stat-value";
      vEl.textContent = v;
      row.appendChild(kEl);
      row.appendChild(vEl);
      stats.appendChild(row);
    }
    card.appendChild(stats);
    return card;
  }

  /** Nota global simple a partir de las stats (no es ciencia, es sabor). */
  private grade(r: FighterResult): string {
    const score = r.dealt + r.kos * 40 + r.blocked * 0.5 - r.taken * 0.6 - r.deaths * 25;
    if (score >= 220) return "S";
    if (score >= 150) return "A";
    if (score >= 90) return "B";
    if (score >= 40) return "C";
    return "D";
  }

  hide(): void {
    window.clearTimeout(this.finishTimer);
    this.root.classList.remove("open");
    this.panel.classList.remove("show");
    this.finishEl.classList.remove("show");
  }
}
