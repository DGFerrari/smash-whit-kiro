import { Hono } from "hono";
import { getSessionUserId } from "../auth/session.ts";
import { getOrCreateStats } from "../db/stats.ts";
import { getOrCreateTokens, chargeAndGrant, GachaError } from "../db/tokens.ts";
import {
  rollMany,
  sumTokens,
  PULL_COST,
  MULTI_PULL_COST,
  MULTI_PULL_COUNT,
} from "./pulls.ts";

/**
 * Gacha (tiradas):
 *   POST /api/gacha/pull?count=1|10  -> cobra monedas, sortea y da tokens.
 *   GET  /api/gacha/tokens           -> inventario de tokens del usuario.
 *
 * El azar y el premio los decide el SERVIDOR (ver gacha/pulls.ts). Todo el
 * cobro+premio es atómico (ver db/tokens.ts).
 */

export const gachaRoutes = new Hono();

// Precios e info del gacha (para que el cliente los muestre sin hardcodearlos).
gachaRoutes.get("/info", (c) =>
  c.json({
    singleCost: PULL_COST,
    multiCount: MULTI_PULL_COUNT,
    multiCost: MULTI_PULL_COST,
  }),
);

// Inventario de tokens.
gachaRoutes.get("/tokens", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ tokens: null });
  const t = await getOrCreateTokens(userId);
  return c.json({
    tokens: { common: t.common, epic: t.epic, legendary: t.legendary },
  });
});

// Tirar (1 o 10 veces).
gachaRoutes.post("/pull", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Debes iniciar sesión para tirar." }, 401);
  }

  const count = c.req.query("count") === "10" ? MULTI_PULL_COUNT : 1;
  const cost = count === MULTI_PULL_COUNT ? MULTI_PULL_COST : PULL_COST;

  // Aseguramos que existe la fila de stats (monedas) del usuario.
  await getOrCreateStats(userId);

  // Sorteo en el servidor.
  const results = rollMany(count);
  const gained = sumTokens(results);

  // Cobro + premio atómico.
  try {
    const commit = await chargeAndGrant(userId, cost, gained);
    return c.json({
      pulls: results, // [{ rarity, tokens }, ...] para la animación
      cost,
      coins: commit.coins, // saldo restante
      tokens: commit.tokens, // inventario actualizado
    });
  } catch (err) {
    if (err instanceof GachaError) {
      return c.json({ error: err.message }, 422);
    }
    console.error("Tirada falló:", err);
    return c.json({ error: "No se pudo completar la tirada." }, 500);
  }
});
