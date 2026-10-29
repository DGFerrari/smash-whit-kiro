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
 * Pantallas de selección estilo Smash:
 *  - CharacterSelect: dos columnas (P1, P2), cada una con una parrilla de
 *    personajes. Al confirmar devuelve los dos personajes elegidos.
 *  - StageSelect: parrilla de escenarios. Al confirmar devuelve el escenario.
 *
 * Son overlays DOM independientes del resto del juego. El flujo (batalla ->
 * personajes -> mapa -> partida) lo orquesta main.ts.
 */

export interface CharacterSelectCallbacks {
  onConfirm: (characters: [CharacterId, CharacterId]) => void;
  onBack: () => void;
}

export class CharacterSelect {
  private readonly root: HTMLDivElement;
  private readonly picks: [CharacterId, CharacterId] = ["blue", "red"];
  private readonly cells: Array<Map<CharacterId, HTMLButtonElement>> = [
    new Map(),
    new Map(),
  ];

  constructor(private readonly cb: CharacterSelectCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "char-select";
    this.root.className = "select-screen";

    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Elige personaje";
    this.root.appendChild(title);

    const columns = document.createElement("div");
    columns.className = "char-columns";
    columns.appendChild(this.buildColumn(0, "P1"));
    columns.appendChild(this.buildColumn(1, "P2"));
    this.root.appendChild(columns);

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
    this.refresh();
  }

  show(): void {
    this.root.classList.add("open");
  }
  hide(): void {
    this.root.classList.remove("open");
  }

  private buildColumn(player: 0 | 1, label: string): HTMLElement {
    const col = document.createElement("div");
    col.className = "char-col";

    const head = document.createElement("div");
    head.className = "char-col-head";
    head.textContent = label;
    col.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "char-grid";
    for (const id of SELECTABLE_CHARACTERS) {
      const def = CHARACTERS[id];
      const cell = document.createElement("button");
      cell.className = "char-cell";
      cell.style.setProperty("--c", def.color);
      const swatch = document.createElement("span");
      swatch.className = "char-swatch";
      swatch.style.background = def.color;
      cell.appendChild(swatch);
      const name = document.createElement("span");
      name.className = "char-name";
      name.textContent = def.name;
      cell.appendChild(name);
      cell.addEventListener("click", () => {
        this.picks[player] = id;
        this.refresh();
      });
      this.cells[player].set(id, cell);
      grid.appendChild(cell);
    }
    col.appendChild(grid);
    return col;
  }

  private refresh(): void {
    for (let p = 0; p < 2; p++) {
      for (const [id, cell] of this.cells[p]) {
        cell.classList.toggle("selected", this.picks[p] === id);
      }
    }
  }
}

export interface StageSelectCallbacks {
  onConfirm: (stage: StageId) => void;
  onBack: () => void;
}

export class StageSelect {
  private readonly root: HTMLDivElement;
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

    const grid = document.createElement("div");
    grid.className = "stage-grid";
    for (const id of SELECTABLE_STAGES) {
      const def = STAGES[id];
      const cell = document.createElement("button");
      cell.className = "stage-cell";
      // Miniatura: un degradado con los colores del tema del escenario.
      const bg = `#${def.theme.background.toString(16).padStart(6, "0")}`;
      const top = `#${def.theme.solidTop.toString(16).padStart(6, "0")}`;
      const thumb = document.createElement("div");
      thumb.className = "stage-thumb";
      thumb.style.background = `linear-gradient(160deg, ${bg} 55%, ${top} 55%)`;
      cell.appendChild(thumb);
      const name = document.createElement("span");
      name.className = "stage-name";
      name.textContent = def.name;
      cell.appendChild(name);
      cell.addEventListener("click", () => {
        this.pick = id;
        this.refresh();
      });
      this.cells.set(id, cell);
      grid.appendChild(cell);
    }
    this.root.appendChild(grid);

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
    this.refresh();
  }

  show(): void {
    this.root.classList.add("open");
  }
  hide(): void {
    this.root.classList.remove("open");
  }

  private refresh(): void {
    for (const [id, cell] of this.cells) {
      cell.classList.toggle("selected", this.pick === id);
    }
  }
}
