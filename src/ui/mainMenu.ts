import type { GameMode } from "../game/world.ts";

/**
 * Menú principal del juego. Pantalla inicial donde se elige el modo de juego:
 *  - Entrenamiento: un jugador + un dummy de pruebas.
 *  - Versus local: dos jugadores humanos en el mismo teclado.
 *
 * Es un overlay DOM a pantalla completa. Al elegir un modo, llama a onPlay con
 * el modo elegido; la capa de app (main.ts) se encarga de arrancar la partida.
 */
export interface MainMenuCallbacks {
  onPlay: (mode: GameMode) => void;
}

interface ModeDef {
  mode: GameMode;
  label: string;
  hint: string;
  /** Color de acento del modo (botón seleccionado, fondo, descripción). */
  accent: string;
}

const MODES: ModeDef[] = [
  {
    mode: "training",
    label: "Entrenamiento",
    hint: "Practica combos y recuperaciones contra un dummy configurable en un escenario con regla de distancias.",
    accent: "#45c88a",
  },
  {
    mode: "versus",
    label: "Versus local",
    hint: "Dos jugadores en el mismo teclado. Se pierde al quedarte sin vidas; gana el último en pie.",
    accent: "#ff6a8b",
  },
];

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly cards = new Map<GameMode, HTMLButtonElement>();
  private readonly hintEl: HTMLParagraphElement;
  private readonly playBtn: HTMLButtonElement;
  private selected: GameMode | null = null;

  constructor(private readonly cb: MainMenuCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "main-menu";

    const panel = document.createElement("div");
    panel.className = "menu-panel";

    const title = document.createElement("h1");
    title.className = "menu-title";
    title.textContent = "smash-B";
    panel.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "menu-subtitle";
    subtitle.textContent = "Platform fighter 2D — elige un modo";
    panel.appendChild(subtitle);

    // Tarjetas de modo (seleccionables, no arrancan la partida al pulsar).
    const grid = document.createElement("div");
    grid.className = "mode-grid";
    for (const def of MODES) {
      const card = this.buildModeCard(def);
      this.cards.set(def.mode, card);
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    // Descripción del modo seleccionado.
    this.hintEl = document.createElement("p");
    this.hintEl.className = "mode-hint";
    this.hintEl.textContent = "Selecciona un modo para empezar.";
    panel.appendChild(this.hintEl);

    // Botón Jugar (deshabilitado hasta elegir modo).
    this.playBtn = document.createElement("button");
    this.playBtn.type = "button";
    this.playBtn.className = "menu-btn play-btn";
    this.playBtn.textContent = "Jugar";
    this.playBtn.disabled = true;
    this.playBtn.addEventListener("click", () => {
      if (this.selected) this.cb.onPlay(this.selected);
    });
    panel.appendChild(this.playBtn);

    this.root.appendChild(panel);
    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add("open");
  }

  hide(): void {
    this.root.classList.remove("open");
  }

  private buildModeCard(def: ModeDef): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mode-card";
    btn.style.setProperty("--accent", def.accent);

    const name = document.createElement("span");
    name.className = "mode-card-label";
    name.textContent = def.label;
    btn.appendChild(name);

    btn.addEventListener("click", () => this.select(def));
    return btn;
  }

  private select(def: ModeDef): void {
    this.selected = def.mode;
    // Marca la tarjeta elegida y desmarca las demás.
    for (const [mode, card] of this.cards) {
      card.classList.toggle("selected", mode === def.mode);
    }
    // Acento del fondo y de la descripción según el modo.
    this.root.style.setProperty("--menu-accent", def.accent);
    this.root.classList.add("mode-chosen");
    this.hintEl.textContent = def.hint;
    this.hintEl.style.color = def.accent;
    this.playBtn.disabled = false;
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
    const rematch = document.createElement("button");
    rematch.type = "button";
    rematch.className = "menu-btn";
    rematch.textContent = "Revancha";
    rematch.addEventListener("click", () => this.cb.onRematch());
    actions.appendChild(rematch);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "menu-btn";
    menu.textContent = "Menú principal";
    menu.addEventListener("click", () => this.cb.onMenu());
    actions.appendChild(menu);
    this.panel.appendChild(actions);

    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
  }

  /**
   * Muestra la secuencia: FINISH -> podio. `results` ya viene ordenado o no;
   * aquí ordenamos poniendo al ganador primero.
   */
  show(winnerLabel: string, winnerColor: string, results: FighterResult[]): void {
    this.root.classList.add("open");

    // Fase 1: FINISH.
    this.finishEl.classList.remove("show");
    this.panel.classList.remove("show");
    void this.finishEl.offsetWidth;
    this.finishEl.classList.add("show");

    // Fase 2: tras un instante, el podio.
    window.clearTimeout(this.finishTimer);
    this.finishTimer = window.setTimeout(() => {
      this.finishEl.classList.remove("show");
      this.buildPodium(winnerLabel, winnerColor, results);
      this.panel.classList.add("show");
    }, 1400);
  }

  private buildPodium(
    winnerLabel: string,
    winnerColor: string,
    results: FighterResult[],
  ): void {
    this.titleEl.textContent = `¡Gana ${winnerLabel}!`;
    this.titleEl.style.color = winnerColor;

    const sorted = [...results].sort(
      (a, b) => Number(b.isWinner) - Number(a.isWinner) || b.dealt - a.dealt,
    );

    this.podium.replaceChildren();
    for (const r of sorted) {
      this.podium.appendChild(this.buildCard(r));
    }
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
