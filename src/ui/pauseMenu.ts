import { POV } from "../engine/config.ts";
import {
  ACTION_LABELS,
  bindings,
  keyLabel,
  rebind,
  resetBindings,
  type PlayerSlot,
} from "../core/bindings.ts";
import { debug, type DebugState } from "../debug/debugState.ts";
import type { GameMode } from "../engine/game/world.ts";

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

/** Depuración · Visuales: lo que se dibuja sobre el mundo. */
const DEBUG_VISUAL_TOGGLES: ToggleDef[] = [
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
];

/** Depuración · Información: overlays de datos. */
const DEBUG_INFO_TOGGLES: ToggleDef[] = [
  {
    key: "showStats",
    label: "Stats del jugador",
    hint: "Posición, velocidad y estado en vivo.",
  },
  { key: "showFps", label: "FPS" },
];

export interface PauseMenuCallbacks {
  onOpen: () => void;
  onClose: () => void;
  /** Volver al menú principal (abandonar la partida). */
  onQuitToMenu: () => void;
  /** Modo actual, para mostrar/ocultar el apartado de Dummy. */
  mode: GameMode;
  /**
   * ¿Se puede ABRIR el menú ahora mismo? (p. ej. false durante la cuenta atrás
   * de intro). Si devuelve false, Escape no abre el menú. Por defecto sí.
   */
  canOpen?: () => boolean;
}

type PageId =
  | "root"
  | "options"
  | "keys"
  | "keysP1"
  | "keysP2"
  | "dummy"
  | "controls"
  | "quit";

