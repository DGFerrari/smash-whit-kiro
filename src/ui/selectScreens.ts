import {
  CHARACTERS,
  SELECTABLE_CHARACTERS,
  type CharacterId,
} from "../game/characters.ts";
import {
  STAGES,
  SELECTABLE_STAGES,
  type StageId,
} from "../game/stages.ts";
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

const TOKEN_COLORS = ["#2f6bff", "#ff4f6d"] as const; // P1, P2
const TOKEN_LABELS = ["P1", "P2"] as const;

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
  onConfirm: (characters: [CharacterId, CharacterId]) => void;
  onBack: () => void;
}

export class CharacterSelect {
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly cells = new Map<CharacterId, HTMLButtonElement>();
  private readonly chips: Chip[] = [];
  private readonly goBtn: HTMLButtonElement;
  private readonly picks: Array<CharacterId | null> = [null, null];

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
    hint.textContent = "Arrastra la ficha de cada jugador sobre un personaje";
    this.root.appendChild(hint);

    // Stage: contenedor relativo que aloja la parrilla, las fichas y sus
    // tarjetas de jugador, para posicionar en coordenadas locales.
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
      // No seleccionable por clic: solo soltando una ficha encima.
      cell.addEventListener("click", (e) => e.preventDefault());
      this.cells.set(id, cell);
      grid.appendChild(cell);
    }
    this.stage.appendChild(grid);

    // Tarjetas de jugador (abajo) con su ficha encima.
    const cards = document.createElement("div");
    cards.className = "player-cards";
    for (let p = 0; p < 2; p++) {
      const card = document.createElement("div");
      card.className = "player-card";
      card.style.setProperty("--pc", TOKEN_COLORS[p]);
      const label = document.createElement("div");
      label.className = "player-card-label";
      label.textContent = `Jugador ${p + 1}`;
      card.appendChild(label);
      const slot = document.createElement("div");
      slot.className = "player-card-slot";
      slot.textContent = "arrastra →";
      card.appendChild(slot);
      cards.appendChild(card);
    }
    this.stage.appendChild(cards);

    // Fichas arrastrables.
    for (let p = 0; p < 2; p++) {
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
    this.goBtn.addEventListener("click", () => {
      if (this.picks[0] && this.picks[1]) {
        this.cb.onConfirm([this.picks[0], this.picks[1]]);
      }
    });
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

  /** Coloca las fichas en su posición de reposo (sobre su tarjeta). */
  private resetChips(): void {
    const cards = this.stage.querySelectorAll<HTMLDivElement>(".player-card");
    const sRect = this.stage.getBoundingClientRect();
    this.chips.forEach((chip, p) => {
      const card = cards[p];
      if (!card) return;
      const cRect = card.getBoundingClientRect();
      chip.homeLeft = cRect.left - sRect.left + cRect.width / 2 - 24;
      chip.homeTop = cRect.top - sRect.top + 10;
      if (!chip.placedOn) this.moveChip(chip, chip.homeLeft, chip.homeTop);
    });
  }

  private onChipDown(e: PointerEvent, chip: Chip): void {
    e.preventDefault();
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
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      chip.dragging = false;
      chip.el.classList.remove("dragging");
      this.hand.setGrabbing(false);
      this.dropChip(chip, ev);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private moveChip(chip: Chip, left: number, top: number): void {
    chip.el.style.left = `${left}px`;
    chip.el.style.top = `${top}px`;
  }

  /** Resalta el retrato bajo el cursor mientras se arrastra. */
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
      this.snapChipToCell(chip, hit as HTMLElement);
    } else {
      this.picks[chip.player] = null;
      chip.placedOn = null;
      this.moveChip(chip, chip.homeLeft, chip.homeTop);
    }
    this.refreshSelectedStyles();
    this.updateGo();
  }

  /** Posa la ficha en una esquina del retrato (P1 arriba-izq, P2 abajo-der). */
  private snapChipToCell(chip: Chip, cell: HTMLElement): void {
    const sRect = this.stage.getBoundingClientRect();
    const cRect = cell.getBoundingClientRect();
    const offX = chip.player === 0 ? 6 : cRect.width - 54;
    const offY = chip.player === 0 ? 6 : cRect.height - 54;
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

  private refreshSelectedStyles(): void {
    for (const [id, cell] of this.cells) {
      const chosen = this.picks.includes(id);
      cell.classList.toggle("selected", chosen);
    }
  }

  private updateGo(): void {
    const ready = !!this.picks[0] && !!this.picks[1];
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
    hint.textContent = "Arrastra la ficha sobre un escenario";
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
      cell.addEventListener("mouseenter", () => this.preview(id));
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

  private onChipDown(e: PointerEvent): void {
    e.preventDefault();
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
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
