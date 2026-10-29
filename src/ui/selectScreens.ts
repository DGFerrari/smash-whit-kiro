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

/**
 * Pantallas de selección estilo Super Smash Bros.:
 *  - CharacterSelect: una PARRILLA única de fichas de personaje. Cada jugador
 *    tiene una FICHA-CURSOR (P1 azul, P2 rojo, como la "mano" de Smash) que se
 *    posa sobre la ficha elegida con una transición suave.
 *  - StageSelect: parrilla de miniaturas de escenario con una ficha-cursor que
 *    se posa sobre el mapa elegido y un panel de vista previa grande.
 *
 * Son overlays DOM. El flujo (batalla -> personajes -> mapa -> partida) lo
 * orquesta main.ts.
 */

export interface CharacterSelectCallbacks {
  onConfirm: (characters: [CharacterId, CharacterId]) => void;
  onBack: () => void;
}

const TOKEN_COLORS = ["#2f6bff", "#ff4f6d"] as const; // P1, P2
const TOKEN_LABELS = ["P1", "P2"] as const;

export class CharacterSelect {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly cells = new Map<CharacterId, HTMLButtonElement>();
  /** Fichas-cursor (una por jugador) y a qué personaje apunta cada una. */
  private readonly tokens: HTMLDivElement[] = [];
  private readonly picks: [CharacterId, CharacterId] = ["blue", "red"];

  constructor(private readonly cb: CharacterSelectCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "char-select";
    this.root.className = "select-screen";

    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Elige personaje";
    this.root.appendChild(title);

    // Parrilla única de fichas (contenedor relativo: las fichas-cursor flotan).
    const stage = document.createElement("div");
    stage.className = "css-stage";
    this.grid = document.createElement("div");
    this.grid.className = "portrait-grid";
    for (const id of SELECTABLE_CHARACTERS) {
      const def = CHARACTERS[id];
      const cell = document.createElement("button");
      cell.className = "portrait";
      cell.style.setProperty("--c", def.color);
      // "Retrato": bloque de color grande (el personaje) + nombre abajo.
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

      // Clic izquierdo = P1; clic derecho = P2 (como asignar manos en Smash).
      cell.addEventListener("click", () => this.pickFor(0, id));
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.pickFor(1, id);
      });
      this.cells.set(id, cell);
      this.grid.appendChild(cell);
    }
    stage.appendChild(this.grid);

    // Fichas-cursor P1 y P2.
    for (let p = 0; p < 2; p++) {
      const token = document.createElement("div");
      token.className = "css-token";
      token.style.setProperty("--tc", TOKEN_COLORS[p]);
      token.textContent = TOKEN_LABELS[p];
      this.tokens.push(token);
      stage.appendChild(token);
    }
    this.root.appendChild(stage);

    // Pista de uso.
    const hint = document.createElement("p");
    hint.className = "select-hint";
    hint.textContent =
      "Clic izquierdo = ficha P1 · Clic derecho = ficha P2";
    this.root.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = document.createElement("button");
    back.className = "menu-btn select-back";
    back.textContent = "‹ Atrás";
    back.addEventListener("click", () => this.cb.onBack());
    actions.appendChild(back);
    const go = document.createElement("button");
    go.className = "menu-btn select-go";
    go.textContent = "Elegir escenario ›";
    go.addEventListener("click", () => this.cb.onConfirm([...this.picks]));
    actions.appendChild(go);
    this.root.appendChild(actions);

    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add("open");
    // Posicionamos las fichas cuando el layout ya tiene medidas reales.
    requestAnimationFrame(() => {
      this.placeToken(0);
      this.placeToken(1);
    });
  }
  hide(): void {
    this.root.classList.remove("open");
  }

  private pickFor(player: 0 | 1, id: CharacterId): void {
    this.picks[player] = id;
    this.placeToken(player);
  }

  /** Coloca la ficha-cursor del jugador sobre el retrato elegido. */
  private placeToken(player: 0 | 1): void {
    const cell = this.cells.get(this.picks[player]);
    const token = this.tokens[player];
    if (!cell || !token) return;
    const stage = token.parentElement as HTMLElement;
    const sRect = stage.getBoundingClientRect();
    const cRect = cell.getBoundingClientRect();
    // Posición dentro del stage: esquina del retrato, con P1 arriba-izq y P2
    // abajo-der para que no se solapen si eligen el mismo.
    const offX = player === 0 ? 8 : cRect.width - 40;
    const offY = player === 0 ? 8 : cRect.height - 40;
    token.style.left = `${cRect.left - sRect.left + offX}px`;
    token.style.top = `${cRect.top - sRect.top + offY}px`;
  }
}

