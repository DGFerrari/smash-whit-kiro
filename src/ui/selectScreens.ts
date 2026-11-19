import {
  CHARACTERS,
  SELECTABLE_CHARACTERS,
  type CharacterId,
} from "../engine/game/characters.ts";
import { SELECTABLE_STAGES, type StageId } from "../engine/game/stages.ts";
import { characterLore, stageLore } from "../content/lore.ts";
import { createCharacterPortrait, createStagePreview } from "./brand/portraits.ts";
import { button, setDisabled } from "./design/components.ts";
import type { HandCursor } from "./handCursor.ts";
import { screenNav } from "./nav/screenNav.ts";
import { backHint, keyHint } from "./nav/keyHints.ts";
import { setLegend, type LegendItem } from "./nav/legend.ts";
import { CharacterPreview3D } from "./characterPreview3d.ts";
import "./selectScreens.css";

/**
 * Pantallas de selección estilo Super Smash Bros. con FICHAS ARRASTRABLES
 * (rediseño KiroBrawl: R1.7, R3.1, R3.2, R3.3, R3.6, R3.7).
 *
 *  - CharacterSelect: fila de tarjetas inclinadas (retrato SVG + nombre
 *    visible) y, abajo, una placa por jugador (P1–P4) con su FICHA. Agarras la
 *    ficha con el cursor y la sueltas sobre un retrato para elegir ese
 *    personaje. A la derecha, el panel del personaje ENFOCADO: vista previa
 *    (hueco `.kb-preview3d`, de momento con el retrato grande como
 *    Modelo_Respaldo provisional), nombre, título y lore. El panel se
 *    actualiza en el mismo frame en que cambia el foco.
 *  - StageSelect: rejilla 2×2 de tarjetas con vista previa SVG y nombre, la
 *    vista previa grande del escenario enfocado con su descripción, y una
 *    ficha que arrastras sobre el mapa elegido.
 *
 * El arrastre usa Pointer Events; durante el arrastre avisamos al HandCursor
 * para que muestre la mano "agarrando".
 */

const TOKEN_COLORS = ["#2f6bff", "#ff4f6d", "#f0c23a", "#5fcf80"] as const;
const TOKEN_LABELS = ["P1", "P2", "P3", "P4"] as const;
/** Nº máximo de jugadores (slots). */
const MAX_SLOTS = 4;

/** Control de un slot: humano, CPU, o deshabilitado (no participa). */
type SlotControl = "human" | "cpu" | "off";
type CpuDiff = "easy" | "normal" | "hard";

/** Lo que puede elegir un slot: un personaje concreto o "aleatorio". */
type PickId = CharacterId | "random";
const RANDOM = "random" as const;

/** Retrato SVG de la tarjeta "Aleatorio": interrogante sobre fondo arcoíris. */
function randomPortrait(className?: string): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 200 240");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("class", className ? `kb-portrait kb-portrait--random ${className}` : "kb-portrait kb-portrait--random");
  svg.setAttribute("aria-hidden", "true");
  const colors = SELECTABLE_CHARACTERS.map((id) => CHARACTERS[id].color);
  const w = 200 / colors.length;
  colors.forEach((c, i) => {
    const r = document.createElementNS(NS, "polygon");
    const x = i * w;
    r.setAttribute("points", `${x - 40},240 ${x + w - 40},240 ${x + w + 40},0 ${x + 40},0`);
    r.setAttribute("fill", c);
    r.setAttribute("opacity", "0.55");
    svg.appendChild(r);
  });
  const q = document.createElementNS(NS, "text");
  q.setAttribute("x", "100");
  q.setAttribute("y", "165");
  q.setAttribute("text-anchor", "middle");
  q.setAttribute("font-size", "150");
  q.setAttribute("font-family", "Russo One, sans-serif");
  q.setAttribute("font-style", "italic");
  q.setAttribute("fill", "#ffffff");
  q.setAttribute("stroke", "#0b1024");
  q.setAttribute("stroke-width", "8");
  q.setAttribute("paint-order", "stroke");
  q.textContent = "?";
  svg.appendChild(q);
  return svg;
}

/** Una ficha arrastrable con su estado de colocación. */
interface Chip {
  el: HTMLDivElement;
  player: number;
  /** Personaje/mapa sobre el que está colocada, o null. */
  placedOn: string | null;
  /** Posición "en reposo" (home) a la que vuelve si sueltas en el vacío. */
  homeLeft: number;
  homeTop: number;
  dragging: boolean;
}

