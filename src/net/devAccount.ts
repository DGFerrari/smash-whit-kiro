/**
 * CUENTA DE PRUEBA LOCAL (solo `npm run dev`).
 *
 * Simula en el navegador una sesión iniciada y el backend que la acompaña
 * (stats, monedas, ranking, gacha y puntuación de partidas) para probar sin
 * servidor ni login de Google lo que normalmente exige estar conectado.
 *
 *  - Se activa con el botón "Usuario de prueba" del menú (solo en desarrollo).
 *  - Los datos viven en localStorage; "Cerrar sesión" desactiva la sesión pero
 *    conserva el progreso (monedas, tokens…). `resetDevAccount()` lo borra.
 *  - La puntuación re-simula el replay con el MISMO motor que usa el servidor,
 *    así el resultado (victoria, grado, monedas) es el que daría el real.
 *
 * En producción `import.meta.env.DEV` es `false`: `isDevAccountActive()`
 * devuelve siempre `false` y ninguna llamada llega aquí.
 */
import { FIXED_DT } from "../engine/config.ts";
import { World } from "../engine/game/world.ts";
import { ReplayPlayer, type ReplayData } from "../engine/game/replay.ts";
import { coinsFor, gradeFor } from "../engine/game/scoring.ts";
import type {
  AuthUser,
  GachaInfo,
  NicknameResult,
  PlayerStats,
  PullOutcome,
  Pull,
  RankField,
  RankingData,
  RankOrder,
  RankRow,
  Rarity,
  SubmitOutcome,
  TokenInventory,
} from "./api.ts";

/** ¿Está disponible la cuenta de prueba? (solo en el servidor de desarrollo). */
export const DEV_ACCOUNT_AVAILABLE: boolean = import.meta.env.DEV;

const SESSION_KEY = "kb.devAccount.session.v1";
const STATE_KEY = "kb.devAccount.state.v1";

/** Saldo inicial de la cuenta de prueba (da para unas cuantas tiradas). */
export const DEV_START_COINS = 2000;

interface DevState {
  user: AuthUser;
  stats: PlayerStats;
  tokens: TokenInventory;
}

function freshState(): DevState {
  return {
    user: {
      id: "dev-local",
      name: "Usuario de prueba",
      nickname: "Tester",
      // false = primer login: se pide elegir apodo (para probar el onboarding).
      nicknameChosen: false,
      email: "tester@localhost",
      avatarUrl: null,
    },
    stats: { coins: DEV_START_COINS, wins: 0, kills: 0, deaths: 0, matchesPlayed: 0 },
    tokens: { common: 0, epic: 0, legendary: 0 },
  };
}

/** Respaldo en memoria si localStorage no está disponible (modo privado, tests). */
const memory = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
};

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") {
      return localStorage;
    }
  } catch {
    /* acceso denegado: memoria */
  }
  return memoryStorage;
}

function load(): DevState {
  const raw = storage().getItem(STATE_KEY);
  if (raw) {
    try {
      const s = JSON.parse(raw) as DevState;
      if (s && s.user && s.stats && s.tokens) return s;
    } catch {
      /* estado corrupto: se rehace */
    }
  }
  const s = freshState();
  save(s);
  return s;
}

function save(s: DevState): void {
  storage().setItem(STATE_KEY, JSON.stringify(s));
}

/** ¿Hay sesión de prueba activa? Siempre `false` fuera de desarrollo. */
export function isDevAccountActive(): boolean {
  return DEV_ACCOUNT_AVAILABLE && storage().getItem(SESSION_KEY) === "1";
}

/** "Inicia sesión" con la cuenta de prueba. */
export function enableDevAccount(): void {
  if (!DEV_ACCOUNT_AVAILABLE) return;
  load(); // crea el estado si no existe
  storage().setItem(SESSION_KEY, "1");
}

/** "Cierra sesión" (el progreso de prueba se conserva). */
export function disableDevAccount(): void {
  storage().removeItem(SESSION_KEY);
}

/** Borra todo el progreso de la cuenta de prueba. */
export function resetDevAccount(): void {
  storage().removeItem(STATE_KEY);
}

/** Suma monedas de prueba (para probar el gacha sin jugar). */
export function grantDevCoins(amount: number): PlayerStats {
  const s = load();
  s.stats.coins += Math.max(0, Math.round(amount));
  save(s);
  return { ...s.stats };
}

// ── Backend simulado ─────────────────────────────────────────────────────────

export function devMe(): AuthUser {
  return { ...load().user };
}

export function devStats(): PlayerStats {
  return { ...load().stats };
}

export function devUpdateNickname(nickname: string): NicknameResult {
  const nick = nickname.trim();
  const len = Array.from(nick).length;
  if (len < 2 || len > 20) return { kind: "error", message: "El apodo debe tener entre 2 y 20 caracteres." };
  const s = load();
  s.user.nickname = nick;
  s.user.nicknameChosen = true;
  save(s);
  return { kind: "ok", nickname: nick };
}

/**
 * Puntúa una partida como el servidor: re-simula el replay y calcula el
 * resultado del combatiente del jugador (primer humano, o `slot` en online).
 */
