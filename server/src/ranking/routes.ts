import { Hono } from "hono";
import { getSessionUserId } from "../auth/session.ts";
import { getRanking, isRankField, type RankOrder } from "../db/ranking.ts";

/**
 * Ranking (clasificación). La ordenación la hace el SERVIDOR; el cliente solo
 * pide `?sort=&order=&limit=`.
 *   GET /api/ranking?sort=wins&order=desc&limit=100
 */

export const rankingRoutes = new Hono();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

rankingRoutes.get("/", async (c) => {
  // Campo de orden (lista blanca); por defecto victorias.
  const sortParam = c.req.query("sort") ?? "wins";
  const sort = isRankField(sortParam) ? sortParam : "wins";

  // Orden asc/desc; por defecto desc (más arriba = mejor).
  const order: RankOrder = c.req.query("order") === "asc" ? "asc" : "desc";

  // Límite acotado.
  const limitParam = Number(c.req.query("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  // Posición del usuario logueado (si hay sesión).
  const myUserId = await getSessionUserId(c);

  const result = await getRanking(sort, order, limit, myUserId);

  return c.json({
    sort: result.sort,
    order: result.order,
    total: result.total,
    myRank: result.myRank,
    myUserId, // para que el cliente resalte "mi" fila
    rows: result.rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      nickname: r.nickname,
      avatarUrl: r.avatarUrl,
      wins: r.wins,
      kills: r.kills,
      deaths: r.deaths,
      coins: r.coins,
    })),
  });
});
