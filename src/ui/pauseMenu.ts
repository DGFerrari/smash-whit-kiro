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
import { trainingOptions, type DummyBehavior } from "../engine/game/trainingOptions.ts";
import type { GameMode } from "../engine/game/world.ts";
import { CHARACTERS, SELECTABLE_CHARACTERS, type CharacterId } from "../engine/game/characters.ts";
import { getMoveset } from "../engine/combat/movesets.ts";
import type { AttackDir } from "../engine/combat/attacks.ts";
import { characterLore } from "../content/lore.ts";
import { getQualityManager } from "../render/quality/qualityManager.ts";
import {
  LEVEL_CONTROL_KEYS,
  PRESET_IDS,
  RENDER_SCALES,
  type ControlKey,
  type PresetId,
  type RenderScale,
} from "../render/quality/visualPrefs.ts";
import { button, dialog, levelSelect, slider, tabs, toggle } from "./design/components.ts";
import { getMenuNavigator } from "./nav/menuNavigator.ts";
import { keyHint } from "./nav/keyHints.ts";
import { setLegend } from "./nav/legend.ts";
import "./pauseMenu.css";

/**
 * Menú de pausa de partida local (R3.1, R3.4, R6.3–R6.7, R6.12, R9.1, R9.5).
 *
 * Es un diálogo obligatorio: no se cierra con clic fuera; Escape (o B en el
 * gamepad, que el Navegador_Menús traduce a Escape) equivale a "Continuar" en
 * la raíz y a "Volver" en las subpáginas.
 *
 * Páginas: raíz (Continuar · Opciones · Dummy · Salir), Opciones con pestañas
 * (Gráficos, Accesibilidad, Controles, Audio, Depuración), reasignación de
 * teclas por jugador, Dummy (solo entrenamiento) y confirmación de salida.
 *
 * Gráficos y Accesibilidad leen y escriben en el Gestor_Calidad compartido
 * (`getQualityManager()`); cada cambio se aplica al instante y se guarda con
 * *debounce*. Las teclas se siguen guardando con `rebind`/`resetBindings`.
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

/** Etiquetas visibles de cada Control_Gráfico. */
export const CONTROL_LABELS: Record<ControlKey, string> = {
  particles: "Partículas",
  flashes: "Destellos de impacto",
  lensFlares: "Destellos de lente",
  bloom: "Bloom",
  dof: "Profundidad de campo",
  shadows: "Sombras",
  cameraShake: "Vibración de cámara",
  speedLines: "Líneas de velocidad",
  bgAnimations: "Animaciones de fondo",
  renderScale: "Escala de resolución",
};

const PRESET_NAMES: Record<PresetId, string> = {
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
};

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
  /** Entrenamiento: personaje actual del jugador. */
  currentCharacter?: CharacterId;
  /** Entrenamiento: cambiar de personaje (reinicia el entrenamiento con él). */
  onChangeCharacter?: (id: CharacterId) => void;
}

type PageId = "root" | "options" | "keys" | "keysP1" | "keysP2" | "dummy" | "character" | "quit";

const PAGE_TITLE: Record<PageId, string> = {
  root: "Pausa",
  options: "Opciones",
  keys: "Reasignar teclas",
  keysP1: "Teclas · Jugador 1",
  keysP2: "Teclas · Jugador 2",
  dummy: "Dummy",
  character: "Cambiar personaje",
  quit: "Salir de la partida",
};

export type OptionsTab = "graphics" | "accessibility" | "controls" | "audio" | "debug";

const OPTION_TABS: { id: OptionsTab; label: string }[] = [
  { id: "graphics", label: "Gráficos" },
  { id: "accessibility", label: "Accesibilidad" },
  { id: "controls", label: "Controles" },
  { id: "audio", label: "Audio" },
  { id: "debug", label: "Depuración" },
];

