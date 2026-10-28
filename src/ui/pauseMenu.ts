import { POV } from "../config.ts";
import {
  ACTION_LABELS,
  bindings,
  keyLabel,
  rebind,
  resetBindings,
  type PlayerSlot,
} from "../core/bindings.ts";
import { debug, type DebugState } from "../debug/debugState.ts";
import type { GameMode } from "../game/world.ts";

/**
 * Menú de pausa con navegación tipo "stack" horizontal.
 *
 * Hay una página raíz ("Pausa") y subpáginas (Opciones, Dev tools, Dummy,
 * Controles). Al entrar en una subpágina, esta ENTRA desde la derecha y empuja
 * a la página anterior hacia la izquierda; al volver, ocurre al revés. Cada
 * subpágina muestra arriba una flecha "‹" para volver y su propio título (no
 * una ruta de migas de pan).
 *
 * El menú solo se abre/cierra con Escape (no al hacer clic fuera). Avisa por
 * callbacks (onOpen / onClose) para pausar el juego y el reencuadre de cámara.
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

export interface PauseMenuCallbacks {
  onOpen: () => void;
  onClose: () => void;
  /** Volver al menú principal (abandonar la partida). */
  onQuitToMenu: () => void;
  /** Modo actual, para mostrar/ocultar el apartado de Dummy. */
  mode: GameMode;
}

type PageId =
  | "root"
  | "options"
  | "keys"
  | "keysP1"
  | "keysP2"
  | "dev"
  | "dummy"
  | "controls"
  | "quit";

