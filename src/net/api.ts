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
  /** Apodo elegido por el usuario (lo que se muestra en partida y rankings). */
  nickname: string;
  /** ¿Ya eligió apodo? Si es false, es su primer login (onboarding). */
  nicknameChosen: boolean;
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

/** Resultado de puntuar una partida en el servidor. */
export interface MatchReward {
  won: boolean;
  grade: string;
  coinsEarned: number;
  kills: number;
  deaths: number;
}

/** Progreso del jugador (monedas y stats acumuladas). */
export interface PlayerStats {
  coins: number;
  wins: number;
  kills: number;
  deaths: number;
  matchesPlayed: number;
}

/** Posibles desenlaces de enviar una partida a puntuar. */
export type SubmitOutcome =
  | { kind: "ok"; reward: MatchReward; stats: PlayerStats }
  | { kind: "no-session" } // no hay sesión: la partida no puntúa
  | { kind: "not-ranked"; message: string } // válida pero no puntuable (p. ej. no-versus)
  | { kind: "error"; message: string }; // fallo de red/servidor

/**
 * Envía una partida terminada (el replay) para que el SERVIDOR la valide
 * re-simulándola y otorgue monedas. El cliente no decide el resultado.
 */
export async function submitMatch(replay: unknown): Promise<SubmitOutcome> {
  try {
    const res = await fetch(`${API_BASE}/api/match/submit`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(replay),
    });
    if (res.status === 401) return { kind: "no-session" };
    if (res.status === 422) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { kind: "not-ranked", message: data.error ?? "La partida no puntúa." };
    }
    if (!res.ok) {
      return { kind: "error", message: `Error del servidor (${res.status}).` };
    }
    const data = (await res.json()) as { result: MatchReward; stats: PlayerStats };
    return { kind: "ok", reward: data.result, stats: data.stats };
  } catch {
    return { kind: "error", message: "No se pudo contactar con el servidor." };
  }
}

/** Resultado de intentar cambiar el apodo. */
export type NicknameResult =
  | { kind: "ok"; nickname: string }
  | { kind: "error"; message: string };

/** Cambia el apodo del usuario en el servidor (requiere sesión). */
export async function updateNickname(nickname: string): Promise<NicknameResult> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/nickname`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname }),
    });
    if (res.ok) {
      const data = (await res.json()) as { nickname: string };
      return { kind: "ok", nickname: data.nickname };
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: data.error ?? `Error (${res.status}).` };
  } catch {
    return { kind: "error", message: "No se pudo contactar con el servidor." };
  }
}

/** Campo y orden del ranking. */
export type RankField = "wins" | "kills" | "deaths" | "coins";
export type RankOrder = "asc" | "desc";

/** Una fila del ranking. */
export interface RankRow {
  rank: number;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  wins: number;
  kills: number;
  deaths: number;
  coins: number;
}

/** Respuesta del ranking. */
export interface RankingData {
  sort: RankField;
  order: RankOrder;
  total: number;
  myRank: number | null;
  myUserId: string | null;
  rows: RankRow[];
}

/** Stats del usuario (incluye el saldo de monedas). null si no hay sesión. */
export async function getStats(): Promise<PlayerStats | null> {
  try {
    const res = await fetch(`${API_BASE}/api/match/stats`, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { stats: PlayerStats | null };
    return data.stats;
  } catch {
    return null;
  }
}

/** Pide el ranking ordenado por `sort`/`order` (la ordenación la hace el servidor). */
export async function getRanking(sort: RankField, order: RankOrder): Promise<RankingData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/ranking?sort=${sort}&order=${order}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as RankingData;
  } catch {
    return null;
  }
}

/** Rareza de un token del gacha. */
export type Rarity = "common" | "epic" | "legendary";

/** Inventario de tokens del jugador. */
export interface TokenInventory {
  common: number;
  epic: number;
  legendary: number;
}

/** Info de precios del gacha. */
export interface GachaInfo {
  singleCost: number;
  multiCount: number;
  multiCost: number;
}

/** Una tirada individual del resultado. */
export interface Pull {
  rarity: Rarity;
  tokens: number;
}

/** Desenlace de tirar en el gacha. */
export type PullOutcome =
  | { kind: "ok"; pulls: Pull[]; cost: number; coins: number; tokens: TokenInventory }
  | { kind: "no-session" }
  | { kind: "no-coins"; message: string }
  | { kind: "error"; message: string };

/** Precios del gacha. */
export async function getGachaInfo(): Promise<GachaInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/api/gacha/info`);
    if (!res.ok) return null;
    return (await res.json()) as GachaInfo;
  } catch {
    return null;
  }
}

/** Inventario de tokens del usuario (null si no hay sesión o falla). */
export async function getTokens(): Promise<TokenInventory | null> {
  try {
    const res = await fetch(`${API_BASE}/api/gacha/tokens`, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { tokens: TokenInventory | null };
    return data.tokens;
  } catch {
    return null;
  }
}

/** Tira en el gacha (1 o 10 veces). El servidor cobra y sortea. */
export async function pull(count: 1 | 10): Promise<PullOutcome> {
  try {
    const res = await fetch(`${API_BASE}/api/gacha/pull?count=${count}`, {
      method: "POST",
      credentials: "include",
    });
    if (res.status === 401) return { kind: "no-session" };
    if (res.status === 422) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { kind: "no-coins", message: data.error ?? "No tienes monedas suficientes." };
    }
    if (!res.ok) return { kind: "error", message: `Error del servidor (${res.status}).` };
    const data = (await res.json()) as {
      pulls: Pull[];
      cost: number;
      coins: number;
      tokens: TokenInventory;
    };
    return { kind: "ok", pulls: data.pulls, cost: data.cost, coins: data.coins, tokens: data.tokens };
  } catch {
    return { kind: "error", message: "No se pudo contactar con el servidor." };
  }
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
