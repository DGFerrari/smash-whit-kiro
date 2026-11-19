/**
 * Detector de eventos visuales (Sistema_VFX, R8.1–R8.7).
 *
 * La Simulación no emite eventos de render: este módulo compara el estado de
 * los combatientes entre dos llamadas consecutivas y deduce impactos, aturdi-
 * miento, carga, furia y KOs. Es puro: solo LEE los combatientes (estructura
 * compatible con `Fighter` del motor) y copia los campos que necesita a su
 * propio estado previo. Nunca muta las entradas.
 */
import { BLAST_ZONE } from "../../engine/config.ts";
import { CHARGE, HEAVY_ATTACKS } from "../../engine/combat/attacks.ts";

// ---------------------------------------------------------------------------
// Entrada (solo lectura, compatible estructuralmente con Fighter/Player)
// ---------------------------------------------------------------------------

export interface ReadonlyVec2 {
  readonly x: number;
  readonly y: number;
}

export interface PlayerLike {
  readonly pos: ReadonlyVec2;
  readonly vel: ReadonlyVec2;
  readonly width: number;
  readonly height: number;
  readonly damage: number;
  readonly hitFlash: number;
  readonly stunned: boolean;
  readonly charging: boolean;
  readonly chargeRatio: number;
  readonly furyActive: boolean;
  readonly attack: { readonly def: { readonly kind: string } } | null;
  readonly stats?: { readonly deaths: number };
}