function div(className: string, text?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Cabecera común: título inclinado + pista de uso. */
function buildHeader(titleText: string, hintText: string): HTMLElement {
  const header = div("kb-select__header");
  const title = document.createElement("h1");
  title.className = "select-title";
  title.textContent = titleText;
  header.appendChild(title);
  const hint = document.createElement("p");
  hint.className = "select-hint";
  hint.textContent = hintText;
  header.appendChild(hint);
  return header;
}

export interface CharacterSelectCallbacks {
  /**
   * Confirma la selección. Se pasan solo los slots ACTIVOS (2..4), en orden:
   *  - characters: personaje de cada jugador activo.
   *  - controllers: "human" | "cpu" por jugador activo.
   *  - cpuDifficulties: dificultad de CADA jugador activo (alineada con los
   *    anteriores). Para los humanos el valor es irrelevante pero se incluye
   *    para mantener los arrays alineados por índice.
   */
  onConfirm: (
    characters: CharacterId[],
    controllers: ("human" | "cpu")[],
    cpuDifficulties: CpuDiff[],
    /** Etiqueta/nombre de cada jugador activo (apodo del usuario en P1). */
    labels: string[],
  ) => void;
  onBack: () => void;
}

export class CharacterSelect {
  private readonly root: HTMLDivElement;
  private readonly nav = screenNav(() => this.root);
  private readonly stage: HTMLDivElement;
  private readonly cells = new Map<PickId, HTMLButtonElement>();
  private readonly chips: Chip[] = [];
  /** Temporizador que va rotando la vista 3D mientras se enfoca "Aleatorio". */
  private randomSpin = 0;
  private readonly goBtn: HTMLButtonElement;

  /** Panel del personaje enfocado. */
  private readonly panel: HTMLElement;
  private readonly preview3d: HTMLDivElement;
  private readonly panelName: HTMLHeadingElement;
  /** Etiqueta "CROSSOVER · franquicia" (solo invitados). */
  private readonly panelGuest: HTMLDivElement;
  private readonly panelTitle: HTMLDivElement;
  private readonly panelLore: HTMLParagraphElement;
  /** Retratos grandes ya construidos (se reutilizan al cambiar el foco). */
  private readonly previewCache = new Map<CharacterId, SVGSVGElement>();
  /** Vista previa 3D en rotación (sobre el retrato, que queda de respaldo). */
  private readonly view3d = new CharacterPreview3D({ state: "idle" });

  /** Placas de jugador y su texto "personaje elegido". */
  private readonly playerCards: HTMLElement[] = [];
  private readonly pickLabels: HTMLElement[] = [];

  /** Personaje elegido por cada slot (null = sin elegir, "random" = sorpresa). */
  private readonly picks: Array<PickId | null> = [null, null, null, null];
  /** Tarjeta enfocada en el panel lateral (`random` = Aleatorio). */
  private focused: PickId | null = null;
  /**
   * Control de cada slot. TODOS arrancan DESHABILITADOS: el jugador activa los
   * que quiera (mínimo 2 para empezar).
   */
  private readonly control: SlotControl[] = ["off", "off", "off", "off"];
  /** Dificultad de CADA slot (independiente): cada CPU puede tener la suya. */
  private readonly cpuDifficulty: CpuDiff[] = ["normal", "normal", "normal", "normal"];
  /** Apodo del usuario con sesión (etiqueta de P1 si es "Jugador"). null = sin sesión. */
  private localNickname: string | null = null;
  /** Para re-sincronizar las tarjetas tras cambios. */
  private syncers: Array<() => void> = [];

  /** Fija el apodo del usuario logueado (lo usa la etiqueta del Jugador 1). */
  setLocalNickname(nickname: string | null): void {
    this.localNickname = nickname;
    if (this.syncers.length > 0) this.syncAll();
  }

  constructor(
    private readonly cb: CharacterSelectCallbacks,
    private readonly hand: HandCursor,
  ) {
    this.root = document.createElement("div");
    this.root.id = "char-select";
    this.root.className = "select-screen kb-select";

    this.root.appendChild(
      buildHeader(
        "Elige personaje",
        "Coloca la ficha de cada jugador activo sobre un personaje, o elige con las flechas y Enter (mínimo 2)",
      ),
    );

    const body = div("kb-cs-body");

    this.stage = div("css-stage char-stage");

    const grid = div("portrait-grid");
    let guestsHeader = false;
    for (const id of SELECTABLE_CHARACTERS) {
      const lore = characterLore(id);
      // Tarjeta "Aleatorio" al final de los originales y separador de invitados.
      if (lore.crossover && !guestsHeader) {
        guestsHeader = true;
        grid.appendChild(this.buildRandomCell());
        const sep = div("kb-cs-guests");
        sep.setAttribute("role", "presentation");
        const label = document.createElement("span");
        label.textContent = "Invitados · Crossover";
        sep.appendChild(label);
        grid.appendChild(sep);
      }
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = lore.crossover ? "portrait is-crossover" : "portrait";
      cell.style.setProperty("--c", CHARACTERS[id].color);
      cell.setAttribute(
        "aria-label",
        lore.crossover ? `${lore.name}, ${lore.title}. Invitado de ${lore.crossover}` : `${lore.name}, ${lore.title}`,
      );
      cell.dataset.characterId = id;
      const face = div("portrait-face");
      face.appendChild(createCharacterPortrait(id, { decorative: true }));
      cell.appendChild(face);
      if (lore.crossover) {
        const badge = div("kb-crossover-badge");
        badge.textContent = "Crossover";
        badge.title = `Invitado de ${lore.crossover}`;
        cell.appendChild(badge);
      }
      const name = div("portrait-name");
      const nameText = document.createElement("span");
      nameText.textContent = lore.name;
      name.appendChild(nameText);
      cell.appendChild(name);
      cell.addEventListener("click", (e) => this.onCellClick(e, id));
      cell.addEventListener("pointerenter", () => this.focusCharacter(id));
      cell.addEventListener("focus", () => this.focusCharacter(id));
      this.cells.set(id, cell);
      grid.appendChild(cell);
    }
    this.stage.appendChild(grid);

    // Cuatro placas de jugador, cada una con sus pestañas de control.
    const cards = div("player-cards");
    for (let p = 0; p < MAX_SLOTS; p++) {
      cards.appendChild(this.buildPlayerCard(p));
    }
    this.stage.appendChild(cards);

    // Cuatro fichas arrastrables (se ocultan si el slot está deshabilitado).
    for (let p = 0; p < MAX_SLOTS; p++) {
      const el = div("token-chip", TOKEN_LABELS[p]);
      el.style.setProperty("--tc", TOKEN_COLORS[p]);
      const chip: Chip = {
        el,
        player: p,
        placedOn: null,
        homeLeft: 0,
        homeTop: 0,
        dragging: false,
      };
      el.addEventListener("pointerdown", (e) => this.onChipDown(e, chip));
      this.chips.push(chip);
      this.stage.appendChild(el);
    }
    body.appendChild(this.stage);

    // Panel del personaje enfocado (splash lateral).
    this.panel = document.createElement("aside");
    this.panel.className = "kb-cs-panel";
    this.panel.setAttribute("aria-live", "polite");
    this.preview3d = div("kb-preview3d");
    this.preview3d.dataset.preview = "fallback";
    this.panel.appendChild(this.preview3d);
    const info = div("kb-cs-info");
    this.panelGuest = div("kb-cs-guest-tag");
    this.panelGuest.hidden = true;
    info.appendChild(this.panelGuest);
    this.panelName = document.createElement("h2");
    this.panelName.className = "kb-cs-name";
    info.appendChild(this.panelName);
    this.panelTitle = div("kb-cs-title");
    info.appendChild(this.panelTitle);
    this.panelLore = document.createElement("p");
    this.panelLore.className = "kb-cs-lore";
    info.appendChild(this.panelLore);
    this.panel.appendChild(info);
    body.appendChild(this.panel);

    this.root.appendChild(body);

    const actions = div("select-actions");
    const back = button({ label: "‹ Atrás", variant: "ghost", onActivate: () => this.cb.onBack() });
    back.classList.add("kb-select__back");
    actions.appendChild(backHint(back, "Atrás"));
    this.goBtn = button({ label: "Elegir escenario ›", onActivate: () => this.confirm() });
    this.goBtn.classList.add("kb-select__go");
    actions.appendChild(keyHint(this.goBtn, "c", { pad: "start", label: "Continuar" }));
    this.root.appendChild(actions);

    setLegend(this.root, {
      accept: "Elegir",
      items: () => {
        const p = this.kbSlot;
        const items: LegendItem[] = [
          { key: "1-4", pad: "lbrb", label: `Elige: ${TOKEN_LABELS[p]}` },
          { key: "t", pad: "y", label: "Jugador/CPU/Off" },
        ];
        if (this.control[p] === "cpu") items.push({ key: "d", label: "Dificultad" });
        items.push({ key: "r", pad: "x", label: "Aleatorio" });
        if (this.picks[p]) items.push({ key: "delete", label: "Quitar" });
        return items;
      },
    });

    document.body.appendChild(this.root);
    if (SELECTABLE_CHARACTERS.length > 0) this.focusCharacter(SELECTABLE_CHARACTERS[0]);
    this.refreshSelectedStyles();
    this.updateGo();
    this.setKbSlot(0);
  }

  show(): void {
    this.root.classList.add("open");
    requestAnimationFrame(() => this.resetChips());
    const slot = (p: number) => () => this.selectSlot(p);
    this.nav.mount({
      hotkeys: {
        "1": slot(0),
        "2": slot(1),
        "3": slot(2),
        "4": slot(3),
        t: () => this.cycleControl(this.kbSlot),
        d: () => this.cycleDifficulty(this.kbSlot),
        r: () => this.assignByKeyboard(RANDOM),
        delete: () => this.clearPick(this.kbSlot),
      },
      padHotkeys: {
        lb: () => this.selectSlot((this.kbSlot + MAX_SLOTS - 1) % MAX_SLOTS),
        rb: () => this.selectSlot((this.kbSlot + 1) % MAX_SLOTS),
        y: () => this.cycleControl(this.kbSlot),
        x: () => this.assignByKeyboard(RANDOM),
      },
    });
    this.view3d.start();
  }

  // ── Teclado / mando ─────────────────────────────────────────────────────────

  /** Slot al que se asigna el personaje elegido con Enter / botón A. */
  private kbSlot = 0;

  /** Marca el slot que recibe las elecciones de teclado/mando. */
  private setKbSlot(p: number): void {
    this.kbSlot = p;
    this.playerCards.forEach((card, i) => card.classList.toggle("kb-assigning", i === p));
    this.root.style.setProperty("--kb-slot-color", TOKEN_COLORS[p]);
  }

  /** Teclas 1–4 / LB-RB: elige el slot; si estaba apagado, lo enciende. */
  private selectSlot(p: number): void {
    if (!this.isActive(p)) this.setControl(p, p === 0 ? "human" : "cpu");
    this.setKbSlot(p);
  }

  /** Clic en una tarjeta: con teclado o mando (clic sin puntero) elige directamente. */
  private onCellClick(e: MouseEvent, id: PickId): void {
    e.preventDefault();
    if (e.detail === 0) this.assignByKeyboard(id);
  }

  /**
   * Asigna `id` al slot activo del teclado. Si ese slot está apagado usa el
   * primer slot activo sin personaje; si no hay ninguno activo, enciende P1
   * como Jugador. Después pasa al siguiente slot activo que aún no ha elegido.
   */
  private assignByKeyboard(id: PickId): void {
    let p = this.kbSlot;
    if (!this.isActive(p)) {
      const open = this.firstActive((i) => !this.picks[i]);
      p = open ?? this.firstActive(() => true) ?? 0;
      if (!this.isActive(p)) this.setControl(p, "human");
    }
    this.picks[p] = id;
    const chip = this.chips[p];
    const cell = this.cells.get(id);
    if (chip && cell) {
      chip.placedOn = id;
      chip.el.style.display = "";
      this.snapChipToCell(chip, cell, p);
    }
    this.focusCharacter(id);
    this.refreshSelectedStyles();
    this.updateGo();
    // Siguiente slot activo sin personaje (en orden circular desde p).
    for (let k = 1; k < MAX_SLOTS; k++) {
      const q = (p + k) % MAX_SLOTS;
      if (this.isActive(q) && !this.picks[q]) {
        this.setKbSlot(q);
        return;
      }
    }
    this.setKbSlot(p);
  }

  private firstActive(pred: (p: number) => boolean): number | null {
    for (let p = 0; p < MAX_SLOTS; p++) if (this.isActive(p) && pred(p)) return p;
    return null;
  }

  /** Quita el personaje del slot (la ficha vuelve a su placa). */
  private clearPick(p: number): void {
    if (!this.picks[p]) return;
    this.picks[p] = null;
    const chip = this.chips[p];
    if (chip) {
      chip.placedOn = null;
      this.moveChip(chip, chip.homeLeft, chip.homeTop);
    }
    this.refreshSelectedStyles();
    this.updateGo();
  }

  /** Jugador → CPU → Off → Jugador. */
  private cycleControl(p: number): void {
    const order: SlotControl[] = ["human", "cpu", "off"];
    this.setControl(p, order[(order.indexOf(this.control[p]) + 1) % order.length]);
  }

  private cycleDifficulty(p: number): void {
    if (this.control[p] !== "cpu") return;
    const order: CpuDiff[] = ["easy", "normal", "hard"];
    this.cpuDifficulty[p] = order[(order.indexOf(this.cpuDifficulty[p]) + 1) % order.length];
    this.syncAll();
  }

  /** Cambia el control de un slot (mismo efecto que sus pestañas). */
  private setControl(p: number, value: SlotControl): void {
    this.control[p] = value;
    if (value === "off") {
      // Al desactivar, liberamos su personaje y escondemos su ficha.
      this.picks[p] = null;
      const chip = this.chips[p];
      if (chip) chip.placedOn = null;
    }
    this.syncAll();
    this.resetChips();
    this.refreshSelectedStyles();
    this.updateGo();
  }
  hide(): void {
    this.root.classList.remove("open");
    this.nav.unmount();
    this.view3d.stop();
    window.clearInterval(this.randomSpin);
    this.randomSpin = 0;
  }

  /** Personaje mostrado ahora en el panel lateral (`random` = tarjeta Aleatorio). */
  get focusedCharacter(): PickId | null {
    return this.focused;
  }

  /** Tarjeta "Aleatorio": el personaje se sortea al confirmar. */
  private buildRandomCell(): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "portrait is-random";
    cell.style.setProperty("--c", "var(--color-focus)");
    cell.setAttribute("aria-label", "Aleatorio: personaje sorpresa");
    cell.dataset.characterId = RANDOM;
    const face = div("portrait-face");
    face.appendChild(randomPortrait());
    cell.appendChild(face);
    const name = div("portrait-name");
    const nameText = document.createElement("span");
    nameText.textContent = "Aleatorio";
    name.appendChild(nameText);
    cell.appendChild(name);
    cell.addEventListener("click", (e) => this.onCellClick(e, RANDOM));
    cell.addEventListener("pointerenter", () => this.focusCharacter(RANDOM));
    cell.addEventListener("focus", () => this.focusCharacter(RANDOM));
    this.cells.set(RANDOM, cell);
    return cell;
  }

  /** Panel del "Aleatorio": interrogante y la vista 3D rotando personajes. */
  private focusRandom(): void {
    this.panel.style.setProperty("--c", "var(--color-focus)");
    this.panel.dataset.characterId = RANDOM;
    this.panel.classList.remove("is-crossover");
    this.panelGuest.hidden = true;
    this.panelName.textContent = "Aleatorio";
    this.panelTitle.textContent = "Personaje sorpresa";
    this.panelLore.textContent =
      "¿No te decides? Deja que el destino elija por ti: al empezar la partida se sorteará cualquiera de los 12 luchadores, originales o invitados.";
    this.preview3d.replaceChildren(randomPortrait("kb-preview3d__art"), this.view3d.canvas);
    let i = Math.floor(Math.random() * SELECTABLE_CHARACTERS.length);
    const show = (): void => {
      const id = SELECTABLE_CHARACTERS[i % SELECTABLE_CHARACTERS.length];
      this.view3d.setCharacter(id, CHARACTERS[id].color);
      i++;
    };
    show();
    this.randomSpin = window.setInterval(show, 650);
    this.preview3d.dataset.preview = this.view3d.available ? "3d" : "fallback";
  }

  /**
   * Enfoca un personaje: resalta su tarjeta y sustituye, de forma síncrona (en
   * el mismo frame), el retrato grande, el nombre, el título y el lore del
   * panel lateral (R3.2). La vista previa usa el retrato como Modelo_Respaldo
   * provisional hasta que exista la vista previa 3D (R3.6).
   */
  focusCharacter(id: PickId): void {
    if (this.focused === id) return;
    this.focused = id;
    for (const [cid, cell] of this.cells) cell.classList.toggle("is-focused", cid === id);
    window.clearInterval(this.randomSpin);
    this.randomSpin = 0;
    if (id === RANDOM) {
      this.focusRandom();
      return;
    }
    const lore = characterLore(id);
    this.panel.style.setProperty("--c", CHARACTERS[id].color);
    this.panel.dataset.characterId = id;
    this.panelName.textContent = lore.name;
    this.panelGuest.hidden = !lore.crossover;
    this.panelGuest.textContent = lore.crossover ? `Crossover · ${lore.crossover}` : "";
    this.panel.classList.toggle("is-crossover", !!lore.crossover);
    this.panelTitle.textContent = lore.title;
    this.panelLore.textContent = lore.lore;
    let art = this.previewCache.get(id);
    if (!art) {
      art = createCharacterPortrait(id, { decorative: true, className: "kb-preview3d__art" });
      this.previewCache.set(id, art);
    }
    this.preview3d.replaceChildren(art, this.view3d.canvas);
    this.view3d.setCharacter(id, CHARACTERS[id].color);
    this.preview3d.dataset.preview = this.view3d.available ? "3d" : "fallback";
  }

  /** ¿Está activo el slot p? (humano o CPU; off = no participa). */
  private isActive(p: number): boolean {
    return this.control[p] !== "off";
  }

  private confirm(): void {
    if (!this.canStart()) return;
    const characters: CharacterId[] = [];
    const controllers: ("human" | "cpu")[] = [];
    const cpuDifficulties: CpuDiff[] = [];
    const labels: string[] = [];
    for (let p = 0; p < MAX_SLOTS; p++) {
      if (!this.isActive(p)) continue;
      const ctrl = this.control[p] as "human" | "cpu";
      // "Aleatorio" se sortea aquí, antes de crear la partida (la simulación
      // recibe siempre un personaje concreto, así los replays no cambian).
      const pick = this.picks[p] as PickId;
      characters.push(
        pick === RANDOM
          ? SELECTABLE_CHARACTERS[Math.floor(Math.random() * SELECTABLE_CHARACTERS.length)]
          : pick,
      );
      controllers.push(ctrl);
      cpuDifficulties.push(this.cpuDifficulty[p]);
      // Etiqueta: P1 humano con sesión -> apodo; otros humanos -> "P{n}";
      // las CPU se etiquetan en el World (CPU/CPUn), así que mandamos "" y el
      // World decide (mantiene su lógica de nombres de CPU).
      if (ctrl === "human") {
        labels.push(p === 0 && this.localNickname ? this.localNickname : `P${p + 1}`);
      } else {
        labels.push("");
      }
    }
    this.cb.onConfirm(characters, controllers, cpuDifficulties, labels);
  }

  /**
   * Placa de un jugador: chapa P1–P4, etiqueta, personaje elegido, hueco de
   * ficha y pestañas de control. TODOS los slots (incluido P1) pueden ser
   * Jugador / CPU / Deshabilitado. La única restricción es que debe haber al
   * menos 2 slots activos para empezar (lo valida `canStart`), así que el
   * botón de continuar se bloquea solo.
   */
  private buildPlayerCard(p: number): HTMLElement {
    const card = div("player-card");
    card.style.setProperty("--pc", TOKEN_COLORS[p]);
    card.dataset.slot = String(p);
    this.playerCards.push(card);

    const head = div("player-card-head");
    head.appendChild(div("player-card-tag", TOKEN_LABELS[p]));
    const label = div("player-card-label", `Jugador ${p + 1}`);
    head.appendChild(label);
    card.appendChild(head);

    const pick = div("player-card-pick", "—");
    this.pickLabels.push(pick);
    card.appendChild(pick);

    const slotHint = div("player-card-slot", "clic para coger →");
    card.appendChild(slotHint);

    // Cualquier slot (incluido P1) puede ser Jugador / CPU / Deshabilitado.
    const controlOptions: Array<{ value: SlotControl; label: string }> = [
      { value: "human", label: "Jugador" },
      { value: "cpu", label: "CPU" },
      { value: "off" as SlotControl, label: "Off" },
    ];

    const tabs = div("player-card-tabs");
    const tabButtons = new Map<SlotControl, HTMLButtonElement>();

    const diff = div("player-card-difficulty");
    const diffOptions: Array<{ value: CpuDiff; label: string }> = [
      { value: "easy", label: "Fácil" },
      { value: "normal", label: "Normal" },
      { value: "hard", label: "Difícil" },
    ];
    const diffButtons = new Map<CpuDiff, HTMLButtonElement>();

    const sync = (): void => {
      const ctrl = this.control[p];
      for (const [val, btn] of tabButtons) {
        const on = val === ctrl;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
      for (const [val, btn] of diffButtons) {
        const on = val === this.cpuDifficulty[p];
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
      card.classList.toggle("cpu", ctrl === "cpu");
      card.classList.toggle("off", ctrl === "off");
      diff.classList.toggle("show", ctrl === "cpu");
      slotHint.style.visibility = ctrl === "off" ? "hidden" : "visible";
      // P1, si es "Jugador" y hay sesión, muestra el apodo del usuario; si no,
      // la etiqueta genérica "Jugador 1".
      label.textContent =
        p === 0 && ctrl === "human" && this.localNickname
          ? this.localNickname
          : `Jugador ${p + 1}`;
    };
    this.syncers.push(sync);

    for (const opt of controlOptions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "player-card-tab";
      btn.textContent = opt.label;
      btn.title = opt.value === "off" ? "Deshabilitado" : opt.label;
      if (opt.value === "off") btn.setAttribute("aria-label", "Deshabilitado");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.setControl(p, opt.value);
        // Al activar un slot sin personaje, el teclado pasa a elegir por él.
        if (opt.value !== "off" && !this.picks[p]) this.setKbSlot(p);
      });
      tabButtons.set(opt.value, btn);
      tabs.appendChild(btn);
    }
    card.appendChild(tabs);

    for (const opt of diffOptions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "player-card-diff";
      btn.textContent = opt.label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.cpuDifficulty[p] = opt.value;
        this.syncAll();
      });
      diffButtons.set(opt.value, btn);
      diff.appendChild(btn);
    }
    card.appendChild(diff);

    return card;
  }

  /** Re-sincroniza el estado visual de todas las tarjetas. */
  private syncAll(): void {
    for (const s of this.syncers) s();
  }

  /** Coloca cada ficha en el hueco de su placa; oculta las de slots deshabilitados. */
  private resetChips(): void {
    const sRect = this.stage.getBoundingClientRect();
    this.chips.forEach((chip, p) => {
      const card = this.playerCards[p];
      if (!card) return;
      // Slot deshabilitado: ocultamos su ficha.
      if (!this.isActive(p)) {
        chip.el.style.display = "none";
        return;
      }
      chip.el.style.display = "";
      const slot = card.querySelector<HTMLElement>(".player-card-slot") ?? card;
      const r = slot.getBoundingClientRect();
      chip.homeLeft = r.left - sRect.left + r.width / 2 - 24;
      chip.homeTop = r.top - sRect.top + r.height / 2 - 24;
      if (!chip.placedOn) this.moveChip(chip, chip.homeLeft, chip.homeTop);
    });
  }

  /**
   * Modelo CLIC-PARA-COGER / CLIC-PARA-SOLTAR (no arrastre con botón pulsado):
   *  - Si no hay ficha en la mano, un clic sobre una ficha la "coge": a partir
   *    de ahí sigue al cursor (listener de pointermove persistente) hasta el
   *    siguiente clic.
   *  - Si ya hay una ficha en la mano, el clic la suelta donde esté el cursor.
   * Esto evita el fallo de "la ficha se queda donde clicaste".
   */
  private heldChip: Chip | null = null;
  private heldMove: ((ev: PointerEvent) => void) | null = null;
  private heldClick: ((ev: PointerEvent) => void) | null = null;

  private onChipDown(e: PointerEvent, chip: Chip): void {
    if (!this.isActive(chip.player)) return;
    e.preventDefault();
    // Si justo esta ficha ya está en la mano, este clic la suelta (lo gestiona
    // el listener de clic global); no hacemos nada aquí.
    if (this.heldChip) return;
    this.pickUpChip(chip);
  }

  /** Coge una ficha: empieza a seguir al cursor hasta el próximo clic. */
  private pickUpChip(chip: Chip): void {
    this.heldChip = chip;
    chip.dragging = true;
    chip.el.classList.add("dragging");
    this.hand.setGrabbing(true);

    const sRect = this.stage.getBoundingClientRect();
    const move = (ev: PointerEvent): void => {
      const x = ev.clientX - sRect.left - 24;
      const y = ev.clientY - sRect.top - 24;
      this.moveChip(chip, x, y);
      this.highlightHover(ev);
    };
    // El clic para soltar: lo capturamos en el próximo pointerdown de la
    // ventana. Lo registramos en el siguiente tick para no confundirlo con el
    // mismo pointerdown que cogió la ficha.
    const click = (ev: PointerEvent): void => {
      ev.preventDefault();
      this.releaseHeldChip(ev);
    };
    this.heldMove = move;
    this.heldClick = click;
    window.addEventListener("pointermove", move);
    window.setTimeout(() => {
      window.addEventListener("pointerdown", click);
    }, 0);
  }

  /** Suelta la ficha que está en la mano en la posición del cursor. */
  private releaseHeldChip(ev: PointerEvent): void {
    const chip = this.heldChip;
    if (!chip) return;
    if (this.heldMove) window.removeEventListener("pointermove", this.heldMove);
    if (this.heldClick) window.removeEventListener("pointerdown", this.heldClick);
    this.heldMove = null;
    this.heldClick = null;
    this.heldChip = null;
    chip.dragging = false;
    chip.el.classList.remove("dragging");
    this.hand.setGrabbing(false);
    this.dropChip(chip, ev);
  }

  private moveChip(chip: Chip, left: number, top: number): void {
    chip.el.style.left = `${left}px`;
    chip.el.style.top = `${top}px`;
  }

  private highlightHover(ev: PointerEvent): void {
    const hit = this.cellAt(ev.clientX, ev.clientY);
    for (const [id, cell] of this.cells) {
      const on = cell === hit;
      cell.classList.toggle("hover-drop", on);
      // La ficha sobre un retrato también lo enfoca (panel lateral).
      if (on) this.focusCharacter(id);
    }
  }

  /** Suelta la ficha: si está sobre un retrato, lo asigna; si no, vuelve a casa. */
  private dropChip(chip: Chip, ev: PointerEvent): void {
    for (const [, cell] of this.cells) cell.classList.remove("hover-drop");
    const hit = this.cellAt(ev.clientX, ev.clientY);
    let id: PickId | null = null;
    if (hit) {
      for (const [cid, cell] of this.cells) if (cell === hit) id = cid;
    }
    if (id) {
      this.picks[chip.player] = id;
      chip.placedOn = id;
      this.snapChipToCell(chip, hit as HTMLElement, chip.player);
      this.focusCharacter(id);
    } else {
      this.picks[chip.player] = null;
      chip.placedOn = null;
      this.moveChip(chip, chip.homeLeft, chip.homeTop);
    }
    this.refreshSelectedStyles();
    this.updateGo();
  }

  /** Posa la ficha en una esquina distinta del retrato según el slot. */
  private snapChipToCell(chip: Chip, cell: HTMLElement, slot: number): void {
    const sRect = this.stage.getBoundingClientRect();
    const cRect = cell.getBoundingClientRect();
    // Repartimos las 4 posibles fichas en las cuatro esquinas del retrato.
    const left = slot % 2 === 0;
    const top = slot < 2;
    const offX = left ? 6 : cRect.width - 54;
    const offY = top ? 6 : cRect.height - 54;
    this.moveChip(chip, cRect.left - sRect.left + offX, cRect.top - sRect.top + offY);
  }

  private cellAt(clientX: number, clientY: number): HTMLElement | null {
    for (const [, cell] of this.cells) {
      const r = cell.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return cell;
      }
    }
    return null;
  }

  /**
   * Varios jugadores pueden repetir personaje; marcamos los elegidos y
   * mostramos en cada placa el nombre visible de su personaje.
   */
  private refreshSelectedStyles(): void {
    for (const [id, cell] of this.cells) {
      const chosen = this.picks.includes(id);
      cell.classList.toggle("selected", chosen);
    }
    for (let p = 0; p < MAX_SLOTS; p++) {
      const pick = this.picks[p];
      const label = this.pickLabels[p];
      if (label) label.textContent = pick === RANDOM ? "Aleatorio" : pick ? characterLore(pick).name : "—";
      this.playerCards[p]?.classList.toggle("ready", this.isActive(p) && pick !== null);
    }
  }

  /** ¿Se puede empezar? Al menos 2 slots activos y TODOS con personaje. */
  private canStart(): boolean {
    let active = 0;
    for (let p = 0; p < MAX_SLOTS; p++) {
      if (!this.isActive(p)) continue;
      active++;
      if (!this.picks[p]) return false; // activo sin personaje
    }
    return active >= 2;
  }

  private updateGo(): void {
    const ready = this.canStart();
    setDisabled(this.goBtn, !ready);
    this.goBtn.classList.toggle("disabled", !ready);
  }
}

