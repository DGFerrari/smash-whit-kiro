import { Hono } from "hono";
import type { ReplayData } from "../../../src/engine/game/replay.ts";
import { getSessionUserId } from "../auth/session.ts";
import { validateMatch, MatchValidationError } from "./validate.ts";
import { applyMatchRewards, getOrCreateStats } from "../db/stats.ts";

/**
 * Rutas de PARTIDA (puntuación):
 *  POST /api/match/submit  -> recibe un replay, lo RE-SIMULA para validar el
 *                             resultado y otorga monedas/stats al usuario.
 *  GET  /api/match/stats   -> stats del usuario actual (monedas, wins, etc.).
 *
 * El cliente envía la partida, NO el resultado: el servidor es la autoridad.
 */

export const matchRoutes = new Hono();

// Enviar una partida terminada para puntuar.
matchRoutes.post("/submit", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Debes iniciar sesión para que la partida puntúe." }, 401);
  }

  let data: ReplayData;
  try {
    data = (await c.req.json()) as ReplayData;
  } catch {
    return c.json({ error: "Cuerpo de la petición no es JSON válido." }, 400);
  }

  let result;
  try {
    result = validateMatch(data);
  } catch (err) {
    if (err instanceof MatchValidationError) {
      return c.json({ error: err.message }, 422);
    }
    console.error("Validación de partida falló:", err);
    return c.json({ error: "No se pudo validar la partida." }, 500);
  }

  const stats = await applyMatchRewards(userId, {
    coins: result.coins,
    won: result.won,
    kills: result.kills,
    deaths: result.deaths,
  });

  return c.json({
    result: {
      won: result.won,
      grade: result.grade,
      coinsEarned: result.coins,
      kills: result.kills,
      deaths: result.deaths,
    },
    stats: {
      coins: stats.coins,
      wins: stats.wins,
      kills: stats.kills,
      deaths: stats.deaths,
      matchesPlayed: stats.matchesPlayed,
    },
  });
});

// Stats del usuario actual.
matchRoutes.get("/stats", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ stats: null });
  const stats = await getOrCreateStats(userId);
  return c.json({
    stats: {
      coins: stats.coins,
      wins: stats.wins,
      kills: stats.kills,
      deaths: stats.deaths,
      matchesPlayed: stats.matchesPlayed,
    },
  });
});
