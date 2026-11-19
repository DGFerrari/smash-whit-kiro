import { CHARACTERS, SELECTABLE_CHARACTERS, type CharacterId } from "../engine/game/characters.ts";
import { SELECTABLE_STAGES, type StageId } from "../engine/game/stages.ts";
import type { OnlineNetwork } from "../net/peer.ts";
import { decodeLobby, encodeLobby, type LobbyState } from "../net/onlineProtocol.ts";
import { characterLore, stageLore } from "../content/lore.ts";
import { createCharacterPortrait, createStagePreview } from "./brand/portraits.ts";
import { button, setDisabled } from "./design/components.ts";
import type { HandCursor } from "./handCursor.ts";
import { screenNav } from "./nav/screenNav.ts";
import { backHint, keyHint } from "./nav/keyHints.ts";
import "./online.css";

/**
 * LOBBY online (2..4 jugadores, topología estrella) con la MISMA interfaz que
 * la selección de Batalla: parrilla de retratos + fichas arrastrables y, para
 * el escenario, la parrilla con su ficha. El HOST mantiene el estado
 * autoritativo del lobby y lo difunde; los guests mandan sus acciones.
 *
 * Diferencias con Batalla:
 *  - Cada jugador SOLO mueve SU ficha (la de su slot). Las fichas de los demás
 *    se colocan solas según el estado sincronizado y no son arrastrables.
 *  - El escenario SOLO lo elige el host (solo él tiene ficha de escenario).
 *  - Arriba se muestra el CÓDIGO de sala con botón de copiar.
 */

const TOKEN_COLORS = ["#2f6bff", "#ff4f6d", "#f0c23a", "#5fcf80"] as const;
const TOKEN_LABELS = ["P1", "P2", "P3", "P4"] as const;
const MAX_SLOTS = 4;

export interface OnlineLobbyCallbacks {
  onBack: () => void;
  onStart: (seed: number, characters: CharacterId[], stage: StageId, names: string[]) => void;
}

interface Chip {
  el: HTMLDivElement;
  slot: number;
  placedOn: string | null;
  homeLeft: number;
  homeTop: number;
}

export class OnlineLobby {
  private readonly root: HTMLDivElement;
  private readonly nav = screenNav(() => this.root);
  private readonly codeBar: HTMLDivElement;
  private readonly codeValue: HTMLSpanElement;
  private readonly copyBtn: HTMLButtonElement;

  private readonly charsPhaseEl: HTMLDivElement;
  private readonly charStage: HTMLDivElement;
  private readonly portraitCells = new Map<CharacterId, HTMLButtonElement>();
  private readonly cardsEl: HTMLDivElement;
  private readonly chips: Chip[] = [];

  private readonly stagePhaseEl: HTMLDivElement;
  private readonly stageStage: HTMLDivElement;
  private readonly stageCells = new Map<StageId, HTMLButtonElement>();
  private readonly stageChip: Chip;
  private readonly stagePreviewThumb: HTMLDivElement;
  private readonly stagePreviewName: HTMLDivElement;

  private readonly stagePreviewCache = new Map<StageId, HTMLElement>();
  private previewedStage: StageId | null = null;

  private readonly waitEl: HTMLDivElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly nextLabel: HTMLSpanElement;

  private net: OnlineNetwork | null = null;
  private isHost = false;
  private mySlot = 0;
  private roomCode = "";

  /** Estado del lobby. En el host es la fuente de verdad; en el guest es copia. */
  private state: LobbyState = emptyState();