export interface StageSelectCallbacks {
  onConfirm: (stage: StageId) => void;
  onBack: () => void;
}

export class StageSelect {
  private readonly root: HTMLDivElement;
  private readonly nav = screenNav(() => this.root);
  private readonly stage: HTMLDivElement;
  private readonly cells = new Map<StageId, HTMLButtonElement>();
  private readonly previewThumb: HTMLDivElement;
  private readonly previewName: HTMLHeadingElement;
  private readonly previewDesc: HTMLParagraphElement;
  /** Vistas previas grandes ya construidas (se reutilizan al cambiar el foco). */
  private readonly previewCache = new Map<StageId, HTMLElement>();
  /** Hueco libre de la rejilla 2×2 donde descansa la ficha (si lo hay). */
  private readonly dock: HTMLDivElement | null;
  private readonly goBtn: HTMLButtonElement;
  private readonly chip: Chip;
  private pick: StageId | null = null;
  private focused: StageId | null = null;

  constructor(
    private readonly cb: StageSelectCallbacks,
    private readonly hand: HandCursor,
  ) {
    this.root = document.createElement("div");
    this.root.id = "stage-select";
    this.root.className = "select-screen kb-select";

    this.root.appendChild(
      buildHeader(
        "Elige escenario",
        "Coloca la ficha sobre un escenario, o elige con las flechas y Enter (Enter otra vez para luchar)",
      ),
    );

    const layout = div("stage-layout");

    // Vista previa grande del escenario enfocado + descripción.
    const preview = div("stage-preview");
    preview.setAttribute("aria-live", "polite");
    this.previewThumb = div("stage-preview-thumb");
    preview.appendChild(this.previewThumb);
    this.previewName = document.createElement("h2");
    this.previewName.className = "stage-preview-name";
    this.previewName.textContent = "—";
    preview.appendChild(this.previewName);
    this.previewDesc = document.createElement("p");
    this.previewDesc.className = "stage-preview-desc";
    preview.appendChild(this.previewDesc);
    layout.appendChild(preview);

    // Rejilla 2×2 + ficha.
    this.stage = div("css-stage");
    const grid = div("stage-grid");
    for (const id of SELECTABLE_STAGES) {
      const lore = stageLore(id);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "stage-cell";
      cell.setAttribute("aria-label", lore.name);
      cell.dataset.stageId = id;
      cell.appendChild(createStagePreview(id, { decorative: true, className: "stage-cell__preview" }));
      const name = document.createElement("span");
      name.className = "stage-name";
      name.textContent = lore.name;
      cell.appendChild(name);
      cell.addEventListener("click", (e) => {
        e.preventDefault();
        // Teclado / mando: Enter elige; Enter otra vez sobre el elegido, a luchar.
        if (e.detail !== 0) return;
        if (this.pick === id) this.cb.onConfirm(id);
        else this.pickStage(id);
      });
      cell.addEventListener("pointerenter", () => this.preview(id));
      cell.addEventListener("focus", () => this.preview(id));
      this.cells.set(id, cell);
      grid.appendChild(cell);
    }
    // Al salir de la rejilla, la vista previa vuelve al escenario elegido.
    grid.addEventListener("pointerleave", () => {
      if (this.pick && !this.held) this.preview(this.pick);
    });
    // Si la rejilla 2×2 tiene huecos, el primero hace de "casa" de la ficha.
    if (SELECTABLE_STAGES.length % 2 === 1) {
      this.dock = div("stage-chip-dock");
      this.dock.setAttribute("aria-hidden", "true");
      grid.appendChild(this.dock);
    } else {
      this.dock = null;
    }
    this.stage.appendChild(grid);

    // Ficha arrastrable (una sola).
    const el = div("token-chip stage-chip", "✪");
    this.chip = {
      el,
      player: 0,
      placedOn: null,
      homeLeft: 0,
      homeTop: 0,
      dragging: false,
    };
    el.addEventListener("pointerdown", (e) => this.onChipDown(e));
    this.stage.appendChild(el);

    layout.appendChild(this.stage);
    this.root.appendChild(layout);

    const actions = div("select-actions");
    const back = button({ label: "‹ Atrás", variant: "ghost", onActivate: () => this.cb.onBack() });
    back.classList.add("kb-select__back");
    actions.appendChild(backHint(back, "Atrás"));
    this.goBtn = button({
      label: "¡A luchar! ›",
      onActivate: () => {
        if (this.pick) this.cb.onConfirm(this.pick);
      },
    });
    this.goBtn.classList.add("kb-select__go");
    actions.appendChild(keyHint(this.goBtn, "c", { pad: "start", label: "¡A luchar!" }));
    this.root.appendChild(actions);
    setLegend(this.root, {
      accept: "Elegir",
      items: [{ key: "r", pad: "x", label: "Aleatorio" }],
    });

    document.body.appendChild(this.root);
    if (SELECTABLE_STAGES.length > 0) this.preview(SELECTABLE_STAGES[0]);
    this.updateGo();
  }

