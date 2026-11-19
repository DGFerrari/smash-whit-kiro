/**
 * Atajos de teclado/mando y su representación visual ("keycaps").
 *
 *  - `keyHint(el, key, opts)` marca un control con un atajo
 *    (`data-kb-hotkey`) que el Navegador_Menús activa al pulsar la tecla
 *    mientras su pantalla esté arriba de la pila, y le añade la tecla dibujada.
 *  - `keycap(key, pad)` crea la tecla dibujada suelta (para la leyenda).
 *
 * Cada keycap lleva DOS textos, el de teclado y el de mando; el CSS muestra uno
 * u otro según `html[data-kb-input]`, que se actualiza con `setInputDevice()`
 * cuando el jugador usa un dispositivo distinto (sin redibujar nada).
 */

/** Botones de mando que pueden actuar como atajo (mapeo estándar). */
export type PadButton = "a" | "b" | "x" | "y" | "lb" | "rb" | "lbrb" | "start" | "dpad";

/** Índices del mapeo estándar de `Gamepad.buttons` para los atajos. */
export const PAD_INDEX: Record<Exclude<PadButton, "a" | "b" | "dpad" | "lbrb">, number> = {
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  start: 9,
};

export type InputDevice = "keyboard" | "pad";

/** Normaliza `KeyboardEvent.key` para comparar atajos ("Escape" → "escape", "R" → "r"). */
export function normKey(key: string): string {
  if (key === " " || key === "Spacebar") return "space";
  if (key === "Esc") return "escape";
  if (key === "Del") return "delete";
  return key.toLowerCase();
}

const KEY_LABELS: Record<string, string> = {
  escape: "Esc",
  enter: "Enter",
  space: "Espacio",
  tab: "Tab",
  backspace: "⌫",
  delete: "Supr",
  arrows: "↑↓←→",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pageup: "RePág",
  pagedown: "AvPág",
};

/** Texto de una tecla para mostrar ("escape" → "Esc", "r" → "R"). */
export function keyLabel(key: string): string {
  const k = normKey(key);
  return KEY_LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : key);
}

const PAD_LABELS: Record<PadButton, string> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  lb: "LB",
  rb: "RB",
  lbrb: "LB/RB",
  start: "Start",
  dpad: "✚",
};

export function padLabel(pad: PadButton): string {
  return PAD_LABELS[pad];
}

/** Dispositivo usado por última vez (para elegir qué glifos se ven). */
let device: InputDevice = "keyboard";

export function getInputDevice(): InputDevice {
  return device;
}

export function setInputDevice(d: InputDevice): void {
  if (d === device && document.documentElement.dataset.kbInput === d) return;
  device = d;
  document.documentElement.dataset.kbInput = d;
}

/**
 * Tecla dibujada. Sin `pad`, en modo mando se muestra la misma tecla de
 * teclado atenuada (no hay equivalente).
 */
export function keycap(key: string, pad?: PadButton): HTMLElement {
  const cap = document.createElement("kbd");
  cap.className = "kb-keycap";
  cap.setAttribute("aria-hidden", "true");
  // El texto va en `data-glyph` y lo pinta el CSS (::before): así no se mezcla
  // con el `textContent` del botón que lo contiene.
  const k = document.createElement("span");
  k.className = "kb-keycap__key";
  k.dataset.glyph = keyLabel(key);
  cap.appendChild(k);
  if (pad) {
    const p = document.createElement("span");
    p.className = `kb-keycap__pad kb-keycap__pad--${pad}`;
    p.dataset.glyph = padLabel(pad);
    cap.appendChild(p);
  } else {
    cap.classList.add("kb-keycap--keyonly");
  }
  return cap;
}

export interface KeyHintOpts {
  /** Botón de mando equivalente (Escape → B automáticamente). */
  pad?: PadButton;
  /** Texto en la leyenda (por defecto, el texto del control). */
  label?: string;
  /**
   * `true` (por defecto): el atajo activa el control. `false`: solo se dibuja
   * la tecla (p. ej. "Enter" en el botón principal, que ya es la acción por
   * defecto) y no aparece en la leyenda.
   */
  hotkey?: boolean;
  /** Teclas adicionales que también lo activan (no se dibujan). */
  alt?: string[];
}

/**
 * Añade a un control su tecla dibujada y, salvo `hotkey: false`, lo registra
 * como atajo (`data-kb-hotkey`) para el Navegador_Menús y la leyenda.
 */
export function keyHint<T extends HTMLElement>(el: T, key: string, opts: KeyHintOpts = {}): T {
  const k = normKey(key);
  const pad = opts.pad ?? (k === "escape" ? "b" : undefined);
  el.querySelector(":scope > .kb-keycap")?.remove();
  const cap = keycap(k, pad);
  cap.classList.add("kb-keycap--inline");
  el.appendChild(cap);
  el.classList.add("kb-has-keycap");
  if (opts.hotkey === false) return el;
  el.dataset.kbHotkey = [k, ...(opts.alt ?? []).map(normKey)].join(" ");
  if (pad) el.dataset.kbPad = pad;
  if (opts.label) el.dataset.kbHint = opts.label;
  return el;
}

/** Atajo de "volver": Escape (y Retroceso), B en el mando. */
export function backHint<T extends HTMLElement>(el: T, label = "Volver"): T {
  return keyHint(el, "escape", { label, alt: ["backspace"] });
}
