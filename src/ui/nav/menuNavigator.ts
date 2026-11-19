/**
 * Navegador_Menús (R4.1–R4.3, R4.6–R4.10).
 *
 * No es global: solo actúa mientras haya alguna raíz montada con `mount()`.
 * Las raíces forman una pila y la superior es la única que recibe teclado y
 * gamepad. Con la pila vacía (en partida) no intercepta ninguna tecla, así que
 * `src/core/input.ts` y las pantallas heredadas siguen funcionando igual.
 *
 * Convenciones de `components.ts`:
 *  - `isDisabled(el)` excluye controles deshabilitados del orden de foco.
 *  - `requestActivate(el)` traduce el botón A en `ACTIVATE_EVENT`.
 *  - `[data-kb-focusable]` marca controles no nativos enfocables.
 *  - `[data-focused]` lo pone este módulo en el único control enfocado (R4.4).
 *
 * Las partes puras (orden geométrico, vecino direccional, temporización de la
 * repetición, lectura del gamepad) se exportan por separado para probarlas.
 */

import { isDisabled, requestActivate } from "../design/components.ts";
import { normKey, PAD_INDEX, setInputDevice, type PadButton } from "./keyHints.ts";
import { ControlLegend, type LegendContext } from "./legend.ts";

// ── Partes puras ─────────────────────────────────────────────────────────────

export type Dir = "up" | "down" | "left" | "right";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FocusCandidate<T> {
  item: T;
  rect: Rect;
  visible: boolean;
  disabled: boolean;
}

/** Retardo inicial de repetición al mantener una dirección (R4.2: 300–500 ms). */
export const REPEAT_DELAY_MS = 400;
/** Intervalo entre repeticiones (R4.2: como máximo una cada 150 ms). */
export const REPEAT_INTERVAL_MS = 150;
/** Zona muerta del stick izquierdo. */
export const STICK_DEADZONE = 0.5;

function hasArea(r: Rect): boolean {
  return r.width > 0 || r.height > 0;
}

/** `true` si todos los rectángulos tienen tamaño (si no, se usa el orden DOM). */
export function geometryUsable(rects: readonly Rect[]): boolean {
  return rects.length > 0 && rects.every(hasArea);
}

/**
 * Orden de foco (R4.3): excluye ocultos y deshabilitados y ordena por fila
 * (de arriba abajo) y dentro de cada fila por columna (de izquierda a derecha).
 * Dos controles comparten fila si sus centros verticales distan menos de la
 * mitad de la altura del menor. Empates y geometría degenerada conservan el
 * orden de entrada (orden DOM).
 */
export function orderByGeometry<T>(cands: readonly FocusCandidate<T>[]): T[] {
  const live = cands.filter((c) => c.visible && !c.disabled);
  if (!geometryUsable(live.map((c) => c.rect))) return live.map((c) => c.item);

  const indexed = live.map((c, i) => ({ c, i, cy: c.rect.top + c.rect.height / 2 }));
  indexed.sort((a, b) => a.c.rect.top - b.c.rect.top || a.i - b.i);

  const rows: (typeof indexed)[] = [];
  for (const e of indexed) {
    const row = rows[rows.length - 1];
    if (row) {
      const ref = row[0];
      const tol = Math.max(1, Math.min(ref.c.rect.height, e.c.rect.height) / 2);
      if (Math.abs(e.cy - ref.cy) < tol) {
        row.push(e);
        continue;
      }
    }
    rows.push([e]);
  }
  const out: T[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.c.rect.left - b.c.rect.left || a.i - b.i);
    for (const e of row) out.push(e.c.item);
  }
  return out;
}

