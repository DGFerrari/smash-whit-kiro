import { eq, sql } from "drizzle-orm";
import { db } from "./client.ts";
import { playerStats, type PlayerStats } from "./schema.ts";

/**
 * Progreso del jugador (monedas + stats de ranking). Una fila por usuario; se
 * crea la primera vez que hace falta. Solo el servidor escribe aquí, tras
 * validar una partida re-simulando el replay.
 */

/** Recompensas/contadores a sumar por una partida validada. */
export interface MatchRewards {
  coins: number;
  won: boolean;
  kills: number;
  deaths: number;
}

/** Obtiene las stats del usuario, creándolas (a cero) si no existían. */
export async function getOrCreateStats(userId: string): Promise<PlayerStats> {
  const existing = await db
    .select()
    .from(playerStats)
    .where(eq(playerStats.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(playerStats)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  // Si por carrera ya existía (onConflictDoNothing no devuelve fila), releemos.
  if (created) return created;
  const again = await db
    .select()
    .from(playerStats)
    .where(eq(playerStats.userId, userId))
    .limit(1);
  return again[0];
}

/**
 * Aplica las recompensas de una partida a las stats del usuario de forma
 * ATÓMICA (un solo UPDATE con incrementos), y devuelve las stats resultantes.
 * Garantiza que la fila existe primero.
 */
export async function applyMatchRewards(
  userId: string,
  rewards: MatchRewards,
): Promise<PlayerStats> {
  await getOrCreateStats(userId);
  const [updated] = await db
    .update(playerStats)
    .set({
      coins: sql`${playerStats.coins} + ${rewards.coins}`,
      wins: sql`${playerStats.wins} + ${rewards.won ? 1 : 0}`,
      kills: sql`${playerStats.kills} + ${rewards.kills}`,
      deaths: sql`${playerStats.deaths} + ${rewards.deaths}`,
      matchesPlayed: sql`${playerStats.matchesPlayed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(playerStats.userId, userId))
    .returning();
  return updated;
}