  show(): void {
    this.root.classList.add("open");
    requestAnimationFrame(() => this.resetChip());
    const random = (): void => {
      const id = SELECTABLE_STAGES[Math.floor(Math.random() * SELECTABLE_STAGES.length)];
      if (!id) return;
      this.pickStage(id);
      this.cells.get(id)?.focus();
    };
    this.nav.mount({ hotkeys: { r: random }, padHotkeys: { x: random } });
  }

  /** Elige un escenario sin arrastrar (teclado/mando): la ficha salta a él. */
  private pickStage(id: StageId): void {
    const cell = this.cells.get(id);
    if (!cell) return;
    this.pick = id;
    this.chip.placedOn = id;
    this.preview(id);
    const sRect = this.stage.getBoundingClientRect();
    const cRect = cell.getBoundingClientRect();
    this.chip.el.style.left = `${cRect.left - sRect.left + cRect.width / 2 - 22}px`;
    this.chip.el.style.top = `${cRect.top - sRect.top + cRect.height / 2 - 22}px`;
    for (const [sid, c] of this.cells) c.classList.toggle("selected", this.pick === sid);
    this.updateGo();
  }
  hide(): void {
    this.root.classList.remove("open");
    this.nav.unmount();
  }

  /** Escenario mostrado ahora en la vista previa grande. */
  get focusedStage(): StageId | null {
    return this.focused;
  }