  constructor(
    private readonly cb: OnlineLobbyCallbacks,
    private readonly hand: HandCursor,
  ) {
    this.root = document.createElement("div");
    this.root.id = "online-lobby";
    this.root.className = "select-screen kb-online kb-lobby";

    const header = document.createElement("div");
    header.className = "kb-online__header kb-lobby__header";
    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Sala online";
    header.appendChild(title);

    // --- Barra de código de sala (copiable) ---
    this.codeBar = document.createElement("div");
    this.codeBar.className = "lobby-code-bar";
    const codeLabel = document.createElement("span");
    codeLabel.className = "lobby-code-label";
    codeLabel.textContent = "Código de sala";
    this.codeValue = document.createElement("span");
    this.codeValue.className = "lobby-code-value";
    this.codeValue.textContent = "—";
    this.copyBtn = document.createElement("button");
    this.copyBtn.type = "button";
    this.copyBtn.className = "lobby-code-copy";
    this.copyBtn.textContent = "Copiar";
    this.copyBtn.setAttribute("aria-label", "Copiar código de sala");
    this.copyBtn.addEventListener("click", () => this.copyCode());
    this.codeBar.append(codeLabel, this.codeValue, this.copyBtn);
    header.appendChild(this.codeBar);
    this.root.appendChild(header);

    // --- Fase personajes (igual que Batalla) ---
    this.charsPhaseEl = document.createElement("div");
    this.charsPhaseEl.className = "lobby-phase";

    const charHint = document.createElement("p");
    charHint.className = "select-hint";
    charHint.textContent = "Coge tu ficha y suéltala sobre un personaje";
    this.charsPhaseEl.appendChild(charHint);

    this.charStage = document.createElement("div");
    this.charStage.className = "css-stage char-stage";

    const grid = document.createElement("div");
    grid.className = "portrait-grid";
    for (const id of SELECTABLE_CHARACTERS) {
      const lore = characterLore(id);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "portrait";
      cell.dataset.char = id;
      cell.style.setProperty("--c", CHARACTERS[id].color);
      cell.setAttribute("aria-label", `${lore.name}, ${lore.title}`);
      const face = document.createElement("div");
      face.className = "portrait-face";
      face.appendChild(createCharacterPortrait(id, { decorative: true }));
      cell.appendChild(face);
      if (lore.crossover) {
        cell.classList.add("is-crossover");
        const badge = document.createElement("div");
        badge.className = "kb-crossover-badge";
        badge.textContent = "Crossover";
        badge.title = `Invitado de ${lore.crossover}`;
        cell.appendChild(badge);
      }
      const name = document.createElement("div");
      name.className = "portrait-name";
      const nameText = document.createElement("span");
      nameText.textContent = lore.name;
      name.appendChild(nameText);
      cell.appendChild(name);
      cell.addEventListener("click", (e) => {
        e.preventDefault();
        // Enter / botón A (clic sin puntero): elige sin arrastrar la ficha.
        if (e.detail === 0) this.chooseCharacter(id);
      });
      this.portraitCells.set(id, cell);
      grid.appendChild(cell);
    }
    this.charStage.appendChild(grid);

    // Tarjetas de jugador (home de cada ficha).
    this.cardsEl = document.createElement("div");
    this.cardsEl.className = "player-cards";
    for (let p = 0; p < MAX_SLOTS; p++) {
      const card = document.createElement("div");
      card.className = "player-card";
      card.style.setProperty("--pc", TOKEN_COLORS[p]);
      card.dataset.slot = String(p);
      const head = document.createElement("div");
      head.className = "player-card-head";
      const tag = document.createElement("span");
      tag.className = "player-card-tag";
      tag.textContent = TOKEN_LABELS[p];
      const label = document.createElement("div");
      label.className = "player-card-label";
      label.textContent = `Jugador ${p + 1}`;
      head.append(tag, label);
      card.appendChild(head);
      // Hueco "casa" de la ficha (la ficha se posiciona encima).
      const dock = document.createElement("div");
      dock.className = "kb-lobby__dock";
      dock.setAttribute("aria-hidden", "true");
      card.appendChild(dock);
      const foot = document.createElement("div");
      foot.className = "kb-lobby__card-foot";
      const conn = document.createElement("span");
      conn.className = "kb-conn-dot";
      conn.setAttribute("aria-hidden", "true");
      const who = document.createElement("div");
      who.className = "player-card-slot";
      who.textContent = "esperando…";
      foot.append(conn, who);
      card.appendChild(foot);
      this.cardsEl.appendChild(card);
    }
    this.charStage.appendChild(this.cardsEl);

    // Fichas (una por slot). Solo la propia es arrastrable.
    for (let p = 0; p < MAX_SLOTS; p++) {
      const el = document.createElement("div");
      el.className = "token-chip";
      el.style.setProperty("--tc", TOKEN_COLORS[p]);
      el.textContent = TOKEN_LABELS[p];
      const chip: Chip = { el, slot: p, placedOn: null, homeLeft: 0, homeTop: 0 };
      el.addEventListener("pointerdown", (e) => this.onChipDown(e, chip));
      this.chips.push(chip);
      this.charStage.appendChild(el);
    }

    this.charsPhaseEl.appendChild(this.charStage);
    this.root.appendChild(this.charsPhaseEl);

    // --- Fase escenario (igual que Batalla) ---
    this.stagePhaseEl = document.createElement("div");
    this.stagePhaseEl.className = "lobby-phase";
    this.stagePhaseEl.style.display = "none";

    const stageHint = document.createElement("p");
    stageHint.className = "select-hint";
    stageHint.textContent = "El anfitrión elige el escenario";
    this.stagePhaseEl.appendChild(stageHint);

    const stageLayout = document.createElement("div");
    stageLayout.className = "stage-layout";

    const preview = document.createElement("div");
    preview.className = "stage-preview";
    this.stagePreviewThumb = document.createElement("div");
    this.stagePreviewThumb.className = "stage-preview-thumb";
    preview.appendChild(this.stagePreviewThumb);
    this.stagePreviewName = document.createElement("div");
    this.stagePreviewName.className = "stage-preview-name";
    this.stagePreviewName.textContent = "—";
    preview.appendChild(this.stagePreviewName);
    stageLayout.appendChild(preview);

    this.stageStage = document.createElement("div");
    this.stageStage.className = "css-stage";
    const stageGrid = document.createElement("div");
    stageGrid.className = "stage-grid";
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
        if (e.detail === 0) this.chooseStage(id);
      });
      this.stageCells.set(id, cell);
      stageGrid.appendChild(cell);
    }
    this.stageStage.appendChild(stageGrid);

    const stageChipEl = document.createElement("div");
    stageChipEl.className = "token-chip stage-chip";
    stageChipEl.textContent = "✪";
    this.stageChip = { el: stageChipEl, slot: 0, placedOn: null, homeLeft: 0, homeTop: 0 };
    stageChipEl.addEventListener("pointerdown", (e) => this.onStageChipDown(e));
    this.stageStage.appendChild(stageChipEl);

    stageLayout.appendChild(this.stageStage);
    this.stagePhaseEl.appendChild(stageLayout);
    this.root.appendChild(this.stagePhaseEl);

    // Aviso para guests.
    this.waitEl = document.createElement("div");
    this.waitEl.className = "lobby-wait";
    this.root.appendChild(this.waitEl);

    // Acciones.
    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = button({
      label: "‹ Salir",
      variant: "ghost",
      onActivate: () => {
        this.teardown();
        this.cb.onBack();
      },
    });
    back.classList.add("select-back");
    actions.appendChild(backHint(back, "Salir"));
    this.nextBtn = button({ label: "", onActivate: () => this.onNext() });
    this.nextBtn.classList.add("select-go", "kb-lobby__go");
    this.nextLabel = this.nextBtn.querySelector<HTMLSpanElement>(".kb-btn__label")!;
    keyHint(this.nextBtn, "c", { pad: "start", label: "Continuar" });
    actions.appendChild(this.nextBtn);
    this.root.appendChild(actions);

    document.body.appendChild(this.root);
  }

  /** Abre el lobby con la red ya conectada. `myName` es el apodo propio. */
  open(net: OnlineNetwork, myName: string, roomCode: string): void {
    this.net = net;
    this.isHost = net.mySlot === 0;
    this.mySlot = net.mySlot;
    this.roomCode = roomCode;
    this.state = emptyState();

    this.codeValue.textContent = roomCode || "—";
    this.copyBtn.textContent = "Copiar";

    net.setMessageHandler((from, data) => this.onMessage(from, data));
    net.setPeerLeftHandler((slot) => this.onPeerLeft(slot));

    if (this.isHost) {
      this.state.occupied[0] = true;
      this.state.names[0] = myName;
      net.setPeerConnectedHandler((slot) => {
        this.state.occupied[slot] = true;
        if (!this.state.names[slot]) this.state.names[slot] = `Jugador ${slot + 1}`;
        this.broadcastState();
        this.render();
      });
    } else {
      net.sendTo(0, encodeLobby({ t: "hello", name: myName }));
    }

    this.root.classList.add("open");
    requestAnimationFrame(() => {
      this.resetChips();
      this.resetStageChip();
      this.render();
    });
    this.nav.mount();
  }

  hide(): void {
    this.root.classList.remove("open");
    this.nav.unmount();
  }

  private teardown(): void {
    this.net?.close();
    this.net = null;
  }

  private copyCode(): void {
    if (!this.roomCode) return;
    void navigator.clipboard?.writeText(this.roomCode).then(
      () => {
        this.copyBtn.textContent = "¡Copiado!";
        window.setTimeout(() => (this.copyBtn.textContent = "Copiar"), 1500);
      },
      () => {
        this.copyBtn.textContent = "Copiar";
      },
    );
  }

  // --- Fichas de personaje (arrastre clic-para-coger) -----------------------

  private heldChip: Chip | null = null;
  private heldMove: ((ev: PointerEvent) => void) | null = null;
  private heldClick: ((ev: PointerEvent) => void) | null = null;

  private onChipDown(e: PointerEvent, chip: Chip): void {
    // Solo puedo mover MI ficha.
    if (chip.slot !== this.mySlot) return;
    e.preventDefault();
    if (this.heldChip) return;
    this.pickUpChip(chip);
  }

  private pickUpChip(chip: Chip): void {
    this.heldChip = chip;
    chip.el.classList.add("dragging");
    this.hand.setGrabbing(true);
    const sRect = this.charStage.getBoundingClientRect();
    const move = (ev: PointerEvent): void => {
      this.moveChip(chip, ev.clientX - sRect.left - 24, ev.clientY - sRect.top - 24);
      this.highlightHover(ev);
    };
    const click = (ev: PointerEvent): void => {
      ev.preventDefault();
      this.releaseHeldChip(ev);
    };
    this.heldMove = move;
    this.heldClick = click;
    window.addEventListener("pointermove", move);
    window.setTimeout(() => window.addEventListener("pointerdown", click), 0);
  }

  private releaseHeldChip(ev: PointerEvent): void {
    const chip = this.heldChip;
    if (!chip) return;
    if (this.heldMove) window.removeEventListener("pointermove", this.heldMove);
    if (this.heldClick) window.removeEventListener("pointerdown", this.heldClick);
    this.heldMove = null;
    this.heldClick = null;
    this.heldChip = null;
    chip.el.classList.remove("dragging");
    this.hand.setGrabbing(false);

    const hit = this.cellAt(ev.clientX, ev.clientY, this.portraitCells);
    for (const [, cell] of this.portraitCells) cell.classList.remove("hover-drop");
    let id: CharacterId | null = null;
    if (hit) for (const [cid, cell] of this.portraitCells) if (cell === hit) id = cid;
    if (id) {
      this.chooseCharacter(id);
    } else {
      // Vuelve a casa (sin elegir si no estaba colocada).
      this.moveChip(chip, chip.homeLeft, chip.homeTop);
    }
  }

  private highlightHover(ev: PointerEvent): void {
    const hit = this.cellAt(ev.clientX, ev.clientY, this.portraitCells);
    for (const [, cell] of this.portraitCells) cell.classList.toggle("hover-drop", cell === hit);
  }

  private moveChip(chip: Chip, left: number, top: number): void {
    chip.el.style.left = `${left}px`;
    chip.el.style.top = `${top}px`;
  }

  /** Posiciona las fichas según el estado: ocultas si el slot está vacío, en su
   *  retrato si tiene personaje, o en su tarjeta "home" si está eligiendo. */
  private resetChips(): void {
    const cards = this.cardsEl.querySelectorAll<HTMLDivElement>(".player-card");
    const sRect = this.charStage.getBoundingClientRect();
    this.chips.forEach((chip, p) => {
      const card = cards[p];
      if (!card) return;
      if (!this.state.occupied[p]) {
        chip.el.style.display = "none";
        return;
      }
      chip.el.style.display = "";
      // Casa: centro del hueco de la placa (o la posición clásica si no existe).
      const dock = card.querySelector<HTMLElement>(".kb-lobby__dock");
      const cRect = card.getBoundingClientRect();
      chip.homeLeft = cRect.left - sRect.left + cRect.width / 2 - 24;
      if (dock) {
        const dRect = dock.getBoundingClientRect();
        chip.homeLeft = dRect.left - sRect.left + dRect.width / 2 - 24;
        chip.homeTop = dRect.top - sRect.top + dRect.height / 2 - 24;
      } else {
        chip.homeTop = cRect.top - sRect.top + 34;
      }
      const pick = this.state.picks[p];
      // No reposicionamos la ficha que tengo en la mano.
      if (this.heldChip === chip) return;
      if (pick) {
        const cell = this.portraitCells.get(pick);
        if (cell) this.snapChipToCell(chip, cell, p);
      } else {
        this.moveChip(chip, chip.homeLeft, chip.homeTop);
      }
    });
  }

  private snapChipToCell(chip: Chip, cell: HTMLElement, slot: number): void {
    const sRect = this.charStage.getBoundingClientRect();
    const cRect = cell.getBoundingClientRect();
    const left = slot % 2 === 0;
    const top = slot < 2;
    const offX = left ? 6 : cRect.width - 54;
    const offY = top ? 6 : cRect.height - 54;
    this.moveChip(chip, cRect.left - sRect.left + offX, cRect.top - sRect.top + offY);
    chip.placedOn = (cell as HTMLElement).dataset.char ?? null;
  }

  private cellAt<K extends string>(
    clientX: number,
    clientY: number,
    cells: Map<K, HTMLButtonElement>,
  ): HTMLElement | null {
    for (const [, cell] of cells) {
      const r = cell.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return cell;
      }
    }
    return null;
  }

  // --- Ficha de escenario (solo host) ---------------------------------------

  private stageHeld = false;
  private stageMove: ((ev: PointerEvent) => void) | null = null;
  private stageClick: ((ev: PointerEvent) => void) | null = null;

  private onStageChipDown(e: PointerEvent): void {
    if (!this.isHost) return;
    e.preventDefault();
    if (this.stageHeld) return;
    this.stageHeld = true;
    this.stageChip.el.classList.add("dragging");
    this.hand.setGrabbing(true);
    const sRect = this.stageStage.getBoundingClientRect();
    const move = (ev: PointerEvent): void => {
      this.stageChip.el.style.left = `${ev.clientX - sRect.left - 22}px`;
      this.stageChip.el.style.top = `${ev.clientY - sRect.top - 22}px`;
      const hit = this.cellAt(ev.clientX, ev.clientY, this.stageCells);
      for (const [id, cell] of this.stageCells) {
        const on = cell === hit;
        cell.classList.toggle("hover-drop", on);
        if (on) this.previewStage(id);
      }
    };
    const click = (ev: PointerEvent): void => {
      ev.preventDefault();
      this.releaseStageChip(ev, sRect);
    };
    this.stageMove = move;
    this.stageClick = click;
    window.addEventListener("pointermove", move);
    window.setTimeout(() => window.addEventListener("pointerdown", click), 0);
  }

  private releaseStageChip(ev: PointerEvent, sRect: DOMRect): void {
    if (this.stageMove) window.removeEventListener("pointermove", this.stageMove);
    if (this.stageClick) window.removeEventListener("pointerdown", this.stageClick);
    this.stageMove = null;
    this.stageClick = null;
    this.stageHeld = false;
    this.stageChip.el.classList.remove("dragging");
    this.hand.setGrabbing(false);
    for (const [, cell] of this.stageCells) cell.classList.remove("hover-drop");
    const hit = this.cellAt(ev.clientX, ev.clientY, this.stageCells);
    let id: StageId | null = null;
    if (hit) for (const [sid, cell] of this.stageCells) if (cell === hit) id = sid;
    if (id) {
      this.chooseStage(id);
      const cRect = hit!.getBoundingClientRect();
      this.stageChip.el.style.left = `${cRect.left - sRect.left + cRect.width / 2 - 22}px`;
      this.stageChip.el.style.top = `${cRect.top - sRect.top + cRect.height / 2 - 22}px`;
      this.stageChip.placedOn = id;
    } else {
      this.stageChip.el.style.left = `${this.stageChip.homeLeft}px`;
      this.stageChip.el.style.top = `${this.stageChip.homeTop}px`;
    }
  }

  private resetStageChip(): void {
    const sRect = this.stageStage.getBoundingClientRect();
    this.stageChip.homeLeft = sRect.width / 2 - 22;
    this.stageChip.homeTop = sRect.height - 44;
    if (!this.stageChip.placedOn) {
      this.stageChip.el.style.left = `${this.stageChip.homeLeft}px`;
      this.stageChip.el.style.top = `${this.stageChip.homeTop}px`;
    }
    // Los guests no pueden mover la ficha de escenario.
    this.stageChip.el.style.display = this.isHost ? "" : "none";
  }

  private previewStage(id: StageId): void {
    if (this.previewedStage === id) return;
    this.previewedStage = id;
    let big = this.stagePreviewCache.get(id);
    if (!big) {
      big = createStagePreview(id, { decorative: true });
      this.stagePreviewCache.set(id, big);
    }
    this.stagePreviewThumb.replaceChildren(big);
    this.stagePreviewName.textContent = stageLore(id).name;
    for (const [sid, cell] of this.stageCells) cell.classList.toggle("is-focused", sid === id);
  }

  // --- Acciones de estado ---------------------------------------------------

  private chooseCharacter(id: CharacterId): void {
    this.state.picks[this.mySlot] = id;
    if (this.isHost) {
      this.broadcastState();
    } else {
      this.net?.sendTo(0, encodeLobby({ t: "pick", character: id }));
    }
    this.render();
  }

  private chooseStage(id: StageId): void {
    if (!this.isHost) return;
    this.state.stage = id;
    this.broadcastState();
    this.render();
  }

  private onNext(): void {
    if (!this.isHost) return;
    if (this.state.phase === "characters") {
      const ready = this.state.occupied.every((occ, i) => !occ || this.state.picks[i]);
      const count = this.state.occupied.filter(Boolean).length;
      if (!ready || count < 2) return;
      this.state.phase = "stage";
      this.broadcastState();
      this.render();
    } else {
      const chars: CharacterId[] = [];
      const names: string[] = [];
      for (let s = 0; s < MAX_SLOTS; s++) {
        if (this.state.occupied[s]) {
          chars.push((this.state.picks[s] as CharacterId) ?? "blue");
          names.push(this.state.names[s] || `Jugador ${s + 1}`);
        }
      }
      const seed = (Math.random() * 0xffffffff) >>> 0;
      this.net?.broadcast(
        encodeLobby({ t: "start", seed, characters: chars, stage: this.state.stage, names }),
      );
      this.cb.onStart(seed, chars, this.state.stage, names);
    }
  }

  // --- Mensajes -------------------------------------------------------------

  private onMessage(from: number, data: string): void {
    const msg = decodeLobby(data);
    if (!msg) return;

    if (this.isHost) {
      if (msg.t === "hello") {
        this.state.occupied[from] = true;
        this.state.names[from] = msg.name || `Jugador ${from + 1}`;
        this.broadcastState();
        this.render();
      } else if (msg.t === "pick") {
        this.state.picks[from] = msg.character;
        this.broadcastState();
        this.render();
      }
    } else {
      if (msg.t === "state") {
        this.state = msg.state;
        this.render();
      } else if (msg.t === "start") {
        this.cb.onStart(msg.seed, msg.characters, msg.stage, msg.names);
      }
    }
  }

  private onPeerLeft(slot: number): void {
    if (slot === 0) {
      this.teardown();
      this.cb.onBack();
      return;
    }
    if (this.isHost) {
      this.state.occupied[slot] = false;
      this.state.picks[slot] = null;
      this.state.names[slot] = "";
      this.broadcastState();
      this.render();
    }
  }

  private broadcastState(): void {
    if (!this.isHost) return;
    this.net?.broadcast(encodeLobby({ t: "state", state: this.state }));
  }

  // --- Render ---------------------------------------------------------------

  private render(): void {
    const chars = this.state.phase === "characters";
    this.charsPhaseEl.style.display = chars ? "" : "none";
    this.stagePhaseEl.style.display = chars ? "none" : "";

    // Tarjetas de jugador.
    const cards = this.cardsEl.querySelectorAll<HTMLDivElement>(".player-card");
    for (let p = 0; p < MAX_SLOTS; p++) {
      const card = cards[p];
      if (!card) continue;
      const occ = this.state.occupied[p];
      const label = card.querySelector<HTMLDivElement>(".player-card-label");
      const who = card.querySelector<HTMLDivElement>(".player-card-slot");
      card.classList.toggle("off", !occ);
      card.classList.toggle("ready", occ && !!this.state.picks[p]);
      card.classList.toggle("me", occ && p === this.mySlot);
      card.classList.toggle("host", occ && p === 0);
      if (label) {
        label.textContent = occ
          ? (this.state.names[p] || `Jugador ${p + 1}`) + (p === this.mySlot ? " (tú)" : "")
          : `Jugador ${p + 1}`;
      }
      if (who) {
        const pick = this.state.picks[p];
        who.textContent = !occ
          ? "esperando…"
          : pick
            ? characterLore(pick).name
            : "eligiendo…";
      }
    }

    // Marca los retratos elegidos por alguien.
    for (const [id, cell] of this.portraitCells) {
      cell.classList.toggle("selected", this.state.picks.includes(id));
    }

    // Reposiciona las fichas según el estado.
    if (chars) this.resetChips();

    // Escenario seleccionado + preview.
    for (const [id, cell] of this.stageCells) {
      cell.classList.toggle("selected", id === this.state.stage);
    }
    this.previewStage(this.state.stage);
    if (!chars) this.resetStageChip();

    // Botón del host / aviso de los guests.
    if (this.isHost) {
      this.nextBtn.style.display = "";
      this.waitEl.textContent = "";
      const count = this.state.occupied.filter(Boolean).length;
      if (chars) {
        this.nextLabel.textContent = "Siguiente ›";
        const ready = this.state.occupied.every((o, i) => !o || this.state.picks[i]);
        const disabled = !ready || count < 2;
        setDisabled(this.nextBtn, disabled);
        this.nextBtn.disabled = disabled;
        this.nextBtn.classList.toggle("disabled", disabled);
      } else {
        this.nextLabel.textContent = "¡A luchar! ›";
        setDisabled(this.nextBtn, false);
        this.nextBtn.disabled = false;
        this.nextBtn.classList.remove("disabled");
      }
    } else {
      this.nextBtn.style.display = "none";
      this.waitEl.textContent = chars
        ? "Coge tu ficha y elige personaje. El anfitrión avanzará cuando todos estéis listos."
        : "El anfitrión está eligiendo el escenario…";
    }
  }
}

function emptyState(): LobbyState {
  return {
    phase: "characters",
    picks: [null, null, null, null],
    occupied: [false, false, false, false],
    names: ["", "", "", ""],
    stage: SELECTABLE_STAGES[0],
  };
}
