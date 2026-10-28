import type { AABB } from "../core/types.ts";
import { CHARGE, type AttackDef } from "./attacks.ts";

export type AttackPhase = "startup" | "active" | "recovery" | "done";

/**
 * Un ataque en ejecución. Avanza por fases en pasos de física, calcula la
 * hitbox en coordenadas de mundo durante la fase activa y aplica el escalado
 * por carga (solo relevante en los fuertes).
 */
export class ActiveAttack {
  phase: AttackPhase = "startup";
  private timer = 0; // pasos transcurridos en la fase actual

  /** Factor de carga aplicado [0..1] (0 = sin carga). */
  readonly charge: number;

  /** Daño y knockback efectivos ya escalados por carga. */
  readonly damage: number;
  readonly knockback: number;

  /** Hitbox activa en coords de mundo, o null si no está en fase activa. */
  hitbox: AABB | null = null;

  /** Conjunto de objetivos ya golpeados por este ataque (no golpea 2 veces). */
  private readonly hitTargets = new Set<object>();

  /** ¿Ya golpeó a este objetivo? Si no, lo marca y devuelve false. */
  hasHit(target: object): boolean {
    if (this.hitTargets.has(target)) return true;
    this.hitTargets.add(target);
    return false;
  }

  /** Dirección a la que miraba el atacante (para el sentido del knockback). */
  get attackerFacing(): 1 | -1 {
    return this.facing;
  }

  constructor(
    readonly def: AttackDef,
    /** 1 derecha, -1 izquierda: hacia dónde miraba el jugador al atacar. */
    private readonly facing: 1 | -1,
    charge01: number,
  ) {
    this.charge = def.kind === "heavy" ? clamp01(charge01) : 0;

    const dMult = 1 + (CHARGE.maxDamageMult - 1) * this.charge;
    const kMult = 1 + (CHARGE.maxKnockbackMult - 1) * this.charge;
    this.damage = def.damage * dMult;
    this.knockback = def.knockback * kMult;
  }

  /** Factor de tamaño de la hitbox por carga. */
  private get sizeMult(): number {
    return 1 + (CHARGE.maxSizeMult - 1) * this.charge;
  }

  /**
   * Avanza un paso. Recibe la caja del jugador para posicionar la hitbox.
   * Devuelve true mientras el ataque sigue vivo (no "done").
   */
  step(playerBox: AABB): boolean {
    this.timer++;

    if (this.phase === "startup") {
      this.hitbox = null;
      if (this.timer >= this.def.startup) this.enter("active");
    } else if (this.phase === "active") {
      this.hitbox = this.computeHitbox(playerBox);
      if (this.timer >= this.def.active) this.enter("recovery");
    } else if (this.phase === "recovery") {
      this.hitbox = null;
      if (this.timer >= this.def.recovery) this.enter("done");
    }

    return this.phase !== "done";
  }

  /** ¿El jugador puede volver a actuar? (fin de recovery) */
  get isDone(): boolean {
    return this.phase === "done";
  }

  /**
   * ¿Se puede cancelar este ataque con otro? Permitimos cancelar en recovery
   * (y en los últimos frames del active) para encadenar ataques con fluidez.
   */
  get cancelable(): boolean {
    return this.phase === "recovery";
  }

  private enter(phase: AttackPhase): void {
    this.phase = phase;
    this.timer = 0;
  }

  /** Coloca la hitbox relativa al jugador según la dirección del ataque. */
  private computeHitbox(pb: AABB): AABB {
    const s = this.sizeMult;
    const w = this.def.hitbox.w * s;
    const h = this.def.hitbox.h * s;
    const reach = this.def.hitbox.reach;

    const cx = pb.x + pb.w / 2;
    const cy = pb.y + pb.h / 2;

    switch (this.def.dir) {
      case "up":
        return { x: cx - w / 2, y: pb.y - reach - h, w, h };
      case "down":
        return { x: cx - w / 2, y: pb.y + pb.h + reach, w, h };
      case "side":
      case "neutral":
      default: {
        // Hacia donde mira el jugador.
        const x =
          this.facing === 1
            ? pb.x + pb.w + reach
            : pb.x - reach - w;
        return { x, y: cy - h / 2, w, h };
      }
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
