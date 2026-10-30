import "dotenv/config";

/**
 * Carga y valida las variables de entorno del servidor. `dotenv/config` lee el
 * archivo `.env` (en desarrollo); en producción el hosting inyecta las vars.
 *
 * Centralizamos el acceso aquí para fallar pronto y con un mensaje claro si
 * falta algo crítico, en vez de reventar más tarde con un error críptico.
 */

/** Quita comillas envolventes y espacios de un valor de .env. */
function clean(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v.trim().replace(/^["']|["']$/g, "");
}

/** Devuelve una variable requerida o lanza un error explicativo. */
function required(name: string): string {
  const v = clean(process.env[name]);
  if (!v) {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia server/.env.example a ` +
        `server/.env y rellénala (o configúrala en el hosting).`,
    );
  }
  return v;
}

/** Devuelve una variable opcional (o un valor por defecto). */
function optional(name: string, fallback?: string): string | undefined {
  return clean(process.env[name]) ?? fallback;
}

export const env = {
  /** Cadena de conexión a Postgres (Neon). */
  databaseUrl: required("DATABASE_URL"),
  /** Puerto HTTP (el hosting inyecta el suyo; en local 8787). */
  port: Number(optional("PORT", "8787")),

  /**
   * Credenciales de Google OAuth. Opcionales: si faltan, el servidor ARRANCA
   * igual (BD y salud siguen OK), pero el login con Google responde un error
   * explicando que no está configurado. Así se puede trabajar antes de tener
   * las credenciales.
   */
  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  /** Secreto para firmar la cookie de sesión. */
  sessionSecret: optional("SESSION_SECRET", "dev-insecure-secret-change-me"),
  /** URL del cliente a la que se vuelve tras el login. */
  clientUrl: optional("CLIENT_URL", "http://localhost:5173")!,
  /** URL base del propio servidor (para construir el redirect de OAuth). */
  serverUrl: optional("SERVER_URL", `http://localhost:${optional("PORT", "8787")}`)!,
};

/** ¿Está configurado el login con Google? (hay client id y secret). */
export const googleOAuthReady = Boolean(env.googleClientId && env.googleClientSecret);
