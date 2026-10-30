import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { googleOAuthReady, primaryClientUrl } from "../env.ts";
import { buildGoogleAuthUrl, getGoogleProfileFromCode } from "./google.ts";
import { setSession, getSessionUserId, clearSession } from "./session.ts";
import { upsertFromGoogle, findUserById } from "../db/users.ts";

/**
 * Rutas de autenticación con Google OAuth:
 *  GET /api/auth/google           -> redirige a Google (inicia login).
 *  GET /api/auth/google/callback  -> Google vuelve aquí con ?code&state.
 *  GET /api/auth/me               -> datos del usuario de la sesión actual.
 *  POST /api/auth/logout          -> cierra sesión.
 */

const STATE_COOKIE = "smashb_oauth_state";
const isProd = process.env.NODE_ENV === "production";

/** Genera un `state` aleatorio para proteger el flujo OAuth de CSRF. */
function randomState(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export const authRoutes = new Hono();

// Inicia el login: guardamos un `state` en cookie y redirigimos a Google.
authRoutes.get("/google", (c) => {
  if (!googleOAuthReady) {
    return c.json(
      { error: "Login con Google no configurado (faltan GOOGLE_CLIENT_ID/SECRET)." },
      503,
    );
  }
  const state = randomState();
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: "/",
    maxAge: 600, // 10 min para completar el login
  });
  return c.redirect(buildGoogleAuthUrl(state));
});

// Callback de Google: validamos state, canjeamos el code, creamos/actualizamos
// el usuario, abrimos sesión y volvemos al cliente.
authRoutes.get("/google/callback", async (c) => {
  if (!googleOAuthReady) {
    return c.json({ error: "Login con Google no configurado." }, 503);
  }
  const code = c.req.query("code");
  const state = c.req.query("state");
  const savedState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/" });

  if (!code || !state || !savedState || state !== savedState) {
    return c.redirect(`${primaryClientUrl}/?login=error`);
  }

  try {
    const profile = await getGoogleProfileFromCode(code);
    const user = await upsertFromGoogle(profile);
    await setSession(c, user.id);
    return c.redirect(`${primaryClientUrl}/?login=ok`);
  } catch (err) {
    console.error("OAuth callback falló:", err);
    return c.redirect(`${primaryClientUrl}/?login=error`);
  }
});

// Usuario actual (o null si no hay sesión).
authRoutes.get("/me", async (c) => {
  const userId = await getSessionUserId(c);
  if (!userId) return c.json({ user: null });
  const user = await findUserById(userId);
  if (!user) {
    clearSession(c);
    return c.json({ user: null });
  }
  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
  });
});

// Logout.
authRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});
