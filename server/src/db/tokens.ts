import { eq, sql } from "drizzle-orm";
import { db } from "./client.ts";
import { playerStats, playerTokens, type PlayerTokens } from "./schema.ts";
import type { Rarity } from "../gacha/pulls.ts";

/**
 * Inventario de tokens + cobro de tiradas del gacha. La operación de tirar es
 * ATÓMICA (una transacción): o se cobra Y se dan los tokens, o no pasa nada.
 * Así nunca se cobra sin premiar ni se premia sin cobrar.
 */

/** Obtiene los tokens del usuario, creando la fila (a cero) si no existía. */
export async function getOrCreateTokens(userId: string): Promise<PlayerTokens> {
  const existing = await db
    .select()
    .from(playerTokens)
    .where(eq(playerTokens.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(playerTokens)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const again = await db
    .select()
    .from(playerTokens)
    .where(eq(playerTokens.userId, userId))
    .limit(1);
  return again[0];
}

/** Error de negocio al tirar (p. ej. monedas insuficientes). */
export class GachaError extends Error {}

/** Resultado de un cobro+premio: saldo y tokens resultantes. */
export interface PullCommit {
  coins: number;
  tokens: { common: number; epic: number; legendary: number };
}

/**
 * Cobra `cost` monedas y suma los tokens indicados, todo en una transacción.
 * Lanza GachaError si el usuario no tiene monedas suficientes (sin tocar nada).
 */
export async function chargeAndGrant(
  userId: string,
  cost: number,
  gained: Record<Rarity, number>,
): Promise<PullCommit> {
  return db.transaction(async (tx) => {
    // Asegura filas de stats y tokens.
    const statsRows = await tx
      .select({ coins: playerStats.coins })
      .from(playerStats)
      .where(eq(playerStats.userId, userId))
      .limit(1);
    const coins = statsRows[0]?.coins ?? 0;
    if (coins < cost) {
      throw new GachaError("No tienes monedas suficientes.");
    }

    // Cobra monedas.
    await tx
      .update(playerStats)
      .set({ coins: sql`${playerStats.coins} - ${cost}`, updatedAt: new Date() })
      .where(eq(playerStats.userId, userId));

    // Asegura la fila de tokens y suma lo ganado.
    await tx.insert(playerTokens).values({ userId }).onConflictDoNothing();
    const [tokens] = await tx
      .update(playerTokens)
      .set({
        common: sql`${playerTokens.common} + ${gained.common}`,
        epic: sql`${playerTokens.epic} + ${gained.epic}`,
        legendary: sql`${playerTokens.legendary} + ${gained.legendary}`,
        updatedAt: new Date(),
      })
      .where(eq(playerTokens.userId, userId))
      .returning();

    const [stats] = await tx
      .select({ coins: playerStats.coins })
      .from(playerStats)
      .where(eq(playerStats.userId, userId))
      .limit(1);

    return {
      coins: stats.coins,
      tokens: { common: tokens.common, epic: tokens.epic, legendary: tokens.legendary },
    };
  });
}