/** Índice cíclico: `(current + delta) mod n`; con `current < 0` empieza en 0 / n-1. */
export function cycleIndex(current: number, delta: number, n: number): number {
  if (n <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : n - 1;
  return (((current + delta) % n) + n) % n;
}

/**
 * Vecino más cercano en la dirección `dir` desde `rects[from]`, o -1 si no hay.
 * Puntuación = distancia en el eje principal + 2 × desviación en el eje
 * perpendicular (entre centros).
 */
export function pickDirectional(rects: readonly Rect[], from: number, dir: Dir): number {
  const o = rects[from];
  if (!o) return -1;
  const ox = o.left + o.width / 2;
  const oy = o.top + o.height / 2;
  let best = -1;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    if (i === from) return;
    const dx = r.left + r.width / 2 - ox;
    const dy = r.top + r.height / 2 - oy;
    let primary: number;
    let ortho: number;
    switch (dir) {
      case "down": primary = dy; ortho = Math.abs(dx); break;
      case "up": primary = -dy; ortho = Math.abs(dx); break;
      case "right": primary = dx; ortho = Math.abs(dy); break;
      case "left": primary = -dx; ortho = Math.abs(dy); break;
    }
    if (primary <= 0.5) return;
    const score = primary + 2 * ortho;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * Siguiente índice para una flecha/dirección. Usa la geometría si es válida;
 * si no hay vecino en esa dirección (o la geometría es degenerada) avanza de
 * forma cíclica en el orden de foco: abajo/derecha = +1, arriba/izquierda = -1.
 */
export function nextIndexForDir(rects: readonly Rect[], current: number, dir: Dir): number {
  const n = rects.length;
  if (n === 0) return -1;
  if (current >= 0 && geometryUsable(rects)) {
    const hit = pickDirectional(rects, current, dir);
    if (hit >= 0) return hit;
  }
  return cycleIndex(current, dir === "down" || dir === "right" ? 1 : -1, n);
}

export interface RepeatState {
  dir: Dir | null;
  nextAt: number;
}

export const REPEAT_IDLE: RepeatState = { dir: null, nextAt: 0 };

/**
 * Temporización de la repetición (R4.2): una nueva dirección dispara al
 * instante; mantenida, vuelve a disparar a los `REPEAT_DELAY_MS` y después cada
 * `REPEAT_INTERVAL_MS` como mínimo. Soltar reinicia.
 */
export function stepRepeat(
  s: RepeatState,
  dir: Dir | null,
  now: number,
): { state: RepeatState; fire: boolean } {
  if (dir === null) return { state: REPEAT_IDLE, fire: false };
  if (dir !== s.dir) return { state: { dir, nextAt: now + REPEAT_DELAY_MS }, fire: true };
  if (now >= s.nextAt) return { state: { dir, nextAt: now + REPEAT_INTERVAL_MS }, fire: true };
  return { state: s, fire: false };
}

export interface GamepadLike {
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes: readonly number[];
  readonly connected?: boolean;
}

export interface GamepadIntent {
  dir: Dir | null;
  a: boolean;
  b: boolean;
}

const BTN_A = 0;
const BTN_B = 1;
const BTN_UP = 12;
const BTN_DOWN = 13;
const BTN_LEFT = 14;
const BTN_RIGHT = 15;

/**
 * Lee el mapeo estándar: cruceta (12–15) con prioridad sobre el stick
 * izquierdo (ejes 0/1 con zona muerta; gana el eje dominante), A = 0, B = 1.
 * Con varios mandos se combinan (primera dirección encontrada; A/B en OR).
 */
export function readGamepadIntent(
  pads: readonly (GamepadLike | null | undefined)[],
  deadzone = STICK_DEADZONE,
): GamepadIntent {
  let dir: Dir | null = null;
  let a = false;
  let b = false;
  for (const p of pads) {
    if (!p || p.connected === false) continue;
    const pressed = (i: number) => p.buttons[i]?.pressed === true;
    a ||= pressed(BTN_A);
    b ||= pressed(BTN_B);
    if (dir) continue;
    if (pressed(BTN_UP)) dir = "up";
    else if (pressed(BTN_DOWN)) dir = "down";
    else if (pressed(BTN_LEFT)) dir = "left";
    else if (pressed(BTN_RIGHT)) dir = "right";
    else {
      const x = p.axes[0] ?? 0;
      const y = p.axes[1] ?? 0;
      const ax = Math.abs(x);
      const ay = Math.abs(y);
      if (Math.max(ax, ay) >= deadzone) {
        dir = ax > ay ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up";
      }
    }
  }
  return { dir, a, b };
}

// ── Navegador (DOM) ──────────────────────────────────────────────────────────

export interface MountOpts {
  /** Diálogo modal: trampa de foco cíclica (R4.6). */
  dialog?: boolean;
  /** Diálogo obligatorio: Escape/B no lo cierran (R4.10). */
  mandatory?: boolean;
  /** Control al que devolver el foco al desmontar (por defecto, el enfocado al montar). */
  returnFocus?: HTMLElement;
  /**
   * Cierre por Escape/B si el diálogo no lo gestiona por sí mismo. Los
   * `dialog()` de `components.ts` ya cierran con Escape y no lo necesitan.
   */
  onCancel?: () => void;
  /**
   * Atajos de teclado propios de la pantalla (tecla normalizada con
   * `normKey`, p. ej. "1", "r", "delete"). Tienen prioridad sobre los
   * `data-kb-hotkey` de los controles. No se aplican a Tab/Enter/Espacio/flechas.
   */
  hotkeys?: Record<string, () => void>;
  /** Atajos de botones de mando (X, Y, LB, RB, Start). */
  padHotkeys?: Partial<Record<PadButton, () => void>>;
}

/** Destino de la leyenda de controles (ver `legend.ts`). */
export interface LegendSink {
  update(ctx: LegendContext | null): void;
}

export interface MenuNavigator {
  mount(root: HTMLElement, opts?: MountOpts): () => void;
  pollGamepad(nowMs: number): void;
  /** Controles enfocables de la raíz superior, en orden de foco. */
  focusables(): HTMLElement[];
  /** `performance.now()` de la última tecla o entrada de mando (0 = ninguna). */
  lastInputAt(): number;
  /** Retira todos los montajes y oyentes (pruebas). */
  destroy(): void;
}

export interface NavigatorDeps {
  doc?: Document;
  getGamepads?: () => readonly (GamepadLike | null | undefined)[];
  /** Leyenda de controles a mantener al día con la raíz superior. */
  legend?: LegendSink;
  /** Actualiza `html[data-kb-input]` con el último dispositivo usado. */
  trackDevice?: boolean;
}

/** Teclas que nunca son atajos (navegación y activación). */
const RESERVED_KEYS = new Set(["tab", "enter", "space", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
/** Cada cuánto se refresca la leyenda desde el sondeo del mando. */
const LEGEND_REFRESH_MS = 200;

const FOCUSABLE_SELECTOR = [
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "a[href]",
  "[data-kb-focusable]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Margen para el foco inicial: se reintenta hasta 100 ms (R4.6, R4.9). */
const INITIAL_FOCUS_RETRIES = [0, 16, 33, 50, 66, 83];

interface Mounted {
  root: HTMLElement;
  opts: MountOpts;
  opener: HTMLElement | null;
  timers: ReturnType<typeof setTimeout>[];
}

function isVisible(el: HTMLElement, root: HTMLElement): boolean {
  if (el.closest("[hidden], [inert]")) return false;
  const view = el.ownerDocument.defaultView;
  if (!view) return true;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const cs = view.getComputedStyle(n);
    if (cs.display === "none") return false;
    if (n === el && (cs.visibility === "hidden" || cs.visibility === "collapse")) return false;
    if (n === root) break;
  }
  return true;
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file"].includes(el.type);
}

/** Teclas que el control enfocado necesita para sí mismo y no se interceptan. */
function ownsKey(el: Element, key: string): boolean {
  if (isTextEntry(el)) return key !== "Tab" && key !== "Escape" && key !== "ArrowUp" && key !== "ArrowDown";
  if (el instanceof HTMLInputElement && el.type === "range") return key === "ArrowLeft" || key === "ArrowRight";
  if (el instanceof HTMLSelectElement) return key === "ArrowUp" || key === "ArrowDown";
  return false;
}

const ARROWS: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function createMenuNavigator(deps: NavigatorDeps = {}): MenuNavigator {
  const doc = deps.doc ?? document;
  const getPads =
    deps.getGamepads ??
    (() => {
      const nav = doc.defaultView?.navigator;
      return nav && typeof nav.getGamepads === "function" ? nav.getGamepads() : [];
    });

  const stack: Mounted[] = [];
  let listening = false;
  let marked: HTMLElement | null = null;
  let repeat: RepeatState = REPEAT_IDLE;
  let prevA = false;
  let prevB = false;
  const prevPad: Partial<Record<PadButton, boolean>> = {};
  let legendAt = 0;
  let lastInput = 0;
  let observer: MutationObserver | null = null;
  const legend = deps.legend ?? null;

  const top = (): Mounted | undefined => stack[stack.length - 1];

  /** Controles con atajo usables (visibles y habilitados) de una raíz. */
  function hotkeyEls(m: Mounted): HTMLElement[] {
    return Array.from(m.root.querySelectorAll<HTMLElement>("[data-kb-hotkey]")).filter(
      (el) => !isDisabled(el) && isVisible(el, m.root),
    );
  }

  function findHotkey(m: Mounted, key: string): HTMLElement | null {
    return hotkeyEls(m).find((el) => (el.dataset.kbHotkey ?? "").split(" ").includes(key)) ?? null;
  }

  function findPadHotkey(m: Mounted, pad: PadButton): HTMLElement | null {
    return hotkeyEls(m).find((el) => el.dataset.kbPad === pad) ?? null;
  }

  /** Pinta la leyenda de la raíz superior (sin podar la pila). */
  function paintLegend(): void {
    if (!legend) return;
    const m = top();
    legend.update(
      m
        ? { root: m.root, dialog: m.opts.dialog === true, mandatory: m.opts.mandatory === true, hotkeys: hotkeyEls(m) }
        : null,
    );
  }

  function refreshLegend(): void {
    if (!legend) return;
    prune();
    paintLegend();
  }

  function device(d: "keyboard" | "pad"): void {
    if (deps.trackDevice) setInputDevice(d);
  }

  function focusablesIn(root: HTMLElement): HTMLElement[] {
    const els = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (root.matches(FOCUSABLE_SELECTOR)) els.unshift(root);
    return orderByGeometry(
      els.map((el) => ({
        item: el,
        rect: rectOf(el),
        visible: isVisible(el, root),
        disabled: isDisabled(el),
      })),
    );
  }

  function usable(el: HTMLElement | null, root: HTMLElement | null): el is HTMLElement {
    if (!el || !el.isConnected || isDisabled(el)) return false;
    if (root && !root.contains(el)) return false;
    return isVisible(el, root ?? doc.body);
  }

  function mark(el: HTMLElement | null): void {
    if (marked === el) return;
    marked?.removeAttribute("data-focused");
    marked = el;
    el?.setAttribute("data-focused", "");
  }

  function focusEl(el: HTMLElement): void {
    el.focus({ preventScroll: false });
    if (doc.activeElement === el) mark(el);
  }

  function focusFirst(m: Mounted): boolean {
    const first = focusablesIn(m.root)[0];
    if (!first) return false;
    focusEl(first);
    return doc.activeElement === first;
  }

  function current(m: Mounted): HTMLElement | null {
    const a = doc.activeElement;
    return a instanceof HTMLElement && m.root.contains(a) ? a : null;
  }

  function move(m: Mounted, how: Dir | 1 | -1): void {
    const list = focusablesIn(m.root);
    if (list.length === 0) return;
    const cur = current(m);
    const idx = cur ? list.indexOf(cur) : -1;
    const next =
      typeof how === "number"
        ? cycleIndex(idx, how, list.length)
        : nextIndexForDir(list.map(rectOf), idx, how);
    if (next >= 0) focusEl(list[next]);
  }

  function activate(el: HTMLElement): void {
    if (isDisabled(el)) return;
    // Los componentes del Sistema_Diseño escuchan ACTIVATE_EVENT; el resto, clic.
    if (el.matches('[class*="kb-"]')) requestActivate(el);
    else el.click();
  }

  function clearTimers(m: Mounted): void {
    for (const t of m.timers) clearTimeout(t);
    m.timers.length = 0;
  }

  /** Quita del montaje un elemento; si era el superior, devuelve el foco (R4.7, R4.8). */
  function remove(m: Mounted): void {
    const i = stack.indexOf(m);
    if (i < 0) return;
    const wasTop = i === stack.length - 1;
    stack.splice(i, 1);
    clearTimers(m);
    if (!stack.some((o) => o.root === m.root)) m.root.removeAttribute("data-kb-nav-root");
    if (marked && m.root.contains(marked)) mark(null);
    if (wasTop) {
      const below = top();
      const target = m.opts.returnFocus ?? m.opener;
      if (usable(target, below?.root ?? null)) focusEl(target);
      else if (below) focusFirst(below);
    }
    if (stack.length === 0) stopListening();
    paintLegend();
  }

  function prune(): void {
    for (const m of stack.slice()) if (!m.root.isConnected) remove(m);
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Los Escape sintéticos del botón B no cuentan como teclado.
    if (e.isTrusted) device("keyboard");
    lastInput = performance.now();
    prune();
    const m = top();
    if (!m || e.ctrlKey || e.altKey || e.metaKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && ownsKey(target, e.key)) return;

    const consume = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Atajos: primero los de la pantalla, luego los de sus controles. En los
    // diálogos, Escape/Retroceso siguen siendo del propio diálogo (onCancel).
    const k = normKey(e.key);
    if (!RESERVED_KEYS.has(k) && !e.defaultPrevented) {
      const fn = m.opts.hotkeys?.[k];
      if (fn) {
        consume();
        fn();
        refreshLegend();
        return;
      }
      const isBack = k === "escape" || k === "backspace";
      if (!(isBack && m.opts.dialog)) {
        const hk = findHotkey(m, k);
        if (hk) {
          consume();
          activate(hk);
          refreshLegend();
          return;
        }
      }
    }

    if (e.key === "Tab") {
      consume();
      move(m, e.shiftKey ? -1 : 1);
      return;
    }
    const dir = ARROWS[e.key];
    if (dir) {
      consume();
      move(m, dir);
      return;
    }
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      if (e.defaultPrevented) return; // Ya lo gestionó el componente.
      const cur = current(m);
      if (!cur) return;
      // Los nativos generan `click` por sí mismos.
      if (cur.matches("button, input, select, textarea, a[href], summary")) return;
      consume();
      activate(cur);
      return;
    }
    if (e.key === "Escape" && m.opts.dialog) {
      // Diálogos: Escape nunca llega a la partida ni a pantallas de debajo.
      e.stopPropagation();
      if (m.opts.mandatory) {
        e.preventDefault();
        return;
      }
      if (!e.defaultPrevented) {
        e.preventDefault();
        m.opts.onCancel?.();
      }
      prune();
    }
  }

  function onFocusIn(e: FocusEvent): void {
    const m = top();
    if (!m) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (t && m.root.contains(t)) {
      mark(t.matches(FOCUSABLE_SELECTOR) ? t : null);
      paintLegend();
      return;
    }
    // Trampa de foco (R4.6): el foco no puede salir de un diálogo.
    if (m.opts.dialog) focusFirst(m);
    else mark(null);
  }

  function startListening(): void {
    if (listening) return;
    listening = true;
    doc.addEventListener("keydown", onKeyDown);
    doc.addEventListener("focusin", onFocusIn);
    const MO = doc.defaultView?.MutationObserver;
    if (MO) {
      observer = new MO(() => prune());
      observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
    }
  }

  function stopListening(): void {
    if (!listening) return;
    listening = false;
    doc.removeEventListener("keydown", onKeyDown);
    doc.removeEventListener("focusin", onFocusIn);
    observer?.disconnect();
    observer = null;
    mark(null);
  }

  function scheduleInitialFocus(m: Mounted): void {
    const attempt = () => {
      if (top() !== m || !m.root.isConnected) return true;
      if (!m.opts.dialog && current(m)) return true; // Pantalla ya enfocada.
      return focusFirst(m);
    };
    if (attempt()) return;
    for (const delay of INITIAL_FOCUS_RETRIES.slice(1)) {
      const t = setTimeout(() => {
        if (attempt()) clearTimers(m);
      }, delay);
      m.timers.push(t);
    }
  }

  return {
    mount(root, opts = {}) {
      const active = doc.activeElement;
      const opener = active instanceof HTMLElement && !root.contains(active) && active !== doc.body ? active : null;
      const m: Mounted = { root, opts, opener, timers: [] };
      stack.push(m);
      // Marca para `core/input.ts`: las teclas sobre sus controles son del menú.
      root.setAttribute("data-kb-nav-root", "");
      startListening();
      scheduleInitialFocus(m);
      paintLegend();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        remove(m);
      };
    },

    pollGamepad(nowMs) {
      const intent = readGamepadIntent(getPads());
      const aEdge = intent.a && !prevA;
      const bEdge = intent.b && !prevB;
      prevA = intent.a;
      prevB = intent.b;
      const step = stepRepeat(repeat, intent.dir, nowMs);
      repeat = step.state;

      // Botones extra (X, Y, LB, RB, Start): flanco de subida.
      const pads = getPads();
      const padEdges: PadButton[] = [];
      let anyExtra = false;
      for (const [name, idx] of Object.entries(PAD_INDEX) as [PadButton, number][]) {
        const down = pads.some((p) => !!p && p.connected !== false && p.buttons[idx]?.pressed === true);
        if (down) anyExtra = true;
        if (down && !prevPad[name]) padEdges.push(name);
        prevPad[name] = down;
      }
      if (intent.dir || intent.a || intent.b || anyExtra) {
        device("pad");
        lastInput = performance.now();
      }

      // El estado se sigue aunque no haya raíz, para que un botón mantenido al
      // abrir un menú no lo active nada más montarse.
      prune();
      const m = top();
      if (legend && nowMs - legendAt >= LEGEND_REFRESH_MS) {
        legendAt = nowMs;
        paintLegend();
      }
      if (!m) return;

      for (const pad of padEdges) {
        const fn = m.opts.padHotkeys?.[pad];
        if (fn) {
          fn();
          continue;
        }
        const hk = findPadHotkey(m, pad);
        if (hk) activate(hk);
      }

      if (step.fire && intent.dir) move(m, intent.dir);
      if (aEdge) {
        const cur = current(m);
        if (cur) activate(cur);
        else focusFirst(m);
      }
      if (bEdge && !(m.opts.dialog && m.opts.mandatory)) {
        // B equivale a Escape: lo gestionan el diálogo o la pantalla (R4.10).
        const from = current(m) ?? m.root;
        from.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        prune();
      }
    },

    focusables() {
      const m = top();
      return m ? focusablesIn(m.root) : [];
    },

    lastInputAt() {
      return lastInput;
    },

    destroy() {
      for (const m of stack) {
        clearTimers(m);
        m.root.removeAttribute("data-kb-nav-root");
      }
      stack.length = 0;
      stopListening();
    },
  };
}

let singleton: MenuNavigator | null = null;

/** Navegador compartido por todas las pantallas (se crea al primer uso). */
export function getMenuNavigator(): MenuNavigator {
  singleton ??= createMenuNavigator({ legend: new ControlLegend(), trackDevice: true });
  return singleton;
}
