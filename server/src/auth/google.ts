import { env } from "../env.ts";

/**
 * Cliente OAuth 2.0 de Google, a pelo con `fetch` (sin librería pesada). Tres
 * cosas:
 *  1) construir la URL de login (a donde mandamos al usuario),
 *  2) canjear el `code` del callback por tokens,
 *  3) leer el perfil del usuario con el access token.
 *
 * El `redirect_uri` debe coincidir EXACTAMENTE con el configurado en Google
 * Cloud (Authorized redirect URIs).
 */

export const GOOGLE_REDIRECT_URI = `${env.serverUrl}/api/auth/google/callback`;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/** Perfil mínimo que nos interesa del usuario de Google. */
export interface GoogleProfile {
  /** Identificador único y estable de la cuenta de Google. */
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

/** URL a la que redirigir para iniciar sesión. `state` protege de CSRF. */
export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.googleClientId ?? "",
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Canjea el `code` del callback por un access token. */
async function exchangeCodeForToken(code: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId ?? "",
      client_secret: env.googleClientSecret ?? "",
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Intercambio de token falló (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Respuesta de token sin access_token");
  return data.access_token;
}

/** Lee el perfil del usuario con el access token. */
async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Lectura de perfil falló (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as Partial<GoogleProfile>;
  if (!data.sub || !data.email || !data.name) {
    throw new Error("Perfil de Google incompleto");
  }
  return { sub: data.sub, email: data.email, name: data.name, picture: data.picture };
}

/** Flujo completo: del `code` del callback al perfil del usuario. */
export async function getGoogleProfileFromCode(code: string): Promise<GoogleProfile> {
  const token = await exchangeCodeForToken(code);
  return fetchProfile(token);
}