  /** Enfoca un escenario: resalta su tarjeta y actualiza vista previa y textos. */
  private preview(id: StageId): void {
    if (this.focused === id) return;
    this.focused = id;
    for (const [sid, cell] of this.cells) cell.classList.toggle("is-focused", sid === id);
    let big = this.previewCache.get(id);
    if (!big) {
      big = createStagePreview(id, { decorative: true });
      this.previewCache.set(id, big);
    }
    this.previewThumb.replaceChildren(big);
    const lore = stageLore(id);
    this.previewName.textContent = lore.name;
    this.previewDesc.textContent = lore.description;
  }

  private resetChip(): void {
    const sRect = this.stage.getBoundingClientRect();
    if (this.dock) {
      // Home: centro del hueco libre de la rejilla.
      const d = this.dock.getBoundingClientRect();
      this.chip.homeLeft = d.left - sRect.left + d.width / 2 - 22;
      this.chip.homeTop = d.top - sRect.top + d.height / 2 - 22;
    } else {
      // Home: bajo la parrilla, centrada.
      this.chip.homeLeft = sRect.width / 2 - 22;
      this.chip.homeTop = sRect.height - 44;
    }
    if (!this.chip.placedOn) {
      this.chip.el.style.left = `${this.chip.homeLeft}px`;
      this.chip.el.style.top = `${this.chip.homeTop}px`;
    }
  }

