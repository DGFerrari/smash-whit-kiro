/**
 * Sistema_Diseño: fábrica de componentes DOM (R2.5, R2.6, R2.7).
 *
 * Todos los estilos viven en `components.css` y solo consumen tokens de
 * `tokens.css`. Este módulo no inyecta estilos en línea con colores ni tamaños.
 *
 * Estados visuales:
 *  - reposo        → clases base `kb-*`
 *  - foco          → `:focus-visible` o `[data-focused]` (lo pone el Navegador_Menús)
 *  - presionado    → `:active` o `[data-pressed]` (lo gestiona este módulo)
 *  - deshabilitado → `[aria-disabled="true"]` (+ `disabled` nativo en botones/inputs)
 *
 * Activación: clic, Enter/Espacio y botón A del gamepad. El Navegador_Menús
 * traduce el botón A en `requestActivate(el)`, que emite `ACTIVATE_EVENT`.
 * Todas las vías pasan por `guard()`, que no hace nada si el control (o un
 * ancestro) está deshabilitado (R2.6).
 */

import { LEVELS, type Level } from "../../render/quality/visualPrefs.ts";

export interface BaseOpts {
  label: string;
  disabled?: boolean;
  id?: string;
}

/** Evento de activación por gamepad (botón A) que emite el Navegador_Menús. */
export const ACTIVATE_EVENT = "kb:activate";

export type ActivationSource = "pointer" | "keyboard" | "gamepad";

/**
 * Pide la activación de un control como si se hubiera pulsado el botón A.
 * Devuelve `false` si el control está deshabilitado y la petición se ignoró.
 */
export function requestActivate(el: HTMLElement): boolean {
  if (isDisabled(el)) return false;
  el.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { bubbles: false, detail: { source: "gamepad" } }));
  return true;
}

/** `true` si el control o algún ancestro está marcado como deshabilitado. */
export function isDisabled(el: Element): boolean {
  if (el.closest('[aria-disabled="true"]')) return true;
  return "disabled" in el && (el as HTMLButtonElement).disabled === true;
}

const NATIVE_DISABLEABLE = "button, input, select, textarea, fieldset";

/**
 * Activa/desactiva un componente: `aria-disabled` en la raíz, `disabled` nativo
 * en ella y en los controles internos, y saca del orden de tabulación los
 * elementos no nativos enfocables.
 */
export function setDisabled(el: HTMLElement, disabled: boolean): void {
  el.setAttribute("aria-disabled", disabled ? "true" : "false");
  const targets: Element[] = [];
  if (el.matches(NATIVE_DISABLEABLE)) targets.push(el);
  el.querySelectorAll(NATIVE_DISABLEABLE).forEach((c) => targets.push(c));
  for (const t of targets) (t as HTMLButtonElement).disabled = disabled;

  const focusables: HTMLElement[] = [];
  if (el.hasAttribute("data-kb-focusable")) focusables.push(el);
  el.querySelectorAll<HTMLElement>("[data-kb-focusable]").forEach((c) => focusables.push(c));
  for (const f of focusables) f.tabIndex = disabled ? -1 : 0;

  if (disabled) {
    el.removeAttribute("data-pressed");
    el.querySelectorAll("[data-pressed]").forEach((c) => c.removeAttribute("data-pressed"));
  }
}

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `kb-${prefix}-${uid}`;
}

/** Envuelve un manejador para que se ignore mientras el control esté deshabilitado. */
function guard<A extends unknown[]>(el: HTMLElement, fn: (...a: A) => void): (...a: A) => void {
  return (...a: A) => {
    if (isDisabled(el)) return;
    fn(...a);
  };
}

function isActivationKey(e: KeyboardEvent): boolean {
  return e.key === "Enter" || e.key === " " || e.key === "Spacebar";
}

/** Marca `[data-pressed]` mientras se mantiene puntero o tecla de activación. */
function wirePressed(el: HTMLElement): void {
  const on = () => {
    if (!isDisabled(el)) el.setAttribute("data-pressed", "");
  };
  const off = () => el.removeAttribute("data-pressed");
  el.addEventListener("pointerdown", on);
  el.addEventListener("pointerup", off);
  el.addEventListener("pointerleave", off);
  el.addEventListener("pointercancel", off);
  el.addEventListener("blur", off);
  el.addEventListener("keydown", (e) => {
    if (isActivationKey(e)) on();
  });
  el.addEventListener("keyup", (e) => {
    if (isActivationKey(e)) off();
  });
}

/**
 * Conecta clic + botón A (y, para elementos no nativos, Enter/Espacio) a una
 * única acción protegida por la guarda de deshabilitado.
 */
