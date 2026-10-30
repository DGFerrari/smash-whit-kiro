import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { users, type User } from "./schema.ts";
import type { GoogleProfile } from "../auth/google.ts";

/**
 * Operaciones sobre usuarios. El login con Google llama a
 * `upsertFromGoogle`: si ya existe un usuario con ese `google_id`, lo
 * devuelve (actualizando nombre/email/avatar por si cambiaron); si no, lo crea.
 */

/** Crea o actualiza el usuario a partir del perfil de Google. */
export async function upsertFromGoogle(profile: GoogleProfile): Promise<User> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.googleId, profile.sub))
    .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(users)
      .set({ email: profile.email, name: profile.name, avatarUrl: profile.picture ?? null })
      .where(eq(users.googleId, profile.sub))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(users)
    .values({
      googleId: profile.sub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture ?? null,
    })
    .returning();
  return created;
}

/** Busca un usuario por su id interno (para la sesión). */
export async function findUserById(id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}
