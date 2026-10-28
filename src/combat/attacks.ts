/**
 * Datos de ataques (frame data) al estilo Brawlhalla.
 *
 * Cada ataque se divide en tres fases medidas en PASOS de física (a 60 Hz,
 * 1 paso = 1/60 s):
 *   - startup:  anticipación, la hitbox aún no golpea.
 *   - active:   la hitbox está activa y puede golpear.
 *   - recovery: terminación, no puedes actuar ni volver a atacar.
 *
 * La hitbox se coloca relativa al jugador según la dirección del ataque.
 */

/** Dirección del ataque (según hacia dónde apuntas al iniciarlo). */
export type AttackDir = "side" | "up" | "down" | "neutral";

/** Tipo de ataque. */
export type AttackKind = "light" | "heavy";

/** Geometría de la hitbox relativa al jugador (en px de mundo). */
export interface HitboxShape {
  /**
   * Offset del borde "cercano" de la hitbox respecto al borde del jugador en la
   * dirección de ataque. Para ataques laterales se aplica en X (hacia facing);
   * para arriba/abajo en Y.
   */
  reach: number;
  /** Ancho y alto de la hitbox. */
  w: number;
  h: number;
}

/** Definición completa de un ataque. */
export interface AttackDef {
  kind: AttackKind;
  dir: AttackDir;
  startup: number; // pasos
  active: number; // pasos
  recovery: number; // pasos
  damage: number;
  /** Fuerza de knockback (px/s) aplicada al objetivo. */
  knockback: number;
  /** Componente vertical del knockback (0..1 del total hacia arriba). */
  knockbackUp: number;
  hitbox: HitboxShape;
}

/**
 * Ataques LIGEROS: rápidos, poco daño/knockback, sin carga.
 * Indexados por dirección.
 */
export const LIGHT_ATTACKS: Record<AttackDir, AttackDef> = {
  neutral: {
    kind: "light",
    dir: "neutral",
    startup: 3,
    active: 4,
    recovery: 7,
    damage: 6,
    knockback: 260,
    knockbackUp: 0.3,
    hitbox: { reach: 4, w: 46, h: 40 },
  },
  side: {
    kind: "light",
    dir: "side",
    startup: 4,
    active: 4,
    recovery: 8,
    damage: 8,
    knockback: 320,
    knockbackUp: 0.25,
    hitbox: { reach: 4, w: 56, h: 36 },
  },
  up: {
    kind: "light",
    dir: "up",
    startup: 4,
    active: 5,
    recovery: 8,
    damage: 7,
    knockback: 300,
    knockbackUp: 0.85,
    hitbox: { reach: 4, w: 40, h: 54 },
  },
  down: {
    kind: "light",
    dir: "down",
    startup: 5,
    active: 4,
    recovery: 9,
    damage: 7,
    knockback: 280,
    knockbackUp: 0.1,
    hitbox: { reach: 4, w: 54, h: 34 },
  },
};

/**
 * Ataques FUERTES (cargables). Son los valores BASE (carga 0). El daño y el
 * knockback escalan con la carga (ver chargeScale). Más lentos y potentes.
 */
export const HEAVY_ATTACKS: Record<AttackDir, AttackDef> = {
  neutral: {
    kind: "heavy",
    dir: "neutral",
    startup: 5,
    active: 5,
    recovery: 12,
    damage: 14,
    knockback: 520,
    knockbackUp: 0.35,
    hitbox: { reach: 6, w: 64, h: 52 },
  },
  side: {
    kind: "heavy",
    dir: "side",
    startup: 6,
    active: 6,
    recovery: 13,
    damage: 16,
    knockback: 620,
    knockbackUp: 0.3,
    hitbox: { reach: 6, w: 80, h: 44 },
  },
  up: {
    kind: "heavy",
    dir: "up",
    startup: 6,
    active: 6,
    recovery: 13,
    damage: 15,
    knockback: 600,
    knockbackUp: 0.9,
    hitbox: { reach: 6, w: 52, h: 74 },
  },
  down: {
    kind: "heavy",
    dir: "down",
    startup: 7,
    active: 5,
    recovery: 14,
    damage: 15,
    knockback: 560,
    knockbackUp: 0.15,
    hitbox: { reach: 6, w: 76, h: 40 },
  },
};

/** Parámetros de la carga del ataque fuerte. */
export const CHARGE = {
  /** Pasos para alcanzar la carga máxima (60 = 1 s). */
  maxChargeSteps: 54,
  /** Multiplicador de daño/knockback a carga máxima (1 = base, 2 = doble). */
  maxDamageMult: 2.2,
  maxKnockbackMult: 1.9,
  /** La hitbox también crece un poco a plena carga. */
  maxSizeMult: 1.35,
} as const;

/**
 * Impulso que el ataque fuerte da al PROPIO jugador (lunge). Sirve para
 * recuperarse de caídas: el fuerte cancela el movimiento y te lanza hacia la
 * dirección del ataque. Como los saltos, hay un número limitado de usos en el
 * aire para que no se pueda volar indefinidamente.
 */
export const HEAVY_LUNGE = {
  /** Impulso horizontal (px/s) para ataques laterales/neutrales. */
  speedX: 620,
  /** Impulso vertical (px/s) para ataque arriba (recuperación clásica). */
  speedUp: 900,
  /** Impulso hacia abajo (px/s) para ataque abajo (picar). */
  speedDown: 700,
  /** Usos del fuerte en el aire antes de tocar suelo/pared. */
  maxAirUses: 2,
} as const;