function wireActivation(el: HTMLElement, action: (source: ActivationSource) => void, native: boolean): void {
  const run = guard(el, action);
  el.addEventListener("click", (e) => {
    if (isDisabled(el)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    run(e.detail === 0 ? "keyboard" : "pointer");
  });
  el.addEventListener(ACTIVATE_EVENT, () => run("gamepad"));
  el.addEventListener("keydown", (e) => {
    if (!isActivationKey(e)) return;
    if (isDisabled(el)) {
      // Evita también el clic sintético del navegador en botones nativos.
      e.preventDefault();
      return;
    }
    if (native) return; // El navegador genera `click` en <button>.
    e.preventDefault();
    run("keyboard");
  });
  wirePressed(el);
}

function applyBase(el: HTMLElement, o: { id?: string; disabled?: boolean }): void {
  if (o.id) el.id = o.id;
  setDisabled(el, o.disabled === true);
}

function span(cls: string, text?: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  if (text !== undefined) s.textContent = text;
  return s;
}

// ── Botón ────────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function button(
  o: BaseOpts & { variant?: ButtonVariant; onActivate: () => void },
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `kb-btn kb-btn--${o.variant ?? "primary"}`;
  el.appendChild(span("kb-btn__label", o.label));
  wireActivation(el, () => o.onActivate(), true);
  applyBase(el, o);
  return el;
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function panel(o: { title?: string; children: Node[] }): HTMLElement {
  const el = document.createElement("section");
  el.className = "kb-panel";
  if (o.title) {
    const h = document.createElement("h2");
    h.className = "kb-panel__title";
    h.id = nextId("panel-title");
    h.textContent = o.title;
    el.setAttribute("aria-labelledby", h.id);
    el.appendChild(h);
  }
  const body = document.createElement("div");
  body.className = "kb-panel__body";
  for (const c of o.children) body.appendChild(c);
  el.appendChild(body);
  return el;
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────

export function card(
  o: BaseOpts & { media?: Node; subtitle?: string; onActivate?: () => void },
): HTMLElement {
  const interactive = typeof o.onActivate === "function";
  const el = document.createElement(interactive ? "div" : "article");
  el.className = "kb-card";
  if (o.media) {
    const m = document.createElement("div");
    m.className = "kb-card__media";
    m.appendChild(o.media);
    el.appendChild(m);
  }
  const body = document.createElement("div");
  body.className = "kb-card__body";
  body.appendChild(span("kb-card__title", o.label));
  if (o.subtitle) body.appendChild(span("kb-card__subtitle", o.subtitle));
  el.appendChild(body);

  if (interactive) {
    el.classList.add("kb-card--interactive");
    el.setAttribute("role", "button");
    el.setAttribute("data-kb-focusable", "");
    el.tabIndex = 0;
    const onActivate = o.onActivate!;
    wireActivation(el, () => onActivate(), false);
  }
  applyBase(el, o);
  return el;
}

// ── Pestañas ─────────────────────────────────────────────────────────────────

export function tabs(o: {
  tabs: { id: string; label: string }[];
  selected: string;
  onChange: (id: string) => void;
}): HTMLElement {
  const el = document.createElement("div");
  el.className = "kb-tabs";
  el.setAttribute("role", "tablist");
  const buttons: HTMLButtonElement[] = [];
  let current = o.selected;

  const sync = () => {
    for (const b of buttons) {
      const sel = b.dataset.tabId === current;
      b.setAttribute("aria-selected", sel ? "true" : "false");
      b.classList.toggle("kb-tab--selected", sel);
    }
  };

  for (const t of o.tabs) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kb-tab";
    b.setAttribute("role", "tab");
    b.dataset.tabId = t.id;
    b.appendChild(span("kb-tab__label", t.label));
    wireActivation(
      b,
      () => {
        if (current === t.id) return;
        current = t.id;
        sync();
        o.onChange(t.id);
      },
      true,
    );
    buttons.push(b);
    el.appendChild(b);
  }
  sync();
  return el;
}

// ── Interruptor ──────────────────────────────────────────────────────────────

export function toggle(
  o: BaseOpts & { checked: boolean; onChange: (v: boolean) => void },
): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "kb-toggle";
  el.setAttribute("role", "switch");
  let checked = o.checked;
  const sync = () => el.setAttribute("aria-checked", checked ? "true" : "false");

  el.appendChild(span("kb-toggle__label", o.label));
  const track = span("kb-toggle__track");
  track.setAttribute("aria-hidden", "true");
  track.appendChild(span("kb-toggle__thumb"));
  el.appendChild(track);

  wireActivation(
    el,
    () => {
      checked = !checked;
      sync();
      o.onChange(checked);
    },
    true,
  );
  sync();
  applyBase(el, o);
  return el;
}

// ── Deslizador ───────────────────────────────────────────────────────────────

