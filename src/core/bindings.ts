/**
 * Asignación de teclas configurable.
 *
 * Las acciones son abstractas (left, jump, shield...). Cada acción se mapea a
 * una o varias teclas (en minúsculas, tal y como las devuelve KeyboardEvent.key
 * tras toLowerCase, p. ej. "a", "arrowleft", " " para espacio).
 *
 * Importante del diseño pedido: "arriba" (up) sirve SOLO para apuntar el
 * ataque; ya NO salta. El salto tiene su propia acción con su propia tecla.
 *
 * Hay dos perfiles (P1 y P2) para el modo versus local. Se persisten en
 * localStorage para que el remapeo sobreviva a recargas.
 */

/** Acciones abstractas que un jugador puede realizar. */
export type Action =
  | "left"
  | "right"
  | "up"
  | "down"
  | "jump"
  | "light"
  | "heavy"
  | "shield";

/** Orden y etiqueta legible de las acciones (para la UI de remapeo). */
export const ACTION_LABELS: Array<{ action: Action; label: string }> = [
  { action: "left", label: "Izquierda" },
  { action: "right", label: "Derecha" },
  { action: "up", label: "Apuntar arriba" },
  { action: "down", label: "Apuntar abajo" },
  { action: "jump", label: "Saltar" },
  { action: "light", label: "Ataque ligero" },
  { action: "heavy", label: "Ataque fuerte" },
  { action: "shield", label: "Escudo / esquiva" },
];

/** Un perfil de controles: una lista de teclas por acción. */
export type KeyBindings = Record<Action, string[]>;

/** Identificador de jugador para elegir perfil de teclas. */
export type PlayerSlot = "p1" | "p2";

/**
 * Perfiles por defecto.
 * P1 (izquierda del teclado): WASD para apuntar/mover, con salto en Espacio,
 * ligero J, fuerte K, escudo L. Ojo: W es solo "apuntar arriba", NO salta.
 * P2 (derecha del teclado): flechas + teclas del pad numérico/alrededores.
 */
export const DEFAULT_BINDINGS: Record<PlayerSlot, KeyBindings> = {
  p1: {
    left: ["a"],
    right: ["d"],
    up: ["w"],
    down: ["s"],
    jump: [" "],
    light: ["j"],
    heavy: ["k"],
    shield: ["l"],
  },
  p2: {
    left: ["arrowleft"],
    right: ["arrowright"],
    up: ["arrowup"],
    down: ["arrowdown"],
    jump: ["enter"],
    light: ["1"],
    heavy: ["2"],
    shield: ["3"],
  },
};

const STORAGE_KEY = "smashb.bindings.v1";

/** Clona en profundidad un conjunto de perfiles. */
function clone(src: Record<PlayerSlot, KeyBindings>): Record<PlayerSlot, KeyBindings> {
  return {
    p1: cloneBindings(src.p1),
    p2: cloneBindings(src.p2),
  };
}

function cloneBindings(b: KeyBindings): KeyBindings {
  const out = {} as KeyBindings;
  for (const { action } of ACTION_LABELS) out[action] = [...b[action]];
  return out;
}

/**
 * Estado global de bindings. Mutable: la UI de remapeo lo edita y el
 * KeyboardInput lo lee en cada sample(), así el remapeo tiene efecto inmediato.
 */
export const bindings: Record<PlayerSlot, KeyBindings> = loadBindings();

function loadBindings(): Record<PlayerSlot, KeyBindings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<PlayerSlot, KeyBindings>;
      // Completamos acciones que falten (p. ej. tras añadir "shield").
      return {
        p1: mergeDefaults(parsed.p1, DEFAULT_BINDINGS.p1),
        p2: mergeDefaults(parsed.p2, DEFAULT_BINDINGS.p2),
      };
    }
  } catch {
    // Si localStorage falla o el JSON está corrupto, usamos los defaults.
  }
  return clone(DEFAULT_BINDINGS);
}

function mergeDefaults(
  saved: Partial<KeyBindings> | undefined,
  def: KeyBindings,
): KeyBindings {
  const out = {} as KeyBindings;
  for (const { action } of ACTION_LABELS) {
    const keys = saved?.[action];
    out[action] = Array.isArray(keys) && keys.length > 0 ? [...keys] : [...def[action]];
  }
  return out;
}

/** Persiste los bindings actuales. */
export function saveBindings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Silencioso: si no hay localStorage, los cambios viven solo en memoria.
  }
}

/** Reasigna una acción de un jugador a una sola tecla y persiste. */
export function rebind(slot: PlayerSlot, action: Action, key: string): void {
  bindings[slot][action] = [key.toLowerCase()];
  saveBindings();
}

/** Restaura los controles por defecto de un jugador. */
export function resetBindings(slot: PlayerSlot): void {
  bindings[slot] = cloneBindings(DEFAULT_BINDINGS[slot]);
  saveBindings();
}

/** Texto legible de una tecla para mostrar en la UI. */
export function keyLabel(key: string): string {
  switch (key) {
    case " ":
      return "Espacio";
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "enter":
      return "Enter";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}
