import { debug, type DebugState } from "../debug/debugState.ts";

/**
 * Menú de pausa con submenús en columnas.
 *
 * El panel principal vive pegado a la derecha. Al abrir un submenú (Dev tools,
 * Controles), este aparece como OTRA columna a la IZQUIERDA del panel principal
 * y lo empuja: las columnas se apilan de derecha a izquierda. Cerrar un submenú
 * lo retira y las demás recuperan su sitio.
 *
 * El menú avisa por callbacks (onOpen / onClose) para pausar el juego y el zoom.
 */

interface ToggleDef {
  key: keyof DebugState;
  label: string;
  hint?: string;
}

const DEV_TOGGLES: ToggleDef[] = [
  {
    key: "showBlastZone",
    label: "Borde del mapa (blast zone)",
    hint: "Dibuja el límite invisible que mata al jugador.",
  },
  {
    key: "showHitboxes",
    label: "Hitboxes",
    hint: "Contorno de las cajas de colisión.",
  },
  {
    key: "showStats",
    label: "Stats del jugador",
    hint: "Posición, velocidad y estado en vivo.",
  },
  { key: "showFps", label: "FPS" },
];

const CONTROLS: Array<[string, string]> = [
  ["Mover", "A / D  ·  ← / →"],
  ["Saltar / doble salto", "Espacio · W · ↑"],
  ["Apuntar ataque", "W/↑ arriba · S/↓ abajo"],
  ["Ataque ligero", "J"],
  ["Ataque fuerte (cargar)", "K (mantener)"],
  ["Pausa", "Esc"],
];

export interface PauseMenuCallbacks {
  onOpen: () => void;
  onClose: () => void;
}

/** Identificador de cada submenú. */
type SubmenuId = "dev" | "controls";

export class PauseMenu {
  private readonly root: HTMLDivElement;
  /** Contenedor flex donde se apilan las columnas (fila). */
  private readonly columns: HTMLDivElement;
  private open = false;

  /** Submenús abiertos, en orden de apertura (se insertan a la izquierda). */
  private readonly openSubmenus = new Map<SubmenuId, HTMLElement>();