/** Atributo para recuperar el foco tras volver a dibujar una página. */
const KEY_ATTR = "data-pause-key";

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly body: HTMLDivElement;
  private open = false;

  /** Pila de navegación. Siempre empieza en "root". */
  private nav: PageId[] = ["root"];
  /** Pestaña activa de Opciones (se conserva al volver a la página). */
  private optionsTab: OptionsTab = "graphics";
  /** Mientras capturamos una tecla para reasignar, Esc no navega. */
  private capturing = false;
  private unmountNav: (() => void) | null = null;

  constructor(private readonly cb: PauseMenuCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "pause-menu";
    this.root.className = "kb-pause";

    // Velo visual: no cierra al hacer clic (diálogo obligatorio).
    const scrim = document.createElement("div");
    scrim.className = "kb-pause__scrim";
    this.root.appendChild(scrim);

    this.box = document.createElement("div");
    this.box.className = "kb-pause__dialog";
    this.box.setAttribute("role", "alertdialog");
    this.box.setAttribute("aria-modal", "true");
    this.box.dataset.mandatory = "";

    const header = document.createElement("div");
    header.className = "kb-pause__header";
    this.backBtn = button({
      label: "‹",
      variant: "ghost",
      onActivate: () => this.back(),
    });
    this.backBtn.classList.add("kb-pause__back");
    this.backBtn.setAttribute("aria-label", "Volver");
    this.titleEl = document.createElement("h2");
    this.titleEl.className = "kb-pause__title";
    this.titleEl.id = "kb-pause-title";
    this.box.setAttribute("aria-labelledby", this.titleEl.id);
    header.append(this.backBtn, this.titleEl);

    this.body = document.createElement("div");
    this.body.className = "kb-pause__body";

    this.box.append(header, this.body);
    this.root.appendChild(this.box);
    // Leyenda: Escape/B retrocede un nivel o, en la raíz, continúa la partida.
    keyHint(this.backBtn, "escape", { hotkey: false });
    setLegend(this.box, {
      items: () => [{ key: "escape", pad: "b", label: this.nav.length > 1 ? "Volver" : "Continuar" }],
    });
    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKey);
    this.render();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Elimina el menú del DOM y desengancha sus listeners (al salir de partida). */
  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.unmountNav?.();
    this.unmountNav = null;
    this.root.remove();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    // La captura de tecla gestiona su propio Escape (cancelar).
    if (this.capturing) return;
    if (this.open) {
      // Con el menú abierto, el Navegador_Menús ya gestiona Escape/B (onCancel).
      if (e.defaultPrevented) return;
      e.preventDefault();
      this.handleEscape();
      return;
    }
    if (this.cb.canOpen && !this.cb.canOpen()) return;
    e.preventDefault();
    this.setOpen(true);
  };

  /** Escape/B: retrocede un nivel; en la raíz equivale a "Continuar". */
  private handleEscape(): void {
    if (this.capturing) return;
    if (this.nav.length > 1) this.back();
    else this.setOpen(false);
  }

  private setOpen(value: boolean): void {
    if (value === this.open) return;
    this.open = value;
    this.root.classList.toggle("open", this.open);
    if (this.open) {
      this.nav = ["root"];
      this.render();
      this.unmountNav = getMenuNavigator().mount(this.box, {
        dialog: true,
        onCancel: () => this.handleEscape(),
      });
      this.cb.onOpen();
    } else {
      this.unmountNav?.();
      this.unmountNav = null;
      this.cb.onClose();
    }
  }

  private get page(): PageId {
    return this.nav[this.nav.length - 1];
  }

  private goTo(page: PageId): void {
    this.nav.push(page);
    this.render("forward");
  }

  private back(): void {
    if (this.nav.length <= 1) return;
    const from = this.nav.pop()!;
    this.render("back", `goto-${from}`);
  }

  /**
   * Dibuja la página superior. `focusKey` intenta devolver el foco al control
   * con ese `data-pause-key`; si no existe, va al primero.
   */
  private render(dir?: "forward" | "back", focusKey?: string): void {
    const page = this.page;
    this.titleEl.textContent = PAGE_TITLE[page];
    this.backBtn.hidden = page === "root";
    this.box.dataset.page = page;

    const content = document.createElement("div");
    content.className = "kb-pause__page";
    if (dir) content.dataset.enter = dir;

    switch (page) {
      case "options":
        this.fillOptions(content);
        break;
      case "keys":
        this.fillKeys(content);
        break;
      case "keysP1":
        this.fillKeyBindings(content, "p1");
        break;
      case "keysP2":
        this.fillKeyBindings(content, "p2");
        break;
      case "dummy":
        this.fillDummy(content);
        break;
      case "character":
        this.fillCharacter(content);
        break;
      case "quit":
        this.fillQuit(content);
        break;
      case "root":
      default:
        this.fillRoot(content);
        break;
    }
    this.body.replaceChildren(content);
    if (this.open) this.restoreFocus(focusKey);
  }

  /** Vuelve a dibujar la página actual conservando el foco en `focusKey`. */
  private rerender(focusKey?: string): void {
    this.render(undefined, focusKey);
  }

  private restoreFocus(focusKey?: string): void {
    const byKey = focusKey
      ? this.box.querySelector<HTMLElement>(`[${KEY_ATTR}="${focusKey}"]`)
      : null;
    const target =
      byKey ??
      this.body.querySelector<HTMLElement>(
        'button:not([disabled]):not([hidden]), input:not([disabled]), [data-kb-focusable]',
      );
    target?.focus();
  }

  // ── Páginas ────────────────────────────────────────────────────────────────

  private fillRoot(el: HTMLElement): void {
    const list = document.createElement("div");
    list.className = "kb-pause__list";
    list.appendChild(
      keyHint(this.menuButton("Continuar", () => this.setOpen(false), "primary", "continue"), "escape", {
        hotkey: false,
      }),
    );
    list.appendChild(this.menuButton("Opciones", () => this.goTo("options"), "secondary", "goto-options"));
    // El Dummy solo tiene sentido en entrenamiento.
    if (this.cb.mode === "training") {
      if (this.cb.onChangeCharacter) {
        list.appendChild(
          this.menuButton("Cambiar personaje", () => this.goTo("character"), "secondary", "goto-character"),
        );
      }
      list.appendChild(this.menuButton("Dummy", () => this.goTo("dummy"), "secondary", "goto-dummy"));
    }
    list.appendChild(this.menuButton("Salir al menú", () => this.goTo("quit"), "danger", "goto-quit"));
    el.appendChild(list);
  }

  private fillOptions(el: HTMLElement): void {
    const panel = document.createElement("div");
    panel.className = "kb-pause__tabpanel";
    panel.setAttribute("role", "tabpanel");

    const bar = tabs({
      tabs: OPTION_TABS,
      selected: this.optionsTab,
      onChange: (id) => {
        this.optionsTab = id as OptionsTab;
        this.fillTab(panel);
      },
    });
    bar.classList.add("kb-pause__tabs");
    bar.setAttribute("aria-label", "Categorías de opciones");
    el.append(bar, panel);
    this.fillTab(panel);
  }

  private fillTab(panel: HTMLElement): void {
    panel.replaceChildren();
    panel.dataset.tab = this.optionsTab;
    switch (this.optionsTab) {
      case "graphics":
        this.fillGraphics(panel);
        break;
      case "accessibility":
        this.fillAccessibility(panel);
        break;
      case "controls":
        this.fillControls(panel);
        break;
      case "audio":
        this.fillAudio(panel);
        break;
      case "debug":
        this.fillDebug(panel);
        break;
    }
  }

  /** Gráficos: preset, un selector por Control_Gráfico y escala de resolución. */
  private fillGraphics(el: HTMLElement): void {
    const qm = getQualityManager();
    const prefs = qm.getPreferences();

    el.appendChild(this.category("Preset de calidad"));
    const presetRow = document.createElement("div");
    presetRow.className = "kb-pause__presets";
    presetRow.setAttribute("role", "radiogroup");
    presetRow.setAttribute("aria-label", "Preset de calidad");

    const presetBtns = new Map<PresetId, HTMLButtonElement>();
    for (const id of PRESET_IDS) {
      const b = button({
        label: PRESET_NAMES[id],
        variant: "secondary",
        onActivate: () => {
          qm.selectPreset(id);
          // Los selectores cambian todos: se redibuja la pestaña.
          const panel = el;
          this.fillTab(panel);
          panel.querySelector<HTMLElement>(`[${KEY_ATTR}="preset-${id}"]`)?.focus();
        },
      });
      b.setAttribute("role", "radio");
      b.setAttribute(KEY_ATTR, `preset-${id}`);
      presetBtns.set(id, b);
      presetRow.appendChild(b);
    }

    // "Personalizado": etiqueta no seleccionable (R6.5).
    const custom = document.createElement("span");
    custom.className = "kb-pause__custom";
    custom.setAttribute("aria-live", "polite");
    custom.textContent = "Personalizado";
    presetRow.appendChild(custom);
    el.appendChild(presetRow);

    const syncPreset = (): void => {
      const label = qm.getPreferences().preset;
      for (const [id, b] of presetBtns) {
        const sel = label === id;
        b.setAttribute("aria-checked", sel ? "true" : "false");
        b.classList.toggle("kb-btn--primary", sel);
        b.classList.toggle("kb-btn--secondary", !sel);
      }
      custom.hidden = label !== "personalizado";
    };
    syncPreset();

    el.appendChild(this.category("Efectos"));
    for (const k of LEVEL_CONTROL_KEYS) {
      const ctl = levelSelect({
        label: CONTROL_LABELS[k],
        value: prefs.controls[k],
        onChange: (v) => {
          qm.setControl(k, v);
          syncPreset();
        },
      });
      ctl.classList.add("kb-pause__level");
      ctl.dataset.control = k;
      el.appendChild(ctl);
    }

    const scale = slider({
      label: CONTROL_LABELS.renderScale,
      min: RENDER_SCALES[0],
      max: RENDER_SCALES[RENDER_SCALES.length - 1],
      step: 5,
      value: prefs.controls.renderScale,
      format: (v) => `${v}%`,
      onChange: (v) => {
        qm.setControl("renderScale", v as RenderScale);
        syncPreset();
      },
    });
    scale.dataset.control = "renderScale";
    el.appendChild(scale);

    // --- Vista e interfaz (antes en "Ajustes") ---
    el.appendChild(this.category("Vista"));
    el.appendChild(this.buildPovSlider());
    el.appendChild(
      this.buildToggle({
        key: "showGameUi",
        label: "Mostrar UI del juego",
        hint: "Oculta el HUD de porcentajes, vidas y cronómetro para ver el gameplay limpio.",
      }),
    );
  }

  /** Accesibilidad: Movimiento_Reducido (R9.1, R9.5). */
  private fillAccessibility(el: HTMLElement): void {
    const qm = getQualityManager();
    const field = document.createElement("div");
    field.className = "kb-pause__field";
    field.appendChild(
      toggle({
        label: "Movimiento reducido",
        checked: qm.getPreferences().reducedMotion,
        onChange: (v) => qm.setReducedMotion(v),
      }),
    );
    field.appendChild(
      this.hint(
        "Desactiva la vibración de cámara, las líneas de velocidad y los destellos de lente de impacto, limita los destellos a pantalla completa y sustituye las animaciones de menú por fundidos.",
      ),
    );
    el.appendChild(field);
  }

  /** Controles: resumen de P1 en vivo + acceso a la reasignación. */
  private fillControls(el: HTMLElement): void {
    const list = document.createElement("dl");
    list.className = "kb-pause__controls";
    const rows: Array<[string, string]> = ACTION_LABELS.map(({ action, label }) => [
      label,
      bindings.p1[action].map(keyLabel).join(" / "),
    ]);
    rows.push(["Pausa", "Esc"]);
    for (const [action, keys] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = action;
      const dd = document.createElement("dd");
      dd.textContent = keys;
      list.append(dt, dd);
    }
    el.appendChild(list);
    el.appendChild(this.menuButton("Cambiar teclas", () => this.goTo("keys"), "secondary", "goto-keys"));
  }

  /** Audio: el juego aún no tiene controles de audio que migrar. */
  private fillAudio(el: HTMLElement): void {
    el.appendChild(this.hint("No hay ajustes de audio disponibles por ahora."));
  }

  private fillDebug(el: HTMLElement): void {
    el.appendChild(this.category("Depuración · Visuales"));
    for (const def of DEBUG_VISUAL_TOGGLES) el.appendChild(this.buildToggle(def));
    el.appendChild(this.category("Depuración · Información"));
    for (const def of DEBUG_INFO_TOGGLES) el.appendChild(this.buildToggle(def));
  }

  /** Elección de qué jugador remapear. */
  private fillKeys(el: HTMLElement): void {
    const list = document.createElement("div");
    list.className = "kb-pause__list";
    list.appendChild(this.menuButton("Jugador 1", () => this.goTo("keysP1"), "secondary", "goto-keysP1"));
    list.appendChild(this.menuButton("Jugador 2", () => this.goTo("keysP2"), "secondary", "goto-keysP2"));
    el.appendChild(list);
  }

  /** Lista de acciones con su tecla; activar una abre "Pulsa una tecla". */
  private fillKeyBindings(el: HTMLElement, slot: PlayerSlot): void {
    for (const { action, label } of ACTION_LABELS) {
      const row = document.createElement("div");
      row.className = "kb-pause__keyrow";

      const name = document.createElement("span");
      name.className = "kb-pause__label";
      name.textContent = label;
      row.appendChild(name);

      const keyBtn = button({
        label: keyLabel(bindings[slot][action][0] ?? "—"),
        variant: "secondary",
        onActivate: () => this.captureKey(slot, action, label, keyBtn),
      });
      keyBtn.classList.add("kb-pause__key");
      keyBtn.setAttribute(KEY_ATTR, `key-${slot}-${action}`);
      keyBtn.setAttribute("aria-label", `${label}: ${keyBtn.textContent ?? ""}`);
      row.appendChild(keyBtn);
      el.appendChild(row);
    }

    const reset = this.menuButton(
      "Restaurar por defecto",
      () => {
        resetBindings(slot);
        this.rerender(`reset-${slot}`);
      },
      "danger",
      `reset-${slot}`,
    );
    reset.classList.add("kb-pause__spaced");
    el.appendChild(reset);
  }

  /**
   * Diálogo obligatorio "Pulsa una tecla": la próxima tecla se asigna a la
   * acción (misma persistencia que antes, vía `rebind`). Escape cancela.
   */
  private captureKey(
    slot: PlayerSlot,
    action: (typeof ACTION_LABELS)[number]["action"],
    label: string,
    btn: HTMLButtonElement,
  ): void {
    if (this.capturing) return;
    this.capturing = true;

    const text = document.createElement("p");
    text.className = "kb-pause__capture-text";
    text.textContent = `Pulsa la nueva tecla para «${label}». Escape cancela.`;

    let unmount: (() => void) | null = null;
    const finish = (): void => {
      window.removeEventListener("keydown", onDown, true);
      this.capturing = false;
      unmount?.();
      unmount = null;
      d.close();
      const keyText = keyLabel(bindings[slot][action][0] ?? "—");
      const lbl = btn.querySelector(".kb-btn__label");
      if (lbl) lbl.textContent = keyText;
      btn.setAttribute("aria-label", `${label}: ${keyText}`);
      if (btn.isConnected) btn.focus();
    };

    const cancel = button({ label: "Cancelar", variant: "ghost", onActivate: () => finish() });
    const d = dialog({ title: "Pulsa una tecla", body: [text], actions: [cancel], mandatory: true });
    d.el.classList.add("kb-pause__capture");

    const onDown = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key.toLowerCase();
      if (key !== "escape") rebind(slot, action, key);
      finish();
    };

    d.open();
    unmount = getMenuNavigator().mount(d.el, { dialog: true, mandatory: true, returnFocus: btn });
    // Fase de captura: nos adelantamos al Navegador_Menús y al onKey del menú.
    window.addEventListener("keydown", onDown, true);
  }

  /** Confirmación para abandonar la partida y volver al menú principal. */
  private fillQuit(el: HTMLElement): void {
    const warn = document.createElement("p");
    warn.className = "kb-pause__warn";
    warn.textContent = "Si sales ahora perderás el progreso de esta partida. ¿Seguro?";
    el.appendChild(warn);

    const list = document.createElement("div");
    list.className = "kb-pause__list";
    list.appendChild(this.menuButton("Cancelar", () => this.back(), "secondary", "quit-cancel"));
    list.appendChild(
      this.menuButton(
        "Sí, salir al menú",
        () => {
          this.setOpen(false);
          this.cb.onQuitToMenu();
        },
        "danger",
        "quit-confirm",
      ),
    );
    el.appendChild(list);
  }

  /**
   * Página de personaje (entrenamiento): parrilla de los 12 y la lista de
   * movimientos del personaje actual. Elegir uno reinicia el entrenamiento.
   */
  private fillCharacter(el: HTMLElement): void {
    const current = this.cb.currentCharacter;
    el.appendChild(this.category("Personaje"));
    const grid = document.createElement("div");
    grid.className = "kb-pause__chars";
    for (const id of SELECTABLE_CHARACTERS) {
      const lore = characterLore(id);
      const sel = id === current;
      const b = button({
        label: lore.crossover ? `${lore.name} ★` : lore.name,
        variant: sel ? "primary" : "secondary",
        onActivate: () => {
          if (sel) return;
          this.setOpen(false);
          this.cb.onChangeCharacter?.(id);
        },
      });
      b.style.setProperty("--c", CHARACTERS[id].color);
      b.classList.add("kb-pause__char");
      b.setAttribute(KEY_ATTR, `char-${id}`);
      b.setAttribute("aria-pressed", sel ? "true" : "false");
      if (lore.crossover) b.title = `Invitado de ${lore.crossover}`;
      grid.appendChild(b);
    }
    el.appendChild(grid);
    el.appendChild(this.hint("★ = personaje invitado (crossover). Al elegir otro se reinicia el entrenamiento."));

    if (!current) return;
    const moves = getMoveset(current);
    el.appendChild(this.category(`Movimientos de ${characterLore(current).name}`));
    const table = document.createElement("div");
    table.className = "kb-pause__moves";
    const dirs: Array<{ dir: AttackDir; label: string }> = [
      { dir: "neutral", label: "Neutral" },
      { dir: "side", label: "Lateral" },
      { dir: "up", label: "Arriba" },
      { dir: "down", label: "Abajo" },
    ];
    const head = document.createElement("div");
    head.className = "kb-pause__moves-row kb-pause__moves-head";
    for (const t of ["", "Ligero", "Fuerte"]) {
      const c = document.createElement("span");
      c.textContent = t;
      head.appendChild(c);
    }
    table.appendChild(head);
    for (const d of dirs) {
      const row = document.createElement("div");
      row.className = "kb-pause__moves-row";
      const label = document.createElement("span");
      label.textContent = d.label;
      row.appendChild(label);
      for (const def of [moves.light[d.dir], moves.heavy[d.dir]]) {
        const c = document.createElement("span");
        // Daño mostrado: el del proyectil si dispara; total si es multigolpe.
        const hits = def.multiHit?.hits ?? 1;
        const dmg = def.projectile ? def.projectile.damage : def.damage * hits;
        const tags: string[] = [];
        if (def.projectile) tags.push("🎯");
        if (hits > 1) tags.push(`×${hits}`);
        if (def.armor) tags.push("🛡");
        if (def.intangible) tags.push("👻");
        if (def.reflect) tags.push("↩");
        const tagText = tags.length ? ` ${tags.join(" ")}` : "";
        c.textContent = `${def.name ?? "—"} · ${Math.round(dmg)}%${tagText}`;
        if (tags.length) {
          c.title = [
            def.projectile && "Proyectil",
            hits > 1 && `${hits} golpes`,
            def.armor && "Armadura (no te interrumpen)",
            def.intangible && "Intangible",
            def.reflect && "Refleja proyectiles",
          ]
            .filter(Boolean)
            .join(" · ");
        }
        row.appendChild(c);
      }
      table.appendChild(row);
    }
    el.appendChild(table);
  }

  /** Página del dummy: comportamiento + ataques en bucle. */
  private fillDummy(el: HTMLElement): void {
    el.appendChild(this.category("Comportamiento"));

    const behaviors: Array<{ value: DummyBehavior; label: string; hint: string }> = [
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
    const group = document.createElement("div");
    group.className = "kb-pause__radios";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Comportamiento del dummy");
    for (const b of behaviors) {
      const sel = trainingOptions.dummyBehavior === b.value;
      const field = document.createElement("div");
      field.className = "kb-pause__field";
      const btn = button({
        label: b.label,
        variant: sel ? "primary" : "secondary",
        onActivate: () => {
          trainingOptions.dummyBehavior = b.value;
          this.rerender(`dummy-${b.value}`);
        },
      });
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", sel ? "true" : "false");
      btn.setAttribute(KEY_ATTR, `dummy-${b.value}`);
      field.append(btn, this.hint(b.hint));
      group.appendChild(field);
    }
    el.appendChild(group);

    el.appendChild(this.category("Hacer que el dummy ataque"));
    el.appendChild(
      this.hint(
        "Elige un ataque y el dummy lo repetirá en bucle. El ligero deja una pausa entre golpes; el fuerte sale siempre a carga completa.",
      ),
    );
    el.appendChild(this.buildAttackRow("Ataque ligero", "light"));
    el.appendChild(this.buildAttackRow("Ataque fuerte", "heavy"));

    const stop = this.menuButton(
      "Parar ataques",
      () => {
        trainingOptions.dummyAttack = null;
        this.rerender("dummy-stop");
      },
      "danger",
      "dummy-stop",
    );
    stop.classList.add("kb-pause__spaced");
    el.appendChild(stop);
  }

  /**
   * Fila con un ataque y 4 direcciones. Activar una dirección la selecciona
   * para que el dummy la repita; volver a activarla la desactiva.
   */
  private buildAttackRow(label: string, kind: "light" | "heavy"): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "kb-pause__attackrow";

    const name = document.createElement("span");
    name.className = "kb-pause__label";
    name.textContent = label;
    wrap.appendChild(name);

    const dirs: Array<{ dir: "neutral" | "side" | "up" | "down"; glyph: string; name: string }> = [
      { dir: "neutral", glyph: "●", name: "neutral" },
      { dir: "side", glyph: "→", name: "lateral" },
      { dir: "up", glyph: "↑", name: "arriba" },
      { dir: "down", glyph: "↓", name: "abajo" },
    ];

    const btns = document.createElement("div");
    btns.className = "kb-pause__dirbtns";
    for (const d of dirs) {
      const active =
        trainingOptions.dummyAttack?.kind === kind && trainingOptions.dummyAttack?.dir === d.dir;
      const key = `atk-${kind}-${d.dir}`;
      const b = button({
        label: d.glyph,
        variant: active ? "primary" : "secondary",
        onActivate: () => {
          const current = trainingOptions.dummyAttack;
          const isSame = current?.kind === kind && current?.dir === d.dir;
          trainingOptions.dummyAttack = isSame ? null : { kind, dir: d.dir };
          this.rerender(key);
        },
      });
      b.classList.add("kb-pause__dirbtn");
      b.title = d.dir;
      b.setAttribute("aria-label", `${label} ${d.name}`);
      b.setAttribute("aria-pressed", active ? "true" : "false");
      b.setAttribute(KEY_ATTR, key);
      btns.appendChild(b);
    }
    wrap.appendChild(btns);
    return wrap;
  }

  // ── Piezas ─────────────────────────────────────────────────────────────────

  private buildPovSlider(): HTMLElement {
    const field = document.createElement("div");
    field.className = "kb-pause__field";
    field.appendChild(
      slider({
        label: "POV (zoom de la partida)",
        min: POV.min,
        max: POV.max,
        step: POV.step,
        value: debug.povZoom,
        format: (v) => `${Math.round(v * 100)}%`,
        onChange: (v) => {
          debug.povZoom = v;
        },
      }),
    );
    field.appendChild(
      this.hint(
        "Menos % aleja la cámara (ves más campo); más % acerca. No afecta al juego, solo a tu vista.",
      ),
    );
    return field;
  }

  private buildToggle(def: ToggleDef): HTMLElement {
    const field = document.createElement("div");
    field.className = "kb-pause__field";
    field.appendChild(
      toggle({
        label: def.label,
        checked: debug[def.key] as boolean,
        onChange: (v) => {
          (debug[def.key] as boolean) = v;
        },
      }),
    );
    if (def.hint) field.appendChild(this.hint(def.hint));
    return field;
  }

  private category(title: string): HTMLElement {
    const h = document.createElement("h3");
    h.className = "kb-pause__subtitle";
    h.textContent = title;
    return h;
  }

  private hint(text: string): HTMLElement {
    const s = document.createElement("p");
    s.className = "kb-pause__hint";
    s.textContent = text;
    return s;
  }

  private menuButton(
    label: string,
    onClick: () => void,
    variant: "primary" | "secondary" | "danger",
    key: string,
  ): HTMLButtonElement {
    const b = button({ label, variant, onActivate: onClick });
    b.classList.add("kb-pause__btn");
    b.setAttribute(KEY_ATTR, key);
    return b;
  }
}
