import { FIXED_DT } from "../../../src/engine/config.ts";
import { World } from "../../../src/engine/game/world.ts";
import { ReplayPlayer, type ReplayData } from "../../../src/engine/game/replay.ts";
import { coinsFor, gradeFor, type FighterScore } from "../../../src/engine/game/scoring.ts";

/**
 * VALIDACIÓN de partidas en el servidor (el corazón de la Fase 3).
 *
 * El cliente NO reporta el resultado: envía el replay (semilla + inputs) y aquí
 * lo RE-SIMULAMOS con el mismo motor determinista. Así el resultado es el real,
 * imposible de falsear desde el cliente. Como la simulación no dibuja nada, es
 * muy rápida (décimas de segundo incluso para partidas largas).
 *
 * El motor vive en `src/engine/` (compartido con el cliente); el server lo
 * importa por ruta relativa. Es TypeScript puro, sin dependencias de navegador.
 */

/** Límite de seguridad: una partida larguísima es sospechosa (o un abuso). */
const MAX_STEPS = 60 * 60 * 20; // 20 minutos a 60 Hz

/** Resultado de validar una partida para el jugador que la envió. */
export interface ValidatedMatch {
  /** ¿El jugador atribuido ganó la partida? */
  won: boolean;
  /** Grado (S..D) del jugador atribuido. */
  grade: string;
  /** KOs y muertes del jugador atribuido (para el ranking). */
  kills: number;
  deaths: number;
  /** Monedas que gana por esta partida. */
  coins: number;
  /** Índice del combatiente atribuido al jugador. */
  fighterIndex: number;
  /** Pasos simulados (informativo). */
  steps: number;
}

/** Problema al validar (replay inválido, no versus, sin humano, etc.). */
export class MatchValidationError extends Error {}

/**
 * Re-simula el replay y calcula el resultado para el jugador que lo envió.
 *
 * Atribución: el usuario logueado controló un combatiente HUMANO. Tomamos el
 * primer fighter cuyo controller sea "human" (en versus local con 2 humanos es
 * ambiguo; de momento se atribuye al primero; se podrá refinar).
 */
export function validateMatch(data: ReplayData): ValidatedMatch {
  // --- Comprobaciones básicas de forma ---
  if (!data || typeof data.seed !== "number" || !Array.isArray(data.steps)) {
    throw new MatchValidationError("Replay con formato inválido.");
  }
  if (data.mode !== "versus") {
    throw new MatchValidationError("Solo las partidas de versus puntúan.");
  }
  if (data.steps.length === 0) {
    throw new MatchValidationError("Replay vacío.");
  }
  if (data.steps.length > MAX_STEPS) {
    throw new MatchValidationError("Replay demasiado largo.");
  }

  const controllers = data.controllers ?? [];
  const humanIndex = controllers.findIndex((c) => c === "human");
  if (humanIndex < 0) {
    throw new MatchValidationError("La partida no tiene jugador humano: no puntúa.");
  }

  // --- Re-simulación determinista (sin render) ---
  const world = new World(data.mode, data.seed, {
    characters: data.characters,
    controllers: data.controllers,
    cpuDifficulty: data.cpuDifficulties ?? data.cpuDifficulty,
    stage: data.stage,
  });
  const player = new ReplayPlayer(data);
  for (let step = 0; step < player.totalSteps; step++) {
    world.step(player.inputsAt(step), FIXED_DT);
  }

  const fighter = world.fighters[humanIndex];
  if (!fighter) {
    throw new MatchValidationError("El combatiente del jugador no existe en la simulación.");
  }

  const s = fighter.player.stats;
  const score: FighterScore = {
    dealt: s.dealt,
    taken: s.taken,
    blocked: s.blocked,
    kos: s.kos,
    deaths: s.deaths,
  };

  const won = world.winnerIndex === humanIndex;

  return {
    won,
    grade: gradeFor(score),
    kills: s.kos,
    deaths: s.deaths,
    coins: coinsFor(score, won),
    fighterIndex: humanIndex,
    steps: player.totalSteps,
  };
}
