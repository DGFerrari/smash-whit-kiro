import { createInputState, type InputState } from "../core/inputState.ts";
import { ENGINE_VERSION } from "../config.ts";
import type { GameMode } from "./world.ts";
import type { CharacterId } from "./characters.ts";
import type { StageId } from "./stages.ts";

/**
 * Sistema de REPLAY basado en determinismo.
 *
 * Como la simulación es determinista (timestep fijo + RNG sembrado + la física
 * solo lee InputState), NO guardamos posiciones ni estados: basta con la
 * SEMILLA, el MODO y la lista de inputs de cada paso de física. Para reproducir,
 * re-ejecutamos el mismo World alimentándolo con esos inputs. Un replay de 5
 * min son ~18000 pasos × 2 jugadores, pero cada input cabe en pocos bytes.
 *
 * Formato serializado (JSON): compacto pero legible. Cada InputState se empaqueta
 * en un entero de bits + ejes, así el archivo es pequeño.
 */

/**
 * v6 añade `engineVersion` (versión del motor de simulación con el que se
 * grabó), para avisar si un replay es de otra versión del juego.
 * v5 cambia la dificultad de la CPU a por-slot (cpuDifficulties[]), cada CPU
 * con la suya. Los replays v4 (un único cpuDifficulty) se siguen leyendo.
 * v4 añadió los controllers (human/cpu) para reproducir partidas con CPU.
 * v3 añadió el resumen de resultado. v2 añadió personajes + escenario.
 * v1 (sin nada de eso) se sigue pudiendo cargar.
 */
export const REPLAY_VERSION = 6;

/**
 * Resumen de un jugador para la ficha del replay (lista + panel de detalle).
 * Se guarda junto al replay para no tener que re-simular para mostrarlo.
 */
export interface ReplayFighterSummary {
  label: string;
  color: string;
  /** Id de personaje (para mostrar su nombre con getCharacter). */
  character: CharacterId;
  dealt: number;
  taken: number;
  blocked: number;
  kos: number;
  deaths: number;
  isWinner: boolean;
}

/** Metadatos de resultado de la partida (v3+). Lo que muestra la lista. */
export interface ReplayResult {
  /** Etiqueta del ganador ("P1"/"P2"/"Empate") y su color. */
  winnerLabel: string;
  winnerColor: string;
  draw: boolean;
  /** Duración en segundos (steps / 60). */
  durationSec: number;
  fighters: ReplayFighterSummary[];
}

export interface ReplayData {
  /** Versión del FORMATO de datos del replay (qué campos trae). */
  version: number;
  /**
   * Versión del MOTOR de simulación con el que se grabó (v6+). Si no coincide
   * con la actual al reproducir, la partida puede no reproducirse igual (cambió
   * la física/balance). Opcional: los replays anteriores no la traen.
   */
  engineVersion?: number;
  mode: GameMode;
  seed: number;
  /** Personajes de cada jugador (v2+). Opcional por compat con v1. */
  characters?: CharacterId[];
  /** Escenario de la partida (v2+). Opcional por compat con v1. */
  stage?: StageId;
  /**
   * Quién controla cada combatiente (v4+): "human" | "cpu". Necesario para que
   * un replay con CPU se re-simule igual (la IA es determinista, pero el World
   * debe saber que ese slot es CPU para regenerarla). Opcional por compat.
   */
  controllers?: ("human" | "cpu")[];
  /**
   * Dificultad de la CPU del índice 1 (v4): un único valor común. Se conserva
   * solo para LEER replays v4 antiguos.
   */
  cpuDifficulty?: "easy" | "normal" | "hard";
  /**
   * Dificultad de la CPU por índice de combatiente (v5+): cada CPU la suya.
   * Al reproducir, tiene prioridad sobre `cpuDifficulty`.
   */
  cpuDifficulties?: ("easy" | "normal" | "hard")[];
  /** Fecha ISO de grabación (informativo). */
  recordedAt: string;
  /** Nº de jugadores (2). */
  players: number;
  /** Pasos: cada uno es un array de inputs empaquetados (uno por jugador). */
  steps: number[][];
  /** Resumen de resultado para la lista/detalle (v3+). Opcional por compat. */
  result?: ReplayResult;
}

// --- Empaquetado de un InputState en un entero ------------------------------
// Bits: jumpHeld, jumpPressed, lightPressed, heavyHeld, heavyReleased,
//       shieldHeld, shieldPressed, y moveX/moveY (2 bits con signo cada uno).