export interface FighterLike {
  readonly index: number;
  readonly lives: number;
  readonly alive: boolean;
  readonly isDead: boolean;
  readonly lastHitBy: number;
  readonly player: PlayerLike;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export type KoEdge = "left" | "right" | "top" | "bottom";

export interface HitEvent {
  type: "hit";
  player: number;
  attacker: number;
  /** Centro del jugador golpeado (punto de impacto aproximado). */
  x: number;
  y: number;
  damageDelta: number;
}

export interface HeavyHitEvent {
  type: "heavyHit";
  player: number;
  attacker: number;
  x: number;
  y: number;
  damageDelta: number;
  /** Knockback estimado (px/s) = |vel| tras el golpe. */
  knockback: number;
  /** k = clamp(knockback / KB_MAX_HEAVY_FULL, 0, 1). */
  knockbackFactor: number;
  /** Dirección unitaria del knockback (desde la velocidad). */
  dirX: number;
  dirY: number;
}

export interface StunEvent {
  type: "stun";
  player: number;
  /** true = empieza el aturdimiento, false = termina. */
  active: boolean;
}

export interface ChargeEvent {
  type: "charge";
  player: number;
  /** true mientras carga (cada llamada); false en el flanco de bajada. */
  active: boolean;
  /** Proporción de carga [0..1] (0 cuando active = false). */
  ratio: number;
}

export interface FuryEvent {
  type: "fury";
  player: number;
  active: boolean;
}

export interface KoEvent {
  type: "ko";
  player: number;
  edge: KoEdge;
  /** Posición del centro del jugador recortada a la blast zone. */
  x: number;
  y: number;
}

export type VisualEvent =
  | HitEvent
  | HeavyHitEvent
  | StunEvent
  | ChargeEvent
  | FuryEvent
  | KoEvent;

// ---------------------------------------------------------------------------
// Constantes derivadas del motor (lectura)
// ---------------------------------------------------------------------------

/** Knockback base máximo de un fuerte a carga completa. */
export const KB_MAX_HEAVY_FULL: number =
  Math.max(...Object.values(HEAVY_ATTACKS).map((d) => d.knockback)) *
  CHARGE.maxKnockbackMult;

/** Umbral de daño a partir del cual, sin atacante conocido, se asume fuerte. */
export const HEAVY_DAMAGE_THRESHOLD: number = Math.min(
  ...Object.values(HEAVY_ATTACKS).map((d) => d.damage),
) * 0.8;

export function knockbackFactor(kb: number): number {
  const k = kb / KB_MAX_HEAVY_FULL;
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

export interface BlastZoneLike {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Borde de salida de un KO: el lado de la blast zone con mayor exceso de la
 * caja del jugador (px fuera del límite).
 */
export function koEdge(
  box: { x: number; y: number; w: number; h: number },
  zone: BlastZoneLike = BLAST_ZONE,
): KoEdge {
  const excess: [KoEdge, number][] = [
    ["left", zone.left - (box.x + box.w)],
    ["right", box.x - zone.right],
    ["top", zone.top - (box.y + box.h)],
    ["bottom", box.y - zone.bottom],
  ];
  let best = excess[0];
  for (let i = 1; i < excess.length; i++) if (excess[i][1] > best[1]) best = excess[i];
  return best[0];
}

// ---------------------------------------------------------------------------
// Estado copiado
// ---------------------------------------------------------------------------

/** Copia plana de los campos de un combatiente que usa el detector. */
export interface FighterState {
  index: number;
  lives: number;
  alive: boolean;
  isDead: boolean;
  lastHitBy: number;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  damage: number;
  hitFlash: number;
  stunned: boolean;
  charging: boolean;
  chargeRatio: number;
  furyActive: boolean;
  attackKind: string | null;
  deaths: number;
}

export function captureFighter(f: FighterLike): FighterState {
  const p = f.player;
  return {
    index: f.index,
    lives: f.lives,
    alive: f.alive,
    isDead: f.isDead,
    lastHitBy: f.lastHitBy,
    x: p.pos.x,
    y: p.pos.y,
    w: p.width,
    h: p.height,
    vx: p.vel.x,
    vy: p.vel.y,
    damage: p.damage,
    hitFlash: p.hitFlash,
    stunned: p.stunned,
    charging: p.charging,
    chargeRatio: p.chargeRatio,
    furyActive: p.furyActive,
    attackKind: p.attack ? p.attack.def.kind : null,
    deaths: p.stats ? p.stats.deaths : -1,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Diff puro entre dos estados copiados. Los combatientes se emparejan por
 * `index`; uno sin estado previo no genera eventos.
 */
export function diffStates(
  prev: readonly FighterState[],
  curr: readonly FighterState[],
): VisualEvent[] {
  const events: VisualEvent[] = [];
  const prevByIdx = new Map<number, FighterState>();
  for (const s of prev) prevByIdx.set(s.index, s);
  const currByIdx = new Map<number, FighterState>();
  for (const s of curr) currByIdx.set(s.index, s);

  for (const c of curr) {
    const p = prevByIdx.get(c.index);
    if (!p) continue;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;

    // KO: muerte contada, vida perdida o eliminación.
    const died =
      (c.deaths >= 0 && p.deaths >= 0 && c.deaths > p.deaths) ||
      (c.deaths < 0 && (c.lives < p.lives || (p.alive && !c.alive)));
    if (died) {
      events.push({
        type: "ko",
        player: c.index,
        edge: koEdge({ x: c.x, y: c.y, w: c.w, h: c.h }),
        x: clamp(cx, BLAST_ZONE.left, BLAST_ZONE.right),
        y: clamp(cy, BLAST_ZONE.top, BLAST_ZONE.bottom),
      });
    }

    // Impacto: sube el daño o flanco de subida de hitFlash. Uno por jugador y tick.
    const damageDelta = c.damage - p.damage;
    if (!died && (damageDelta > 0 || c.hitFlash > p.hitFlash)) {
      const attacker = c.lastHitBy;
      const atk = attacker >= 0 ? currByIdx.get(attacker) : undefined;
      const kind = atk?.attackKind ?? null;
      const heavy =
        kind !== null ? kind === "heavy" : damageDelta >= HEAVY_DAMAGE_THRESHOLD;
      const dd = Math.max(0, damageDelta);
      if (heavy) {
        const kb = Math.hypot(c.vx, c.vy);
        events.push({
          type: "heavyHit",
          player: c.index,
          attacker,
          x: cx,
          y: cy,
          damageDelta: dd,
          knockback: kb,
          knockbackFactor: knockbackFactor(kb),
          dirX: kb > 0 ? c.vx / kb : 0,
          dirY: kb > 0 ? c.vy / kb : 0,
        });
      } else {
        events.push({ type: "hit", player: c.index, attacker, x: cx, y: cy, damageDelta: dd });
      }
    }

    if (c.stunned !== p.stunned) events.push({ type: "stun", player: c.index, active: c.stunned });

    if (c.charging) {
      events.push({ type: "charge", player: c.index, active: true, ratio: clamp(c.chargeRatio, 0, 1) });
    } else if (p.charging) {
      events.push({ type: "charge", player: c.index, active: false, ratio: 0 });
    }

    if (c.furyActive !== p.furyActive) {
      events.push({ type: "fury", player: c.index, active: c.furyActive });
    }
  }
  return events;
}

export interface EventDetector {
  /** Compara con la llamada anterior y devuelve los eventos nuevos. */
  detect(fighters: readonly FighterLike[]): VisualEvent[];
  /** Olvida el estado previo (cambio de partida, salto en repetición). */
  reset(): void;
}

export function createEventDetector(): EventDetector {
  let prev: FighterState[] | null = null;
  return {
    detect(fighters) {
      const curr = fighters.map(captureFighter);
      const events = prev ? diffStates(prev, curr) : [];
      prev = curr;
      return events;
    },
    reset() {
      prev = null;
    },
  };
}
