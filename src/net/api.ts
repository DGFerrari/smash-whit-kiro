/**
 * Capa de acceso al BACKEND (cuentas, y más adelante puntos/ranking).
 *
 * En desarrollo el servidor corre en http://localhost:8787 y el cliente en
 * :5173 (orígenes distintos), así que todas las peticiones usan
 * `credentials: "include"` para que viaje la cookie de sesión, y el servidor
 * responde con CORS que lo permite.
 *
 * La URL base se toma de `VITE_API_URL` (definida en `.env`/`.env.production`);
 * si no está, se asume el servidor local de desarrollo.
 */
const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";

/** Datos públicos del usuario con sesión iniciada. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/** Devuelve el usuario actual (o null si no hay sesión). Nunca lanza. */
export async function getMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: AuthUser | null };
    return data.user;
  } catch {
    // El backend puede no estar disponible (p. ej. jugando solo en local sin
    // servidor). El juego funciona igual; simplemente no hay sesión.
    return null;
  }
}

/** Inicia el login con Google (redirección completa del navegador). */
export function startGoogleLogin(): void {
  window.location.href = `${API_BASE}/api/auth/google`;
}

/** Cierra la sesión en el servidor. Nunca lanza. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Silencioso: si falla, la cookie expira sola.
  }
}