export function slider(
  o: BaseOpts & {
    min: number;
    max: number;
    step: number;
    value: number;
    format?: (v: number) => string;
    onChange: (v: number) => void;
  },
): HTMLElement {
  const fmt = o.format ?? ((v: number) => String(v));
  const el = document.createElement("div");
  el.className = "kb-slider";

  const input = document.createElement("input");
  input.type = "range";
  input.className = "kb-slider__input";
  input.id = o.id ? `${o.id}-input` : nextId("slider");
  input.min = String(o.min);
  input.max = String(o.max);
  input.step = String(o.step);
  input.value = String(o.value);

  const label = document.createElement("label");
  label.className = "kb-slider__label";
  label.htmlFor = input.id;
  label.textContent = o.label;

  const out = document.createElement("output");
  out.className = "kb-slider__value";
  out.htmlFor.add(input.id);

  let last = Number(input.value);
  const sync = () => {
    const text = fmt(last);
    out.textContent = text;
    input.setAttribute("aria-valuetext", text);
    const pct = o.max > o.min ? ((last - o.min) / (o.max - o.min)) * 100 : 0;
    el.style.setProperty("--kb-slider-fill", `${pct}%`);
  };

  input.addEventListener("input", () => {
    if (isDisabled(el)) {
      input.value = String(last);
      return;
    }
    const v = Number(input.value);
    if (v === last) return;
    last = v;
    sync();
    o.onChange(v);
  });

  const head = document.createElement("div");
  head.className = "kb-slider__head";
  head.append(label, out);
  el.append(head, input);
  if (o.id) el.id = o.id;
  sync();
  setDisabled(el, o.disabled === true);
  return el;
}

// ── Selector de nivel (Control_Gráfico) ──────────────────────────────────────

const LEVEL_LABELS: Record<Level, string> = {
  desactivado: "Desactivado",
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
};

/** Control segmentado de 4 niveles (`desactivado`/`bajo`/`medio`/`alto`). */
export function levelSelect(
  o: BaseOpts & { value: Level; onChange: (v: Level) => void },
): HTMLElement {
  const el = document.createElement("div");
  el.className = "kb-level";

  const labelId = o.id ? `${o.id}-label` : nextId("level-label");
  const label = span("kb-level__label", o.label);
  label.id = labelId;

  const group = document.createElement("div");
  group.className = "kb-level__options";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-labelledby", labelId);

  let current = o.value;
  const opts: HTMLButtonElement[] = [];
  const sync = () => {
    for (const b of opts) {
      const sel = b.dataset.level === current;
      b.setAttribute("aria-checked", sel ? "true" : "false");
      b.classList.toggle("kb-level__opt--selected", sel);
    }
    el.dataset.level = current;
  };

  LEVELS.forEach((lv, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kb-level__opt";
    b.setAttribute("role", "radio");
    b.dataset.level = lv;
    b.dataset.index = String(i);
    b.appendChild(span("kb-level__opt-label", LEVEL_LABELS[lv]));
    wireActivation(
      b,
      () => {
        if (current === lv) return;
        current = lv;
        sync();
        o.onChange(lv);
      },
      true,
    );
    opts.push(b);
    group.appendChild(b);
  });

  el.append(label, group);
  sync();
  applyBase(el, o);
  return el;
}

// ── Diálogo ──────────────────────────────────────────────────────────────────

export function dialog(o: {
  title: string;
  body: Node[];
  actions: HTMLElement[];
  mandatory?: boolean;
  onClose?: () => void;
}): { el: HTMLElement; open(): void; close(): void } {
  const el = document.createElement("div");
  el.className = "kb-dialog-backdrop";
  el.hidden = true;

  const box = document.createElement("div");
  box.className = "kb-dialog";
  box.setAttribute("role", o.mandatory ? "alertdialog" : "dialog");
  box.setAttribute("aria-modal", "true");
  if (o.mandatory) box.dataset.mandatory = "";

  const title = document.createElement("h2");
  title.className = "kb-dialog__title";
  title.id = nextId("dialog-title");
  title.textContent = o.title;
  box.setAttribute("aria-labelledby", title.id);

  const body = document.createElement("div");
  body.className = "kb-dialog__body";
  for (const n of o.body) body.appendChild(n);

  const actions = document.createElement("div");
  actions.className = "kb-dialog__actions";
  for (const a of o.actions) actions.appendChild(a);

  box.append(title, body, actions);
  el.appendChild(box);

  let isOpen = false;
  const api = {
    el,
    open() {
      if (isOpen) return;
      isOpen = true;
      if (!el.isConnected) document.body.appendChild(el);
      el.hidden = false;
      el.dataset.open = "";
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      delete el.dataset.open;
      el.hidden = true;
      el.remove();
      o.onClose?.();
    },
  };

  // Escape cierra solo los diálogos no obligatorios (la tecla B la gestiona el
  // Navegador_Menús llamando a `close()`, que es idempotente).
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !o.mandatory) {
      e.preventDefault();
      api.close();
    }
  });

  return api;
}
