import { debug, type DebugState } from "../debug/debugState.ts";

/**
 * Menú de pausa con navegación por niveles y migas de pan.
 *
 * Hay una página raíz ("Pausa") y subpáginas (Dev tools, Dummy, Controles). Al
 * entrar en una subpágina, la página anterior queda detrás ATENUADA (gris) y la
 * nueva aparece encima. Arriba se muestran migas de pan (p. ej. "Pausa › Dev
 * tools") y se vuelve pulsando una miga anterior o el botón "‹".
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
    key: "showStun",
    label: "Aturdimiento (stun)",
    hint: "Marca cuándo un jugador ataca o está golpeado.",
  },
  {
    key: "showStateColors",
    label: "Colores de estado",
    hint: "Tiñe al jugador según suelo / aire / pared.",
  },
  {
    key: "showResources",
    label: "Saltos / ataques agotados",
    hint: "Avisa cuando un jugador se queda sin saltos o sin fuerte aéreo.",
  },
  {
    key: "showStats",
    label: "Stats del jugador",
    hint: "Posición, velocidad y estado en vivo.",
  },
  { key: "showFps", label: "FPS" },
];

const DUMMY_TOGGLES: ToggleDef[] = [
  {
    key: "dummyPinned",
    label: "Fijar dummy en su sitio",
    hint: "Clavado e inmóvil, ignora el knockback. Desactívalo para poder empujarlo al vacío; reaparecerá como un jugador.",
  },
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

type PageId = "root" | "dev" | "dummy" | "controls";

const PAGE_TITLE: Record<PageId, string> = {
  root: "Pausa",
  dev: "Dev tools",
  dummy: "Dummy",
  controls: "Controles",
};

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly stack: HTMLDivElement;
  private readonly crumbs: HTMLElement;
  private open = false;

  /** Pila de navegación. Siempre empieza en "root". */
  private nav: PageId[] = ["root"];

  constructor(private readonly cb: PauseMenuCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "pause-menu";

    const panel = document.createElement("div");
    panel.className = "pause-panel";

    this.crumbs = document.createElement("nav");
    this.crumbs.className = "pause-crumbs";
    panel.appendChild(this.crumbs);

    this.stack = document.createElement("div");
    this.stack.className = "pause-stack";
    panel.appendChild(this.stack);

    const scrim = document.createElement("div");
    scrim.className = "pause-scrim";
    scrim.addEventListener("click", () => this.setOpen(false));

    this.root.appendChild(scrim);
    const wrap = document.createElement("div");
    wrap.className = "pause-wrap";
    wrap.appendChild(panel);
    this.root.appendChild(wrap);

    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKey);
    this.renderNav();
  }

  get isOpen(): boolean {
    return this.open;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    // Esc retrocede un nivel; en la raíz, cierra el menú.
    if (this.open && this.nav.length > 1) {
      this.nav.pop();
      this.renderNav();
    } else {
      this.setOpen(!this.open);
    }
  };

  private setOpen(value: boolean): void {
    if (value === this.open) return;
    this.open = value;
    this.root.classList.toggle("open", this.open);
    if (this.open) {
      this.nav = ["root"];
      this.renderNav();
      this.cb.onOpen();
    } else {
      this.cb.onClose();
    }
  }

  private goTo(page: PageId): void {
    this.nav.push(page);
    this.renderNav();
  }

  private backTo(index: number): void {
    this.nav = this.nav.slice(0, index + 1);
    this.renderNav();
  }

  /** Re-dibuja migas de pan + las páginas apiladas (anteriores atenuadas). */
  private renderNav(): void {
    // Migas de pan.
    this.crumbs.replaceChildren();
    this.nav.forEach((page, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "pause-crumb-sep";
        sep.textContent = "›";
        this.crumbs.appendChild(sep);
      }
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.className = "pause-crumb";
      crumb.textContent = PAGE_TITLE[page];
      if (i === this.nav.length - 1) crumb.classList.add("current");
      crumb.addEventListener("click", () => this.backTo(i));
      this.crumbs.appendChild(crumb);
    });

    // Solo se dibuja la página ACTUAL. El rastro de dónde vienes queda en las
    // migas de pan; mostrar las páginas de fondo las solapaba y se leían mal.
    const current = this.nav[this.nav.length - 1];
    const pageEl = this.buildPage(current);
    pageEl.classList.add("pause-page");
    this.stack.replaceChildren(pageEl);
  }

  private buildPage(page: PageId): HTMLElement {
    switch (page) {
      case "dev":
        return this.buildTogglePage(DEV_TOGGLES);
      case "dummy":
        return this.buildTogglePage(DUMMY_TOGGLES);
      case "controls":
        return this.buildControlsPage();
      case "root":
      default:
        return this.buildRootPage();
    }
  }

  private buildRootPage(): HTMLElement {
    const el = document.createElement("div");
    el.appendChild(
      this.navButton("▶  Reanudar", "pause-resume", () =>
        this.setOpen(false),
      ),
    );
    el.appendChild(
      this.navButton("Dev tools  ›", "pause-nav", () => this.goTo("dev")),
    );
    el.appendChild(
      this.navButton("Dummy  ›", "pause-nav", () => this.goTo("dummy")),
    );
    el.appendChild(
      this.navButton("Controles  ›", "pause-nav", () =>
        this.goTo("controls"),
      ),
    );
    return el;
  }

  private buildTogglePage(defs: ToggleDef[]): HTMLElement {
    const el = document.createElement("div");
    for (const def of defs) el.appendChild(this.buildToggle(def));
    return el;
  }

  private buildControlsPage(): HTMLElement {
    const el = document.createElement("div");
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
      el.appendChild(row);
    }
    return el;
  }

  private navButton(
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