const PAGE_TITLE: Record<PageId, string> = {
  root: "Pausa",
  options: "Ajustes",
  keys: "Controles (teclas)",
  keysP1: "Teclas · P1",
  keysP2: "Teclas · P2",
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
    } else if (this.open) {
      this.setOpen(false);
    } else {
      // Abrir: solo si está permitido (p. ej. no durante la cuenta atrás).
      if (this.cb.canOpen && !this.cb.canOpen()) return;
      this.setOpen(true);
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

  /**
   * Re-dibuja la pila de tarjetas. Cada página de `nav` es una TARJETA. La de
   * arriba (actual) está centrada y activa; las anteriores quedan a la
   * izquierda, desplazadas, escaladas y oscurecidas, pero SIGUEN VISIBLES. Al
   * navegar, la nueva tarjeta entra desde la derecha empujando el resto.
   */
  private renderStack(): void {
    // Reconstruimos (sin animación) las tarjetas de la pila actual.
    const cards: HTMLElement[] = this.nav.map((page) => {
      const card = this.buildPage(page);
      card.classList.add("pause-card");
      return card;
    });

    this.viewport.replaceChildren(...cards);
    const top = cards.length - 1;
    cards.forEach((card, i) => {
      this.placeCard(card, top - i);
    });
  }

  /** Coloca una tarjeta según su profundidad en la pila. */
  private placeCard(card: HTMLElement, depth: number): void {
    // Cada nivel se desplaza a la izquierda y se encoge/oscurece un poco.
    const shiftX = -depth * 54;
    const scale = 1 - depth * 0.06;
    card.style.transform = `translateX(${shiftX}px) scale(${scale})`;
    card.style.opacity = depth === 0 ? "1" : "1";
    card.style.zIndex = String(100 - depth);
    card.classList.toggle("behind", depth > 0);
    // Oscurecemos progresivamente las de atrás con una capa interna.
    card.style.setProperty("--dim", String(Math.min(0.62, depth * 0.3)));
    // Las de atrás no reciben clics.
    card.style.pointerEvents = depth === 0 ? "auto" : "none";
  }

  /** Muestra la página actual sin animación (al abrir o resetear). */
  private renderInitial(): void {
    this.renderStack();
  }

  /**
   * Entra a una subpágina: la nueva tarjeta llega desde la derecha y empuja las
   * existentes una posición hacia atrás (se deslizan a la izquierda). Reutiliza
   * las tarjetas ya presentes para que la transición de empuje sea visible.
   */
  private goTo(page: PageId): void {
    if (this.animating) return;
    this.animating = true;
    this.nav.push(page);

    const existing = Array.from(this.viewport.children) as HTMLElement[];

    // Empuja las existentes una posición más atrás (profundidad +1).
    const newTopDepth = existing.length; // tras añadir la nueva
    existing.forEach((card, i) => {
      const depth = newTopDepth - i; // la antigua top pasa a depth 1, etc.
      this.placeCard(card, depth);
    });

    // Crea la nueva tarjeta fuera (a la derecha) y la trae a su sitio (depth 0).
    const card = this.buildPage(page);
    card.classList.add("pause-card");
    card.style.transition = "none";
    card.style.transform = "translateX(120%)";
    card.style.opacity = "0";
    this.viewport.appendChild(card);
    void card.offsetWidth; // reflow para que arranque desde fuera
    card.style.transition = "";
    requestAnimationFrame(() => this.placeCard(card, 0));

    window.setTimeout(() => {
      this.animating = false;
    }, 300);
  }

  /**
   * Vuelve una página: la tarjeta superior sale por la derecha y, A LA VEZ, las
   * tarjetas de debajo se deslizan hacia adelante (de profundidad d a d-1), que
   * es lo que daba la sensación de "sin animación" al volver. Reutilizamos los
   * elementos existentes para que transicionen en lugar de reconstruirlos.
   */
  private back(): void {
    if (this.animating || this.nav.length <= 1) return;
    this.animating = true;

    const cards = Array.from(this.viewport.children) as HTMLElement[];
    const topCard = cards[cards.length - 1];
    const survivors = cards.slice(0, -1);

    // La tarjeta superior sale hacia la derecha.
    topCard.style.pointerEvents = "none";
    topCard.style.transform = "translateX(120%)";
    topCard.style.opacity = "0";

    // Las de debajo avanzan una posición (se recolocan con su transición).
    const newTop = survivors.length - 1;
    survivors.forEach((card, i) => {
      this.placeCard(card, newTop - i);
    });

    this.nav.pop();

    window.setTimeout(() => {
      // Quitamos del DOM solo la tarjeta que salió; las demás ya están puestas.
      if (topCard.parentElement === this.viewport) {
        this.viewport.removeChild(topCard);
      }
      this.animating = false;
    }, 300);
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
      case "dummy":
        this.fillDummy(body);
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
    el.appendChild(this.menuButton("Ajustes", () => this.goTo("options")));
    // El Dummy solo tiene sentido en entrenamiento.
    if (this.cb.mode === "training") {
      el.appendChild(this.menuButton("Dummy", () => this.goTo("dummy")));
    }
    el.appendChild(this.menuButton("Controles", () => this.goTo("controls")));
    el.appendChild(
      this.menuButton("Menú principal", () => this.goTo("quit")),
    );
  }

  /**
   * Ajustes, organizados por categorías. Incluye lo que antes estaba separado
   * en "Dev tools": aquí todo convive por secciones.
   */
  private fillOptions(el: HTMLElement): void {
    // --- Vista ---
    el.appendChild(this.category("Vista"));
    el.appendChild(this.buildPovSlider());

    // --- Interfaz ---
    el.appendChild(this.category("Interfaz"));
    el.appendChild(
      this.buildToggle({
        key: "showGameUi",
        label: "Mostrar UI del juego",
        hint: "Oculta el HUD de porcentajes, vidas y cronómetro para ver el gameplay limpio.",
      }),
    );

    // --- Depuración (lo que antes era Dev tools) ---
    el.appendChild(this.category("Depuración · Visuales"));
    this.fillToggles(el, DEBUG_VISUAL_TOGGLES);

    el.appendChild(this.category("Depuración · Información"));
    this.fillToggles(el, DEBUG_INFO_TOGGLES);
  }

  /** Cabecera de categoría dentro de una página. */
  private category(title: string): HTMLElement {
    const h = document.createElement("div");
    h.className = "pause-subtitle";
    h.textContent = title;
    return h;
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
      // Re-dibuja la pila para reflejar los valores por defecto.
      this.renderStack();
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

  /** Página del dummy: comportamiento + botones para ejecutar ataques. */
  private fillDummy(el: HTMLElement): void {
    // --- Comportamiento (radios) ---
    const behTitle = document.createElement("div");
    behTitle.className = "pause-subtitle";
    behTitle.textContent = "Comportamiento";
    el.appendChild(behTitle);

    const behaviors: Array<{
      value: DebugState["dummyBehavior"];
      label: string;
      hint: string;
    }> = [
      { value: "free", label: "Libre", hint: "Física normal, recibe golpes y knockback." },
      {
        value: "freeze",
        label: "Congelar",
        hint: "Se queda quieto en su posición actual, ignora el knockback.",
      },
      {
        value: "reposition",
        label: "Reposicionar",
        hint: "Recibe golpes; si queda quieto unos segundos vuelve al centro.",
      },
    ];
    for (const b of behaviors) {
      el.appendChild(this.buildDummyRadio(b.value, b.label, b.hint));
    }

    // --- Ataque repetido ---
    const atkTitle = document.createElement("div");
    atkTitle.className = "pause-subtitle";
    atkTitle.textContent = "Hacer que el dummy ataque";
    el.appendChild(atkTitle);

    const note = document.createElement("span");
    note.className = "pause-hint";
    note.textContent =
      "Elige un ataque y el dummy lo repetirá en bucle. El ligero deja una pausa entre golpes; el fuerte sale siempre a carga completa.";
    el.appendChild(note);

    el.appendChild(this.buildAttackRow("Ataque ligero", "light"));
    el.appendChild(this.buildAttackRow("Ataque fuerte", "heavy"));

    // Botón para detener el bucle de ataques.
    const stop = this.menuButton("Parar ataques", () => {
      debug.dummyAttack = null;
      this.renderStack(); // refresca los resaltados
    });
    stop.classList.add("pause-btn-danger");
    el.appendChild(stop);
  }

  private buildDummyRadio(
    value: DebugState["dummyBehavior"],
    label: string,
    hint: string,
  ): HTMLElement {
    const row = document.createElement("label");
    row.className = "pause-row";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "dummy-behavior";
    radio.checked = debug.dummyBehavior === value;
    radio.addEventListener("change", () => {
      if (radio.checked) debug.dummyBehavior = value;
    });

    const text = document.createElement("div");
    text.className = "pause-text";
    const name = document.createElement("span");
    name.className = "pause-label";
    name.textContent = label;
    text.appendChild(name);
    const h = document.createElement("span");
    h.className = "pause-hint";
    h.textContent = hint;
    text.appendChild(h);

    row.appendChild(radio);
    row.appendChild(text);
    return row;
  }

  /**
   * Fila con un ataque y 4 botones de dirección. Pulsar un botón SELECCIONA ese
   * ataque+dirección para que el dummy lo repita en bucle; vuelve a pulsarlo
   * para desactivarlo. El botón activo queda resaltado.
   */
  private buildAttackRow(label: string, kind: "light" | "heavy"): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "pause-attackrow";

    const name = document.createElement("span");
    name.className = "pause-label";
    name.textContent = label;
    wrap.appendChild(name);

    const dirs: Array<{ dir: "neutral" | "side" | "up" | "down"; glyph: string }> = [
      { dir: "neutral", glyph: "●" },
      { dir: "side", glyph: "→" },
      { dir: "up", glyph: "↑" },
      { dir: "down", glyph: "↓" },
    ];

    const btns = document.createElement("div");
    btns.className = "pause-dirbtns";
    for (const d of dirs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pause-dirbtn";
      b.textContent = d.glyph;
      b.title = d.dir;
      // Marca activo si coincide con la selección actual.
      const active =
        debug.dummyAttack?.kind === kind && debug.dummyAttack?.dir === d.dir;
      if (active) b.classList.add("active");
      b.addEventListener("click", () => {
        const current = debug.dummyAttack;
        const isSame = current?.kind === kind && current?.dir === d.dir;
        debug.dummyAttack = isSame ? null : { kind, dir: d.dir };
        this.renderStack(); // refresca resaltados de toda la página
      });
      btns.appendChild(b);
    }
    wrap.appendChild(btns);
    return wrap;
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

    // Botón para reasignar teclas (antes estaba en Ajustes).
    el.appendChild(this.menuButton("Cambiar teclas", () => this.goTo("keys")));
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