const PAGE_TITLE: Record<PageId, string> = {
  root: "Pausa",
  options: "Opciones",
  keys: "Controles (teclas)",
  keysP1: "Teclas · P1",
  keysP2: "Teclas · P2",
  dev: "Dev tools",
  dummy: "Dummy",
  controls: "Controles",
  quit: "Salir de la partida",
};

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private open = false;

  /** Pila de navegación. Siempre empieza en "root". */
  private nav: PageId[] = ["root"];
  /** ¿Hay una animación de transición en curso? */
  private animating = false;
  /** Mientras capturamos una tecla para reasignar, Esc no navega. */
  private capturing = false;

  constructor(private readonly cb: PauseMenuCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "pause-menu";

    const panel = document.createElement("div");
    panel.className = "pause-panel";

    // Viewport recorta; dentro deslizan las páginas horizontalmente.
    this.viewport = document.createElement("div");
    this.viewport.className = "pause-viewport";
    panel.appendChild(this.viewport);

    // Nota: ya NO hay scrim que cierre al hacer clic. El menú solo se controla
    // con Escape. Mantenemos un velo visual, pero sin capturar clics de cierre.
    const scrim = document.createElement("div");
    scrim.className = "pause-scrim";

    this.root.appendChild(scrim);
    const wrap = document.createElement("div");
    wrap.className = "pause-wrap";
    wrap.appendChild(panel);
    this.root.appendChild(wrap);

    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKey);
    this.renderInitial();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Elimina el menú del DOM y desengancha sus listeners (al salir de partida). */
  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    // Si estamos capturando una tecla para reasignar, Esc cancela la captura
    // (lo gestiona el propio capturador), no navega el menú.
    if (this.capturing) return;
    e.preventDefault();
    if (this.animating) return;
    // Esc retrocede un nivel; en la raíz, cierra el menú.
    if (this.open && this.nav.length > 1) {
      this.back();
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
      this.renderInitial();
      this.cb.onOpen();
    } else {
      this.cb.onClose();
    }
  }

  /** Muestra la página actual sin animación (al abrir o resetear). */
  private renderInitial(): void {
    const current = this.nav[this.nav.length - 1];
    const page = this.buildPage(current);
    this.viewport.replaceChildren(page);
  }

  /** Entra a una subpágina: la nueva llega desde la derecha y empuja la actual. */
  private goTo(page: PageId): void {
    if (this.animating) return;
    const outgoing = this.viewport.firstElementChild as HTMLElement | null;
    this.nav.push(page);
    const incoming = this.buildPage(page);
    this.slide(outgoing, incoming, "forward");
  }

  /** Vuelve una página: la actual sale por la derecha y reentra la anterior. */
  private back(): void {
    if (this.animating || this.nav.length <= 1) return;
    const outgoing = this.viewport.firstElementChild as HTMLElement | null;
    this.nav.pop();
    const incoming = this.buildPage(this.nav[this.nav.length - 1]);
    this.slide(outgoing, incoming, "back");
  }

  /**
   * Anima el deslizamiento horizontal entre dos páginas.
   *  - forward: la nueva entra desde la derecha, la vieja se va a la izquierda.
   *  - back: la nueva entra desde la izquierda, la vieja se va a la derecha.
   */
  private slide(
    outgoing: HTMLElement | null,
    incoming: HTMLElement,
    dir: "forward" | "back",
  ): void {
    this.animating = true;

    const fromIncoming = dir === "forward" ? "100%" : "-100%";
    const toOutgoing = dir === "forward" ? "-100%" : "100%";

    incoming.style.transform = `translateX(${fromIncoming})`;
    this.viewport.appendChild(incoming);

    // Forzamos reflow para que la transición parta del estado inicial.
    void incoming.offsetWidth;

    incoming.classList.add("sliding");
    if (outgoing) outgoing.classList.add("sliding");

    requestAnimationFrame(() => {
      incoming.style.transform = "translateX(0)";
      if (outgoing) outgoing.style.transform = `translateX(${toOutgoing})`;
    });

    const done = (): void => {
      incoming.classList.remove("sliding");
      incoming.style.transform = "";
      if (outgoing && outgoing.parentElement === this.viewport) {
        this.viewport.removeChild(outgoing);
      }
      this.animating = false;
    };

    incoming.addEventListener("transitionend", done, { once: true });
    // Red de seguridad por si transitionend no dispara.
    window.setTimeout(done, 320);
  }

  private buildPage(page: PageId): HTMLElement {
    const el = document.createElement("div");
    el.className = "pause-page";

    // Cabecera: título, con flecha de volver salvo en la raíz.
    const header = document.createElement("div");
    header.className = "pause-header";
    if (page !== "root") {
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "pause-back";
      backBtn.setAttribute("aria-label", "Volver");
      backBtn.textContent = "‹";
      backBtn.addEventListener("click", () => this.back());
      header.appendChild(backBtn);
    }
    const title = document.createElement("h2");
    title.className = "pause-title";
    title.textContent = PAGE_TITLE[page];
    header.appendChild(title);
    el.appendChild(header);

    const body = document.createElement("div");
    body.className = "pause-body";
    el.appendChild(body);

    switch (page) {
      case "options":
        this.fillOptions(body);
        break;
      case "keys":
        this.fillKeys(body);
        break;
      case "keysP1":
        this.fillKeyBindings(body, "p1");
        break;
      case "keysP2":
        this.fillKeyBindings(body, "p2");
        break;
      case "dev":
        this.fillToggles(body, DEV_TOGGLES);
        break;
      case "dummy":
        this.fillToggles(body, DUMMY_TOGGLES);
        break;
      case "controls":
        this.fillControls(body);
        break;
      case "quit":
        this.fillQuit(body);
        break;
      case "root":
      default:
        this.fillRoot(body);
        break;
    }
    return el;
  }

  private fillRoot(el: HTMLElement): void {
    el.appendChild(this.menuButton("Reanudar", () => this.setOpen(false)));
    el.appendChild(this.menuButton("Opciones", () => this.goTo("options")));
    el.appendChild(this.menuButton("Dev tools", () => this.goTo("dev")));
    // El Dummy solo tiene sentido en entrenamiento.
    if (this.cb.mode === "training") {
      el.appendChild(this.menuButton("Dummy", () => this.goTo("dummy")));
    }
    el.appendChild(this.menuButton("Controles", () => this.goTo("controls")));
    el.appendChild(
      this.menuButton("Menú principal", () => this.goTo("quit")),
    );
  }

  /** Opciones del jugador: POV + acceso al remapeo de teclas. */
  private fillOptions(el: HTMLElement): void {
    el.appendChild(this.buildPovSlider());
    el.appendChild(
      this.menuButton("Cambiar teclas", () => this.goTo("keys")),
    );
  }

  /** Elección de qué jugador remapear. */
  private fillKeys(el: HTMLElement): void {
    el.appendChild(this.menuButton("Jugador 1", () => this.goTo("keysP1")));
    el.appendChild(this.menuButton("Jugador 2", () => this.goTo("keysP2")));
  }

  /** Lista de acciones con su tecla; pulsar una captura la nueva tecla. */
  private fillKeyBindings(el: HTMLElement, slot: PlayerSlot): void {
    for (const { action, label } of ACTION_LABELS) {
      const row = document.createElement("div");
      row.className = "pause-keyrow";

      const name = document.createElement("span");
      name.className = "pause-label";
      name.textContent = label;
      row.appendChild(name);

      const keyBtn = document.createElement("button");
      keyBtn.type = "button";
      keyBtn.className = "pause-key";
      keyBtn.textContent = keyLabel(bindings[slot][action][0] ?? "—");
      keyBtn.addEventListener("click", () => {
        this.captureKey(slot, action, keyBtn);
      });
      row.appendChild(keyBtn);

      el.appendChild(row);
    }

    const reset = this.menuButton("Restaurar por defecto", () => {
      resetBindings(slot);
      // Re-dibuja la página actual para reflejar los valores por defecto.
      const page = this.buildPage(slot === "p1" ? "keysP1" : "keysP2");
      this.viewport.replaceChildren(page);
    });
    reset.classList.add("pause-btn-danger");
    el.appendChild(reset);
  }

  /**
   * Captura la próxima tecla pulsada y la asigna a la acción. Escape cancela.
   */
  private captureKey(
    slot: PlayerSlot,
    action: (typeof ACTION_LABELS)[number]["action"],
    btn: HTMLButtonElement,
  ): void {
    if (this.capturing) return;
    this.capturing = true;
    btn.classList.add("capturing");
    btn.textContent = "Pulsa una tecla…";

    const finish = (): void => {
      window.removeEventListener("keydown", onDown, true);
      this.capturing = false;
      btn.classList.remove("capturing");
    };

    const onDown = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key.toLowerCase();
      if (key !== "escape") {
        rebind(slot, action, key);
      }
      btn.textContent = keyLabel(bindings[slot][action][0] ?? "—");
      finish();
    };

    // Captura en fase de captura para adelantarnos al onKey del menú.
    window.addEventListener("keydown", onDown, true);
  }

  /** Confirmación para abandonar la partida y volver al menú principal. */
  private fillQuit(el: HTMLElement): void {
    const warn = document.createElement("p");
    warn.className = "pause-warn";
    warn.textContent =
      "Si sales ahora perderás el progreso de esta partida. ¿Seguro?";
    el.appendChild(warn);

    const confirm = this.menuButton("Sí, salir al menú", () => {
      this.setOpen(false);
      this.cb.onQuitToMenu();
    });
    confirm.classList.add("pause-btn-danger");
    el.appendChild(confirm);

    el.appendChild(this.menuButton("Cancelar", () => this.back()));
  }

  private buildPovSlider(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "pause-field";

    const head = document.createElement("div");
    head.className = "pause-field-head";

    const label = document.createElement("span");
    label.className = "pause-label";
    label.textContent = "POV (zoom de la partida)";
    head.appendChild(label);

    const value = document.createElement("span");
    value.className = "pause-field-value";
    const fmt = (v: number): string => `${Math.round(v * 100)}%`;
    value.textContent = fmt(debug.povZoom);
    head.appendChild(value);

    wrap.appendChild(head);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "pause-slider";
    slider.min = String(POV.min);
    slider.max = String(POV.max);
    slider.step = String(POV.step);
    slider.value = String(debug.povZoom);
    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      debug.povZoom = v;
      value.textContent = fmt(v);
    });
    wrap.appendChild(slider);

    const hint = document.createElement("span");
    hint.className = "pause-hint";
    hint.textContent =
      "Menos % aleja la cámara (ves más campo); más % acerca. No afecta al juego, solo a tu vista.";
    wrap.appendChild(hint);

    return wrap;
  }

  private fillToggles(el: HTMLElement, defs: ToggleDef[]): void {
    for (const def of defs) el.appendChild(this.buildToggle(def));
  }

  /** Resumen de controles de P1 (leído en vivo de los bindings) + la pausa. */
  private fillControls(el: HTMLElement): void {
    const rows: Array<[string, string]> = ACTION_LABELS.map(
      ({ action, label }) => [
        label,
        bindings.p1[action].map(keyLabel).join(" / "),
      ],
    );
    rows.push(["Pausa", "Esc"]);

    for (const [action, keys] of rows) {
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
  }

  /** Botón de menú uniforme (mismo tamaño y estilo gris, azul al hover). */
  private menuButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "pause-btn";
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
    cb.checked = debug[def.key] as boolean;
    cb.addEventListener("change", () => {
      (debug[def.key] as boolean) = cb.checked;
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