  /** ¿Está la ficha "en la mano" (siguiendo al cursor)? */
  private held = false;
  private heldMove: ((ev: PointerEvent) => void) | null = null;
  private heldClick: ((ev: PointerEvent) => void) | null = null;

  /**
   * Clic para coger / clic para soltar (igual que en CharacterSelect). Al coger
   * la ficha sigue al cursor hasta el próximo clic, que la suelta.
   */
  private onChipDown(e: PointerEvent): void {
    e.preventDefault();
    if (this.held) return; // el clic de soltar lo gestiona el listener global
    this.held = true;
    this.chip.el.classList.add("dragging");
    this.hand.setGrabbing(true);
    const sRect = this.stage.getBoundingClientRect();

    const move = (ev: PointerEvent): void => {
      this.chip.el.style.left = `${ev.clientX - sRect.left - 22}px`;
      this.chip.el.style.top = `${ev.clientY - sRect.top - 22}px`;
      const hit = this.cellAt(ev.clientX, ev.clientY);
      for (const [id, cell] of this.cells) {
        const on = cell === hit;
        cell.classList.toggle("hover-drop", on);
        if (on) this.preview(id);
      }
    };
    const click = (ev: PointerEvent): void => {
      ev.preventDefault();
      this.releaseChip(ev, sRect);
    };
    this.heldMove = move;
    this.heldClick = click;
    window.addEventListener("pointermove", move);
    window.setTimeout(() => {
      window.addEventListener("pointerdown", click);
    }, 0);
  }

