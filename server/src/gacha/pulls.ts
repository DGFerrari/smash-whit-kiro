/**
 * Lógica del GACHA (sorteo). Vive en el SERVIDOR: el azar y el premio se
 * deciden aquí, nunca en el cliente (si no, sería trivial hacer trampas). El
 * cliente solo pide "tira" y muestra el resultado que devuelve el servidor.
 *
 * Probabilidades (deben sumar 1): común 70%, épico 20%, legendario 10%.
 * Premio = tokens de la rareza obtenida, en un rango por rareza.
 */

export type Rarity = "common" | "epic" | "legendary";

interface RarityDef {
  /** Probabilidad [0..1]. */
  chance: number;
  /** Rango de tokens que da (ambos inclusive). */
  min: number;
  max: number;
}

export const RARITIES: Record<Rarity, RarityDef> = {
  common: { chance: 0.7, min: 10, max: 50 },
  epic: { chance: 0.2, min: 5, max: 15 },
  legendary: { chance: 0.1, min: 1, max: 5 },
};

/** Coste en monedas: 1 tirada = 100; 10 tiradas = 900 (10% de descuento). */
export const PULL_COST = 100;
export const MULTI_PULL_COUNT = 10;
export const MULTI_PULL_COST = Math.round(PULL_COST * MULTI_PULL_COUNT * 0.9); // 900

/** Resultado de una tirada: rareza obtenida y cuántos tokens de esa rareza. */
export interface PullResult {
  rarity: Rarity;
  tokens: number;
}

/** Entero aleatorio en [min, max] (ambos inclusive). */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Sortea una rareza según las probabilidades. */
function rollRarity(): Rarity {
  const r = Math.random();
  let acc = 0;
  for (const rarity of ["common", "epic", "legendary"] as Rarity[]) {
    acc += RARITIES[rarity].chance;
    if (r < acc) return rarity;
  }
  return "common"; // red de seguridad por errores de redondeo
}

/** Hace UNA tirada: sortea rareza y la cantidad de tokens de esa rareza. */
export function rollOne(): PullResult {
  const rarity = rollRarity();
  const def = RARITIES[rarity];
  return { rarity, tokens: randInt(def.min, def.max) };
}

/** Hace `count` tiradas independientes. */
export function rollMany(count: number): PullResult[] {
  const out: PullResult[] = [];
  for (let i = 0; i < count; i++) out.push(rollOne());
  return out;
}

/** Suma los tokens obtenidos por rareza (para actualizar el inventario). */
export function sumTokens(results: PullResult[]): Record<Rarity, number> {
  const totals: Record<Rarity, number> = { common: 0, epic: 0, legendary: 0 };
  for (const r of results) totals[r.rarity] += r.tokens;
  return totals;
}
