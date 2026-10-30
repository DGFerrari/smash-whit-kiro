import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "./client.ts";
import { users, playerStats } from "./schema.ts";

/**
 * RANKING (clasificación). La ordenación se hace en el SERVIDOR (SELECT ...
 * ORDER BY) para poder calcular la POSICIÓN real de cada jugador sobre toda la
 * BD y para que escale si crecen los datos.
 *
 * Los campos ordenables están en una LISTA BLANCA (abajo), así el parámetro
 * `sort` nunca llega crudo al SQL (evita inyección en el ORDER BY).
 */

/** Campos por los que se puede ordenar el ranking. */
export type RankField = "wins" | "kills" | "deaths" | "coins";
export type RankOrder = "asc" | "desc";

/** Columnas permitidas (lista blanca) -> columna Drizzle. */
const COLUMN = {
  wins: playerStats.wins,
  kills: playerStats.kills,
  deaths: playerStats.deaths,
  coins: playerStats.coins,
} as const;

export function isRankField(v: string): v is RankField {
  return v === "wins" || v === "kills" || v === "deaths" || v === "coins";
}

/** Una fila del ranking. */
export interface RankRow {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  wins: number;
  kills: number;
  deaths: number;
  coins: number;
}

/** Resultado del ranking: la lista top-N y (si aplica) la posición del usuario. */
export interface RankingResult {
  sort: RankField;
  order: RankOrder;
  rows: RankRow[];
  /** Total de jugadores con stats. */
  total: number;
  /** Posición 1-based del usuario logueado en este orden (o null si no aplica). */
  myRank: number | null;
}

/** Devuelve el top-N ordenado por `sort`/`order` y la posición del usuario. */
export async function getRanking(
  sort: RankField,
  order: RankOrder,
  limit: number,
  myUserId: string | null,
): Promise<RankingResult> {
  const col = COLUMN[sort];
  const dir = order === "asc" ? asc : desc;

  // Desempate estable y con sentido: tras el campo elegido, por más victorias,
  // luego más kills, luego el id (determinista). Si el propio campo es wins/
  // kills el desempate extra es inocuo.
  const rows = await db
    .select({
      userId: users.id,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
      wins: playerStats.wins,
      kills: playerStats.kills,
      deaths: playerStats.deaths,
      coins: playerStats.coins,
    })
    .from(playerStats)
    .innerJoin(users, eq(users.id, playerStats.userId))
    .orderBy(dir(col), desc(playerStats.wins), desc(playerStats.kills), asc(users.id))
    .limit(limit);

  const totalRes = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(playerStats);
  const total = totalRes[0]?.n ?? 0;

  let myRank: number | null = null;
  if (myUserId) {
    myRank = await computeRank(sort, order, myUserId);
  }

  return { sort, order, rows, total, myRank };
}

/**
 * Posición 1-based del usuario en el orden dado: cuenta cuántos jugadores van
 * "por delante" (mejor valor en el campo) y suma 1. null si el usuario no tiene
 * stats todavía.
 */
async function computeRank(
  sort: RankField,
  order: RankOrder,
  userId: string,
): Promise<number | null> {
  const col = COLUMN[sort];
  const mine = await db
    .select({ v: col })
    .from(playerStats)
    .where(eq(playerStats.userId, userId))
    .limit(1);
  if (!mine[0]) return null;
  const myValue = mine[0].v;

  // "Por delante" = valor estrictamente mejor según el orden.
  const aheadCond = order === "asc" ? lt(col, myValue) : gt(col, myValue);
  const aheadRes = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(playerStats)
    .where(and(aheadCond));
  const ahead = aheadRes[0]?.n ?? 0;
  return ahead + 1;
}
