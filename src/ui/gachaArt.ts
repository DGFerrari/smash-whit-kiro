/**
 * Piezas compartidas por el Gacha y el Inventario: nombres y orden de las
 * rarezas, icono de gema (SVG) y el historial local de tiradas.
 *
 * El historial es SOLO informativo (lo que este navegador ha visto salir): el
 * inventario real lo guarda el servidor.
 */
import type { Pull, Rarity } from "../net/api.ts";

export const RARITY_ORDER: readonly Rarity[] = ["common", "epic", "legendary"];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Común",
  epic: "Épico",
  legendary: "Legendario",
};

export const RARITY_DESC: Record<Rarity, string> = {
  common: "Tokens básicos. Salen en casi todas las tiradas.",
  epic: "Tokens poco comunes con brillo propio.",
  legendary: "Los más raros: apenas 1 de cada 10 tiradas.",
};

/** Probabilidades públicas (las mismas que aplica el servidor). */
export const RARITY_ODDS: Record<Rarity, number> = { common: 70, epic: 20, legendary: 10 };

/** La rareza más alta de una tirada (decide el color del cofre al abrirse). */
export function bestRarity(pulls: readonly Pull[]): Rarity {
  let best = 0;
  for (const p of pulls) best = Math.max(best, RARITY_ORDER.indexOf(p.rarity));
  return RARITY_ORDER[best] ?? "common";
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Gema facetada del color de la rareza (`currentColor`): rombo para común,
 * corte brillante para épico y estrella-gema para legendario.
 */
export function gemIcon(rarity: Rarity, className = "kb-gem"): SVGSVGElement {
  const root = svg("svg", { viewBox: "0 0 48 48", class: `${className} ${className}--${rarity}`, "aria-hidden": "true" }) as SVGSVGElement;
  const body: Record<Rarity, string> = {
    common: "24 4 42 24 24 44 6 24",
    epic: "14 6 34 6 44 18 24 44 4 18",
    legendary: "24 2 30 16 46 18 34 28 38 44 24 36 10 44 14 28 2 18 18 16",
  };
  root.append(
    svg("polygon", { points: body[rarity], fill: "currentColor", stroke: "#0b0e1f", "stroke-width": "2.5", "stroke-linejoin": "round" }),
    // Facetas claras (brillo) y sombra inferior.
    svg("polygon", {
      points: rarity === "legendary" ? "24 8 28 18 24 30 20 18" : rarity === "epic" ? "14 6 24 18 34 6" : "24 4 33 24 24 24 15 24",
      fill: "#ffffff",
      opacity: "0.45",
    }),
    svg("polygon", {
      points: rarity === "legendary" ? "24 36 34 28 38 44" : rarity === "epic" ? "4 18 24 44 24 18" : "6 24 24 44 24 24",
      fill: "#0b0e1f",
      opacity: "0.22",
    }),
  );
  return root;
}

// ── Historial local de tiradas ───────────────────────────────────────────────

export interface PullSession {
  /** Marca de tiempo (ms). */
  at: number;
  cost: number;
  pulls: Pull[];
}

const HISTORY_KEY = "kb.gacha.history.v1";
const HISTORY_MAX = 40;

/** Respaldo en memoria si localStorage no está disponible (modo privado, tests). */
const memory = new Map<string, string>();
const memoryStore = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
};

function store(): Pick<Storage, "getItem" | "setItem"> {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage?.getItem === "function") return localStorage;
  } catch {
    /* acceso denegado */
  }
  return memoryStore;
}

/** Tiradas recientes, la más nueva primero. */
export function loadPullHistory(): PullSession[] {
  try {
    const raw = store()?.getItem(HISTORY_KEY);
    const list = raw ? (JSON.parse(raw) as PullSession[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordPullSession(session: PullSession): void {
  const list = [session, ...loadPullHistory()].slice(0, HISTORY_MAX);
  try {
    store()?.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* sin espacio: el historial es opcional */
  }
}