const BIT = {
  jumpHeld: 1 << 0,
  jumpPressed: 1 << 1,
  lightPressed: 1 << 2,
  heavyHeld: 1 << 3,
  heavyReleased: 1 << 4,
  shieldHeld: 1 << 5,
  shieldPressed: 1 << 6,
} as const;

/** Codifica -1/0/1 en 2 bits: 0->0, 1->1, -1->2. */
function encAxis(v: number): number {
  return v === 0 ? 0 : v > 0 ? 1 : 2;
}
function decAxis(code: number): number {
  return code === 0 ? 0 : code === 1 ? 1 : -1;
}

export function packInput(s: InputState): number {
  let bits = 0;
  if (s.jumpHeld) bits |= BIT.jumpHeld;
  if (s.jumpPressed) bits |= BIT.jumpPressed;
  if (s.lightPressed) bits |= BIT.lightPressed;
  if (s.heavyHeld) bits |= BIT.heavyHeld;
  if (s.heavyReleased) bits |= BIT.heavyReleased;
  if (s.shieldHeld) bits |= BIT.shieldHeld;
  if (s.shieldPressed) bits |= BIT.shieldPressed;
  // moveX en bits 7-8, moveY en bits 9-10.
  bits |= encAxis(s.moveX) << 7;
  bits |= encAxis(s.moveY) << 9;
  return bits;
}

export function unpackInto(packed: number, out: InputState): void {
  out.jumpHeld = (packed & BIT.jumpHeld) !== 0;
  out.jumpPressed = (packed & BIT.jumpPressed) !== 0;
  out.lightPressed = (packed & BIT.lightPressed) !== 0;
  out.heavyHeld = (packed & BIT.heavyHeld) !== 0;
  out.heavyReleased = (packed & BIT.heavyReleased) !== 0;
  out.shieldHeld = (packed & BIT.shieldHeld) !== 0;
  out.shieldPressed = (packed & BIT.shieldPressed) !== 0;
  out.moveX = decAxis((packed >> 7) & 0b11);
  out.moveY = decAxis((packed >> 9) & 0b11);
}

/**
 * Grabador: acumula los inputs de cada paso de física. El loop le pasa los
 * InputState ya muestreados en cada step mientras la grabación esté activa.
 */
export class ReplayRecorder {
  private readonly steps: number[][] = [];

  constructor(
    private readonly mode: GameMode,
    private readonly seed: number,
    private readonly characters: CharacterId[],
    private readonly stage: StageId,
    private readonly controllers?: ("human" | "cpu")[],
    private readonly cpuDifficulties?: ("easy" | "normal" | "hard")[],
  ) {}

  record(inputs: InputState[]): void {
    this.steps.push(inputs.map(packInput));
  }

  get length(): number {
    return this.steps.length;
  }

  /** Construye el objeto serializable del replay, con resultado opcional. */
  build(result?: ReplayResult): ReplayData {
    return {
      version: REPLAY_VERSION,
      engineVersion: ENGINE_VERSION,
      mode: this.mode,
      seed: this.seed,
      characters: this.characters,
      stage: this.stage,
      controllers: this.controllers,
      cpuDifficulties: this.cpuDifficulties,
      recordedAt: new Date().toISOString(),
      players: this.characters.length,
      steps: this.steps,
      result,
    };
  }
}

/**
 * Reproductor: entrega los inputs grabados paso a paso. Reutiliza dos
 * InputState internos para no crear basura por frame.
 */
export class ReplayPlayer {
  readonly totalSteps: number;
  private readonly scratch: InputState[];

  constructor(readonly data: ReplayData) {
    this.totalSteps = data.steps.length;
    // Un scratch por jugador (2..4). Deducimos el número de `players` o, por
    // compat, del primer paso grabado.
    const n = data.players || data.steps[0]?.length || 2;
    this.scratch = Array.from({ length: n }, () => createInputState());
  }

  /** Inputs del paso `index` (clamp a los límites). */
  inputsAt(index: number): InputState[] {
    const i = index < 0 ? 0 : index >= this.totalSteps ? this.totalSteps - 1 : index;
    const packed = this.data.steps[i] ?? [];
    for (let p = 0; p < this.scratch.length; p++) {
      unpackInto(packed[p] ?? 0, this.scratch[p]);
    }
    return this.scratch;
  }
}

// NOTA: `downloadReplay`/`loadReplayFile` (import/export como archivo .json)
// viven en la capa de cliente (`src/ui/replayFile.ts`) porque usan APIs de
// navegador (document/Blob/File). El motor no debe depender del DOM.
