/**
 * PUNTUACIÓN y RECOMPENSAS de una partida. Vive en el engine para que CLIENTE y
 * SERVIDOR calculen exactamente lo mismo:
 *  - el cliente lo usa para MOSTRAR (grado en el podio, monedas ganadas),
 *  - el servidor lo usa para OTORGAR monedas tras re-simular y validar el
 *    replay (es la autoridad; el cliente nunca fija las monedas).
 *
 * No depende de nada del navegador ni del render: solo aritmética sobre las
 * estadísticas de un combatiente.
 */

/** Estadísticas crudas de un combatiente al acabar la partida. */
export interface FighterScore {
  /** Daño infligido acumulado. */
  dealt: number;
  /** Daño recibido acumulado. */
  taken: number;
  /** Daño absorbido por el escudo. */
  blocked: number;
  /** KOs conseguidos. */
  kos: number;
  /** Muertes propias. */
  deaths: number;
}

/** Grado (calificación) del podio. */
export type Grade = "S" | "A" | "B" | "C" | "D";

/**
 * Nota global a partir de las stats (misma fórmula que usaba el podio). No es
 * ciencia, es "sabor": premia infligir daño y KOs, penaliza recibir y morir.
 */
export function gradeFor(s: FighterScore): Grade {
  const score = s.dealt + s.kos * 40 + s.blocked * 0.5 - s.taken * 0.6 - s.deaths * 25;
  if (score >= 220) return "S";
  if (score >= 150) return "A";
  if (score >= 90) return "B";
  if (score >= 40) return "C";
  return "D";
}

/** Monedas de bonus por grado. */
export const GRADE_COINS: Record<Grade, number> = {
  S: 100,
  A: 70,
  B: 40,
  C: 20,
  D: 0,
};

/** Reglas de monedas (ajustables en un solo sitio). */
export const COIN_RULES = {
  /** Por ganar la partida. */
  win: 100,
  /** Por cada KO infligido. */
  perKill: 15,
} as const;

/**
 * Monedas que gana un jugador en una partida, según si ganó, su grado y sus
 * KOs. Ejemplo: gana + grado A + 3 KOs = 100 + 70 + 45 = 215.
 */
export function coinsFor(score: FighterScore, won: boolean): number {
  let coins = 0;
  if (won) coins += COIN_RULES.win;
  coins += GRADE_COINS[gradeFor(score)];
  coins += score.kos * COIN_RULES.perKill;
  return coins;
}
