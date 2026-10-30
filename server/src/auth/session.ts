import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { env } from "../env.ts";

/**
 * Sesión del usuario mediante una cookie JWT firmada con `SESSION_SECRET`.
 *
 * Guardamos solo el id interno del usuario en el token; los datos completos se
 * leen de la BD cuando hacen falta. La cookie es httpOnly (no accesible por JS
 * del cliente) y, en producción, Secure + SameSite para mitigar CSRF.
 */

const COOKIE_NAME = "smashb_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 días

const isProd = process.env.NODE_ENV === "production";

/** Crea la cookie de sesión para un usuario (por su id interno). */
export async function setSession(c: Context, userId: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const token = await sign({ sub: userId, exp }, env.sessionSecret, "HS256");
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Devuelve el id de usuario de la sesión actual, o null si no hay sesión. */
export async function getSessionUserId(c: Context): Promise<string | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  try {
    const payload = await verify(token, env.sessionSecret, "HS256");
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null; // token inválido o caducado
  }
}

/** Borra la cookie de sesión (logout). */
export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}