  private releaseChip(ev: PointerEvent, sRect: DOMRect): void {
    if (this.heldMove) window.removeEventListener("pointermove", this.heldMove);
    if (this.heldClick) window.removeEventListener("pointerdown", this.heldClick);
    this.heldMove = null;
    this.heldClick = null;
    this.held = false;
    this.chip.el.classList.remove("dragging");
    this.hand.setGrabbing(false);
    for (const [, cell] of this.cells) cell.classList.remove("hover-drop");
    const hit = this.cellAt(ev.clientX, ev.clientY);
    let id: StageId | null = null;
    if (hit) for (const [sid, cell] of this.cells) if (cell === hit) id = sid;
    if (id) {
      this.pick = id;
      this.chip.placedOn = id;
      this.preview(id);
      const cRect = hit!.getBoundingClientRect();
      this.chip.el.style.left = `${cRect.left - sRect.left + cRect.width / 2 - 22}px`;
      this.chip.el.style.top = `${cRect.top - sRect.top + cRect.height / 2 - 22}px`;
    } else {
      this.chip.el.style.left = `${this.chip.homeLeft}px`;
      this.chip.el.style.top = `${this.chip.homeTop}px`;
      if (!this.chip.placedOn) this.pick = null;
    }
    for (const [sid, cell] of this.cells) cell.classList.toggle("selected", this.pick === sid);
    this.updateGo();
  }

  private cellAt(clientX: number, clientY: number): HTMLElement | null {
    for (const [, cell] of this.cells) {
      const r = cell.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return cell;
      }
    }
    return null;
  }

  private updateGo(): void {
    setDisabled(this.goBtn, !this.pick);
    this.goBtn.classList.toggle("disabled", !this.pick);
  }
}
