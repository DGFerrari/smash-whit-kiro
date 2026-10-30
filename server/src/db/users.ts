import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { users, type User } from "./schema.ts";
import type { GoogleProfile } from "../auth/google.ts";

/**
 * Operaciones sobre usuarios. El login con Google llama a
 * `upsertFromGoogle`: si ya existe un usuario con ese `google_id`, lo
 * devuelve (actualizando nombre/email/avatar por si cambiaron); si no, lo crea.
 */

/** Longitud máxima del apodo (debe coincidir con la validación del endpoint). */
const NICKNAME_MAX = 16;

/**
 * Apodo por defecto a partir del nombre de Google: recortado al máximo permitido
 * (por puntos de código, para no partir un emoji) para evitar apodos enormes de
 * correos con nombres larguísimos.
 */
function defaultNickname(name: string): string {
  const glyphs = Array.from(name.trim());
  return glyphs.length <= NICKNAME_MAX
    ? glyphs.join("")
    : glyphs.slice(0, NICKNAME_MAX).join("");
}

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
      // Al darse de alta, el apodo por defecto es el nombre de Google RECORTADO
      // al máximo permitido. Luego el usuario puede cambiarlo y NO se vuelve a
      // sobrescribir en logins futuros.
      nickname: defaultNickname(profile.name),
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

/**
 * Cambia el apodo del usuario y lo marca como "ya elegido" (para no volver a
 * forzar el onboarding). Devuelve el usuario actualizado.
 */
export async function updateNickname(id: string, nickname: string): Promise<User | null> {
  const [updated] = await db
    .update(users)
    .set({ nickname, nicknameChosen: true })
    .where(eq(users.id, id))
    .returning();
  return updated ?? null;
}
