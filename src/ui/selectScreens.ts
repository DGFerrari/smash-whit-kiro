import {
  CHARACTERS,
  SELECTABLE_CHARACTERS,
  type CharacterId,
} from "../engine/game/characters.ts";
import {
  STAGES,
  SELECTABLE_STAGES,
  type StageId,
} from "../engine/game/stages.ts";
import type { HandCursor } from "./handCursor.ts";

/**
 * Pantallas de selección estilo Super Smash Bros. con FICHAS ARRASTRABLES.
 *
 *  - CharacterSelect: una parrilla de retratos y, abajo, una FICHA por jugador
 *    (P1/P2). Agarras la ficha con el cursor y la sueltas sobre un retrato para
 *    elegir ese personaje. No se puede avanzar si algún jugador no tiene ficha
 *    colocada.
 *  - StageSelect: parrilla de miniaturas y una ficha que arrastras sobre el
 *    mapa elegido.
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
  ) => void;
  onBack: () => void;
}

export class CharacterSelect {
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly cells = new Map<CharacterId, HTMLButtonElement>();
  private readonly chips: Chip[] = [];
  private readonly goBtn: HTMLButtonElement;

  /** Personaje elegido por cada slot (null = sin elegir). */
  private readonly picks: Array<CharacterId | null> = [null, null, null, null];
  /**
   * Control de cada slot. P1 siempre humano; P2/P3/P4 arrancan DESHABILITADOS
   * (el jugador activa los que quiera; mínimo 2 para empezar).
   */
  private readonly control: SlotControl[] = ["human", "off", "off", "off"];
  /** Dificultad de CADA slot (independiente): cada CPU puede tener la suya. */
  private readonly cpuDifficulty: CpuDiff[] = ["normal", "normal", "normal", "normal"];
  /** Para re-sincronizar las tarjetas tras cambios. */
  private syncers: Array<() => void> = [];

  constructor(
    private readonly cb: CharacterSelectCallbacks,
    private readonly hand: HandCursor,
  ) {
    this.root = document.createElement("div");
    this.root.id = "char-select";
    this.root.className = "select-screen";

    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Elige personaje";
    this.root.appendChild(title);

    const hint = document.createElement("p");
    hint.className = "select-hint";
    hint.textContent =
      "Haz clic en la ficha de cada jugador activo y clic sobre un personaje (mínimo 2)";
    this.root.appendChild(hint);

    this.stage = document.createElement("div");
    this.stage.className = "css-stage char-stage";

    const grid = document.createElement("div");
    grid.className = "portrait-grid";
    for (const id of SELECTABLE_CHARACTERS) {
      const def = CHARACTERS[id];
      const cell = document.createElement("button");
      cell.className = "portrait";
      cell.style.setProperty("--c", def.color);
      const face = document.createElement("div");
      face.className = "portrait-face";
      face.style.background = `linear-gradient(150deg, ${def.color}, ${shade(def.color, 0.6)})`;
      const badge = document.createElement("div");
      badge.className = "portrait-badge";
      badge.textContent = def.name[0];
      face.appendChild(badge);
      cell.appendChild(face);
      const name = document.createElement("div");
      name.className = "portrait-name";
      name.textContent = def.name;
      cell.appendChild(name);
      cell.addEventListener("click", (e) => e.preventDefault());
      this.cells.set(id, cell);
      grid.appendChild(cell);
    }
    this.stage.appendChild(grid);

    // Cuatro tarjetas de jugador, cada una con sus pestañas de control.
    const cards = document.createElement("div");
    cards.className = "player-cards";
    for (let p = 0; p < MAX_SLOTS; p++) {
      cards.appendChild(this.buildPlayerCard(p));
    }
    this.stage.appendChild(cards);

    // Cuatro fichas arrastrables (se ocultan si el slot está deshabilitado).
    for (let p = 0; p < MAX_SLOTS; p++) {
      const el = document.createElement("div");
      el.className = "token-chip";
      el.style.setProperty("--tc", TOKEN_COLORS[p]);
      el.textContent = TOKEN_LABELS[p];
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

    this.root.appendChild(this.stage);

    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = document.createElement("button");
    back.className = "menu-btn select-back";
    back.textContent = "‹ Atrás";
    back.addEventListener("click", () => this.cb.onBack());
    actions.appendChild(back);
    this.goBtn = document.createElement("button");
    this.goBtn.className = "menu-btn select-go";
    this.goBtn.textContent = "Elegir escenario ›";
    this.goBtn.addEventListener("click", () => this.confirm());
    actions.appendChild(this.goBtn);
    this.root.appendChild(actions);

    document.body.appendChild(this.root);
    this.updateGo();
  }

  show(): void {
    this.root.classList.add("open");
    requestAnimationFrame(() => this.resetChips());
  }
  hide(): void {
    this.root.classList.remove("open");
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
    for (let p = 0; p < MAX_SLOTS; p++) {
      if (!this.isActive(p)) continue;
      characters.push(this.picks[p] as CharacterId);
      controllers.push(this.control[p] as "human" | "cpu");
      cpuDifficulties.push(this.cpuDifficulty[p]);
    }
    this.cb.onConfirm(characters, controllers, cpuDifficulties);
  }

  /**
   * Tarjeta de un jugador: etiqueta, hueco de ficha y pestañas de control.
   * TODOS los slots (incluido P1) pueden ser Jugador / CPU / Deshabilitado. La
   * única restricción es que debe haber al menos 2 slots activos para empezar
   * (lo valida `canStart`), así que el botón de continuar se bloquea solo.
   */
  private buildPlayerCard(p: number): HTMLElement {
    const card = document.createElement("div");
    card.className = "player-card";
    card.style.setProperty("--pc", TOKEN_COLORS[p]);
    card.dataset.slot = String(p);

    const label = document.createElement("div");
    label.className = "player-card-label";
    label.textContent = `Jugador ${p + 1}`;
    card.appendChild(label);

    const slotHint = document.createElement("div");
    slotHint.className = "player-card-slot";
    slotHint.textContent = "clic para coger →";
    card.appendChild(slotHint);

    // Cualquier slot (incluido P1) puede ser Jugador / CPU / Deshabilitado.
    const controlOptions: Array<{ value: SlotControl; label: string }> = [
      { value: "human", label: "Jugador" },
      { value: "cpu", label: "CPU" },
      { value: "off" as SlotControl, label: "Deshabilitado" },
    ];

    const tabs = document.createElement("div");
    tabs.className = "player-card-tabs";
    const tabButtons = new Map<SlotControl, HTMLButtonElement>();

    const diff = document.createElement("div");
    diff.className = "player-card-difficulty";
    const diffOptions: Array<{ value: CpuDiff; label: string }> = [
      { value: "easy", label: "Fácil" },
      { value: "normal", label: "Normal" },
      { value: "hard", label: "Difícil" },
    ];
    const diffButtons = new Map<CpuDiff, HTMLButtonElement>();

    const sync = (): void => {
      const ctrl = this.control[p];
      for (const [val, btn] of tabButtons) btn.classList.toggle("active", val === ctrl);
      for (const [val, btn] of diffButtons) {
        btn.classList.toggle("active", val === this.cpuDifficulty[p]);
      }
      card.classList.toggle("cpu", ctrl === "cpu");
      card.classList.toggle("off", ctrl === "off");
      diff.classList.toggle("show", ctrl === "cpu");
      slotHint.style.visibility = ctrl === "off" ? "hidden" : "visible";
    };
    this.syncers.push(sync);

    for (const opt of controlOptions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "player-card-tab";
      btn.textContent = opt.label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.control[p] = opt.value;
        if (opt.value === "off") {
          // Al desactivar, liberamos su personaje y escondemos su ficha.
          this.picks[p] = null;
          const chip = this.chips[p];
          if (chip) chip.placedOn = null;
        }
        this.syncAll();
        this.resetChips();
        this.refreshSelectedStyles();
        this.updateGo();
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

  /** Coloca cada ficha en su tarjeta; oculta las de slots deshabilitados. */
  private resetChips(): void {
    const cards = this.stage.querySelectorAll<HTMLDivElement>(".player-card");
    const sRect = this.stage.getBoundingClientRect();
    this.chips.forEach((chip, p) => {
      const card = cards[p];
      if (!card) return;
      // Slot deshabilitado: ocultamos su ficha.
      if (!this.isActive(p)) {
        chip.el.style.display = "none";
        return;
      }
      chip.el.style.display = "";
      const cRect = card.getBoundingClientRect();
      chip.homeLeft = cRect.left - sRect.left + cRect.width / 2 - 24;
      chip.homeTop = cRect.top - sRect.top + 10;
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
    for (const [, cell] of this.cells) cell.classList.toggle("hover-drop", cell === hit);
  }

  /** Suelta la ficha: si está sobre un retrato, lo asigna; si no, vuelve a casa. */
  private dropChip(chip: Chip, ev: PointerEvent): void {
    for (const [, cell] of this.cells) cell.classList.remove("hover-drop");
    const hit = this.cellAt(ev.clientX, ev.clientY);
    let id: CharacterId | null = null;
    if (hit) {
      for (const [cid, cell] of this.cells) if (cell === hit) id = cid;
    }
    if (id) {
      this.picks[chip.player] = id;
      chip.placedOn = id;
      this.snapChipToCell(chip, hit as HTMLElement, chip.player);
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

  /** Varios jugadores pueden repetir personaje; marcamos los elegidos. */
  private refreshSelectedStyles(): void {
    for (const [id, cell] of this.cells) {
      const chosen = this.picks.includes(id);
      cell.classList.toggle("selected", chosen);
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
    this.goBtn.disabled = !ready;
    this.goBtn.classList.toggle("disabled", !ready);
  }
}

export interface StageSelectCallbacks {
  onConfirm: (stage: StageId) => void;
  onBack: () => void;
}

export class StageSelect {
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly cells = new Map<StageId, HTMLButtonElement>();
  private readonly previewThumb: HTMLDivElement;
  private readonly previewName: HTMLDivElement;
  private readonly goBtn: HTMLButtonElement;
  private readonly chip: Chip;
  private pick: StageId | null = null;

  constructor(
    private readonly cb: StageSelectCallbacks,
    private readonly hand: HandCursor,
  ) {
    this.root = document.createElement("div");
    this.root.id = "stage-select";
    this.root.className = "select-screen";

    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Elige escenario";
    this.root.appendChild(title);

    const hint = document.createElement("p");
    hint.className = "select-hint";
    hint.textContent = "Haz clic en la ficha y clic sobre un escenario";
    this.root.appendChild(hint);

    const layout = document.createElement("div");
    layout.className = "stage-layout";

    // Vista previa grande.
    const preview = document.createElement("div");
    preview.className = "stage-preview";
    this.previewThumb = document.createElement("div");
    this.previewThumb.className = "stage-preview-thumb";
    preview.appendChild(this.previewThumb);
    this.previewName = document.createElement("div");
    this.previewName.className = "stage-preview-name";
    this.previewName.textContent = "—";
    preview.appendChild(this.previewName);
    layout.appendChild(preview);

    // Parrilla + ficha.
    this.stage = document.createElement("div");
    this.stage.className = "css-stage";
    const grid = document.createElement("div");
    grid.className = "stage-grid";
    for (const id of SELECTABLE_STAGES) {
      const def = STAGES[id];
      const cell = document.createElement("button");
      cell.className = "stage-cell";
      const thumb = document.createElement("div");
      thumb.className = "stage-thumb";
      thumb.style.background = this.thumbGradient(id);
      cell.appendChild(thumb);
      const name = document.createElement("span");
      name.className = "stage-name";
      name.textContent = def.name;
      cell.appendChild(name);
      cell.addEventListener("click", (e) => e.preventDefault());
      // Sin preview por ratón: la vista previa solo cambia cuando la FICHA
      // pasa sobre un escenario (ver onChipDown).
      this.cells.set(id, cell);
      grid.appendChild(cell);
    }
    this.stage.appendChild(grid);

    // Ficha arrastrable (una sola).
    const el = document.createElement("div");
    el.className = "token-chip stage-chip";
    el.textContent = "✪";
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

    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = document.createElement("button");
    back.className = "menu-btn select-back";
    back.textContent = "‹ Atrás";
    back.addEventListener("click", () => this.cb.onBack());
    actions.appendChild(back);
    this.goBtn = document.createElement("button");
    this.goBtn.className = "menu-btn select-go";
    this.goBtn.textContent = "¡A luchar! ›";
    this.goBtn.addEventListener("click", () => {
      if (this.pick) this.cb.onConfirm(this.pick);
    });
    actions.appendChild(this.goBtn);
    this.root.appendChild(actions);

    document.body.appendChild(this.root);
    this.updateGo();
  }

  show(): void {
    this.root.classList.add("open");
    requestAnimationFrame(() => this.resetChip());
  }
  hide(): void {
    this.root.classList.remove("open");
  }

  private thumbGradient(id: StageId): string {
    const def = STAGES[id];
    const bg = `#${def.theme.background.toString(16).padStart(6, "0")}`;
    const top = `#${def.theme.solidTop.toString(16).padStart(6, "0")}`;
    return `linear-gradient(160deg, ${bg} 55%, ${top} 55%)`;
  }

  private preview(id: StageId): void {
    this.previewThumb.style.background = this.thumbGradient(id);
    this.previewName.textContent = STAGES[id].name;
  }

  private resetChip(): void {
    // Home: bajo la parrilla, centrada.
    const sRect = this.stage.getBoundingClientRect();
    this.chip.homeLeft = sRect.width / 2 - 22;
    this.chip.homeTop = sRect.height - 44;
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
    this.goBtn.disabled = !this.pick;
    this.goBtn.classList.toggle("disabled", !this.pick);
  }
}

/** Oscurece un color hex #rrggbb por un factor f (0..1). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