export function devSubmitMatch(replay: unknown, slot?: number): SubmitOutcome {
  const data = replay as ReplayData;
  if (!data || typeof data.seed !== "number" || !Array.isArray(data.steps) || data.steps.length === 0) {
    return { kind: "not-ranked", message: "Replay con formato inválido." };
  }
  if (data.mode !== "versus") return { kind: "not-ranked", message: "Solo las partidas de versus puntúan." };
  const controllers = data.controllers ?? [];
  const idx = slot ?? controllers.findIndex((c) => c === "human");
  if (idx < 0) return { kind: "not-ranked", message: "La partida no tiene jugador humano: no puntúa." };

  try {
    const world = new World(data.mode, data.seed, {
      characters: data.characters,
      controllers: data.controllers,
      cpuDifficulty: data.cpuDifficulties ?? data.cpuDifficulty,
      stage: data.stage,
      engineVersion: data.engineVersion ?? 1,
    });
    const player = new ReplayPlayer(data);
    for (let step = 0; step < player.totalSteps; step++) world.step(player.inputsAt(step), FIXED_DT);
    const fighter = world.fighters[idx];
    if (!fighter) return { kind: "not-ranked", message: "El combatiente del jugador no existe." };
    const st = fighter.player.stats;
    const score = { dealt: st.dealt, taken: st.taken, blocked: st.blocked, kos: st.kos, deaths: st.deaths };
    const won = world.winnerIndex === idx;
    const coins = coinsFor(score, won);

    const s = load();
    s.stats.coins += coins;
    s.stats.wins += won ? 1 : 0;
    s.stats.kills += st.kos;
    s.stats.deaths += st.deaths;
    s.stats.matchesPlayed += 1;
    save(s);
    return {
      kind: "ok",
      reward: { won, grade: gradeFor(score), coinsEarned: coins, kills: st.kos, deaths: st.deaths },
      stats: { ...s.stats },
    };
  } catch (err) {
    return { kind: "error", message: `Simulación local fallida: ${String(err)}` };
  }
}

/** Rivales ficticios del ranking de prueba (fijos, para comparar). */
const RIVALS: ReadonlyArray<Omit<RankRow, "rank">> = [
  { userId: "bot-1", nickname: "Kiro Bot", avatarUrl: null, wins: 42, kills: 130, deaths: 61, coins: 5200 },
  { userId: "bot-2", nickname: "LuchaLibre", avatarUrl: null, wins: 31, kills: 98, deaths: 70, coins: 3100 },
  { userId: "bot-3", nickname: "NeonNinja", avatarUrl: null, wins: 25, kills: 120, deaths: 44, coins: 2800 },
  { userId: "bot-4", nickname: "Slimey", avatarUrl: null, wins: 12, kills: 40, deaths: 52, coins: 900 },
  { userId: "bot-5", nickname: "Turbo", avatarUrl: null, wins: 8, kills: 33, deaths: 39, coins: 1500 },
  { userId: "bot-6", nickname: "Chef Taro", avatarUrl: null, wins: 3, kills: 12, deaths: 25, coins: 300 },
];

export function devRanking(sort: RankField, order: RankOrder): RankingData {
  const s = load();
  const me: Omit<RankRow, "rank"> = {
    userId: s.user.id,
    nickname: s.user.nickname,
    avatarUrl: s.user.avatarUrl,
    wins: s.stats.wins,
    kills: s.stats.kills,
    deaths: s.stats.deaths,
    coins: s.stats.coins,
  };
  const dir = order === "asc" ? 1 : -1;
  const rows = [...RIVALS, me]
    .sort((a, b) => (a[sort] - b[sort]) * dir || a.nickname.localeCompare(b.nickname))
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const mine = rows.find((r) => r.userId === me.userId);
  return { sort, order, total: rows.length, myRank: mine?.rank ?? null, myUserId: me.userId, rows };
}

// Gacha: mismas reglas que `server/src/gacha/pulls.ts`.
const PULL_COST = 100;
const MULTI_COUNT = 10;
const MULTI_COST = Math.round(PULL_COST * MULTI_COUNT * 0.9);
const RARITIES: Record<Rarity, { chance: number; min: number; max: number }> = {
  common: { chance: 0.7, min: 10, max: 50 },
  epic: { chance: 0.2, min: 5, max: 15 },
  legendary: { chance: 0.1, min: 1, max: 5 },
};

export function devGachaInfo(): GachaInfo {
  return { singleCost: PULL_COST, multiCount: MULTI_COUNT, multiCost: MULTI_COST };
}

export function devTokens(): TokenInventory {
  return { ...load().tokens };
}

function rollOne(): Pull {
  const r = Math.random();
  let acc = 0;
  let rarity: Rarity = "common";
  for (const k of ["common", "epic", "legendary"] as Rarity[]) {
    acc += RARITIES[k].chance;
    if (r < acc) {
      rarity = k;
      break;
    }
  }
  const d = RARITIES[rarity];
  return { rarity, tokens: d.min + Math.floor(Math.random() * (d.max - d.min + 1)) };
}

export function devPull(count: 1 | 10): PullOutcome {
  const s = load();
  const cost = count === 10 ? MULTI_COST : PULL_COST;
  if (s.stats.coins < cost) return { kind: "no-coins", message: "No tienes monedas suficientes." };
  const pulls = Array.from({ length: count }, rollOne);
  s.stats.coins -= cost;
  for (const p of pulls) s.tokens[p.rarity] += p.tokens;
  save(s);
  return { kind: "ok", pulls, cost, coins: s.stats.coins, tokens: { ...s.tokens } };
}