  constructor(private readonly cb: PauseMenuCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "pause-menu";
    this.columns = document.createElement("div");
    this.columns.className = "pause-columns";
    this.build();
    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKey);
  }

  get isOpen(): boolean {
    return this.open;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    // Esc cierra primero el último submenú abierto; si no hay, cierra el menú.
    if (this.open && this.openSubmenus.size > 0) {
      const last = [...this.openSubmenus.keys()].pop()!;
      this.closeSubmenu(last);
    } else {
      this.setOpen(!this.open);
    }
  };

  private setOpen(value: boolean): void {
    if (value === this.open) return;
    this.open = value;
    this.root.classList.toggle("open", this.open);
    if (this.open) {
      this.cb.onOpen();
    } else {
      // Al cerrar el menú, cerramos también los submenús.
      for (const id of [...this.openSubmenus.keys()]) this.closeSubmenu(id);
      this.cb.onClose();
    }
  }

  private build(): void {
    // Capa oscura de fondo (clic para cerrar todo).
    const scrim = document.createElement("div");
    scrim.className = "pause-scrim";
    scrim.addEventListener("click", () => this.setOpen(false));
    this.root.appendChild(scrim);

    this.root.appendChild(this.columns);

    // El panel principal va el último del flex, así queda a la derecha.
    this.columns.appendChild(this.buildMainPanel());
  }

  private buildMainPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "pause-panel pause-main";

    const header = document.createElement("div");
    header.className = "pause-header";
    const title = document.createElement("h2");
    title.textContent = "Pausa";
    header.appendChild(title);
    const close = document.createElement("button");
    close.className = "pause-close";
    close.type = "button";
    close.textContent = "✕";
    close.title = "Cerrar (Esc)";
    close.addEventListener("click", () => this.setOpen(false));
    header.appendChild(close);
    panel.appendChild(header);

    // Botones del menú principal.
    panel.appendChild(
      this.buildMenuButton("▶  Reanudar", "pause-resume", () =>
        this.setOpen(false),
      ),
    );
    panel.appendChild(
      this.buildMenuButton("Dev tools  ›", "pause-nav", () =>
        this.toggleSubmenu("dev"),
      ),
    );
    panel.appendChild(
      this.buildMenuButton("Controles  ›", "pause-nav", () =>
        this.toggleSubmenu("controls"),
      ),
    );

    const foot = document.createElement("p");
    foot.className = "pause-foot";
    foot.textContent = "Esc para reanudar";
    panel.appendChild(foot);

    return panel;
  }

  private buildMenuButton(
    label: string,
    cls: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = cls;
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private toggleSubmenu(id: SubmenuId): void {
    if (this.openSubmenus.has(id)) this.closeSubmenu(id);
    else this.openSubmenu(id);
  }

  private openSubmenu(id: SubmenuId): void {
    if (this.openSubmenus.has(id)) return;
    const col =
      id === "dev" ? this.buildDevColumn() : this.buildControlsColumn();
    // Se inserta al PRINCIPIO del flex: queda a la izquierda, empujando.
    this.columns.insertBefore(col, this.columns.firstChild);
    this.openSubmenus.set(id, col);
    // Forzamos reflow y animamos la entrada.
    requestAnimationFrame(() => col.classList.add("in"));
  }

  private closeSubmenu(id: SubmenuId): void {
    const col = this.openSubmenus.get(id);
    if (!col) return;
    this.openSubmenus.delete(id);
    col.classList.remove("in");
    col.addEventListener(
      "transitionend",
      () => col.remove(),
      { once: true },
    );
    // Red de seguridad por si no dispara transitionend.
    setTimeout(() => col.remove(), 300);
  }

  /** Columna de submenú con cabecera "Atrás" + contenido. */
  private buildSubColumn(title: string, id: SubmenuId): HTMLElement {
    const col = document.createElement("div");
    col.className = "pause-panel pause-sub";

    const header = document.createElement("div");
    header.className = "pause-header";
    const back = document.createElement("button");
    back.className = "pause-back";
    back.type = "button";
    back.textContent = "‹ Atrás";
    back.addEventListener("click", () => this.closeSubmenu(id));
    header.appendChild(back);
    const h = document.createElement("h2");
    h.textContent = title;
    header.appendChild(h);
    col.appendChild(header);

    return col;
  }

  private buildDevColumn(): HTMLElement {
    const col = this.buildSubColumn("Dev tools", "dev");
    for (const def of DEV_TOGGLES) col.appendChild(this.buildToggle(def));
    return col;
  }

  private buildControlsColumn(): HTMLElement {
    const col = this.buildSubColumn("Controles", "controls");
    for (const [action, keys] of CONTROLS) {
      const row = document.createElement("div");
      row.className = "pause-control";
      const a = document.createElement("span");
      a.className = "pause-control-action";
      a.textContent = action;
      const k = document.createElement("span");
      k.className = "pause-control-keys";
      k.textContent = keys;
      row.appendChild(a);
      row.appendChild(k);
      col.appendChild(row);
    }
    return col;
  }

  private buildToggle(def: ToggleDef): HTMLElement {
    const row = document.createElement("label");
    row.className = "pause-row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = debug[def.key];
    cb.addEventListener("change", () => {
      debug[def.key] = cb.checked;
    });

    const text = document.createElement("div");
    text.className = "pause-text";

    const name = document.createElement("span");
    name.className = "pause-label";
    name.textContent = def.label;
    text.appendChild(name);

    if (def.hint) {
      const hint = document.createElement("span");
      hint.className = "pause-hint";
      hint.textContent = def.hint;
      text.appendChild(hint);
    }

    row.appendChild(cb);
    row.appendChild(text);
    return row;
  }
}