export interface StageSelectCallbacks {
  onConfirm: (stage: StageId) => void;
  onBack: () => void;
}

export class StageSelect {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly token: HTMLDivElement;
  private readonly previewThumb: HTMLDivElement;
  private readonly previewName: HTMLDivElement;
  private pick: StageId = SELECTABLE_STAGES[0];
  private readonly cells = new Map<StageId, HTMLButtonElement>();

  constructor(private readonly cb: StageSelectCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "stage-select";
    this.root.className = "select-screen";

    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Elige escenario";
    this.root.appendChild(title);

    const layout = document.createElement("div");
    layout.className = "stage-layout";

    // Panel de vista previa grande (izquierda, como en Smash).
    const preview = document.createElement("div");
    preview.className = "stage-preview";
    this.previewThumb = document.createElement("div");
    this.previewThumb.className = "stage-preview-thumb";
    preview.appendChild(this.previewThumb);
    this.previewName = document.createElement("div");
    this.previewName.className = "stage-preview-name";
    preview.appendChild(this.previewName);
    layout.appendChild(preview);

    // Parrilla de miniaturas + ficha-cursor.
    const stage = document.createElement("div");
    stage.className = "css-stage";
    this.grid = document.createElement("div");
    this.grid.className = "stage-grid";
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
      cell.addEventListener("click", () => this.pickStage(id));
      cell.addEventListener("mouseenter", () => this.preview(id));
      this.cells.set(id, cell);
      this.grid.appendChild(cell);
    }
    stage.appendChild(this.grid);

    this.token = document.createElement("div");
    this.token.className = "css-token stage-token";
    this.token.textContent = "✪";
    stage.appendChild(this.token);
    layout.appendChild(stage);

    this.root.appendChild(layout);

    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = document.createElement("button");
    back.className = "menu-btn select-back";
    back.textContent = "‹ Atrás";
    back.addEventListener("click", () => this.cb.onBack());
    actions.appendChild(back);
    const go = document.createElement("button");
    go.className = "menu-btn select-go";
    go.textContent = "¡A luchar! ›";
    go.addEventListener("click", () => this.cb.onConfirm(this.pick));
    actions.appendChild(go);
    this.root.appendChild(actions);

    document.body.appendChild(this.root);
    this.preview(this.pick);
  }

  show(): void {
    this.root.classList.add("open");
    requestAnimationFrame(() => this.placeToken());
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

  private pickStage(id: StageId): void {
    this.pick = id;
    this.preview(id);
    this.placeToken();
  }

  private preview(id: StageId): void {
    this.previewThumb.style.background = this.thumbGradient(id);
    this.previewName.textContent = STAGES[id].name;
  }

  private placeToken(): void {
    const cell = this.cells.get(this.pick);
    if (!cell) return;
    const stage = this.token.parentElement as HTMLElement;
    const sRect = stage.getBoundingClientRect();
    const cRect = cell.getBoundingClientRect();
    this.token.style.left = `${cRect.left - sRect.left + cRect.width / 2 - 22}px`;
    this.token.style.top = `${cRect.top - sRect.top + cRect.height / 2 - 22}px`;
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
