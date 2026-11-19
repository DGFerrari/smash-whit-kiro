import type { AABB } from "../core/types.ts";
import type { ProjectileDef, ProjectileKind } from "./attacks.ts";

/**
 * Proyectil en vuelo (determinista: solo depende de su estado y del dt fijo).
 * Lo crea el World cuando un ataque con `projectile` entra en fase activa.
 */
export class Projectile {
  x: number;
  y: number;
  /** Posición del paso anterior (para interpolar en el render). */
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  readonly w: number;
  readonly h: number;
  readonly kind: ProjectileKind;
  readonly gravity: number;
  readonly pierce: boolean;
  readonly bounce: boolean;
  readonly knockbackUp: number;
  damage: number;
  knockback: number;
  /** Pasos de vida restantes. */
  life: number;
  /** Índice del combatiente dueño (cambia si lo reflejan). */
  owner: number;
  /** Ya golpeados por este proyectil (no repite objetivo). */
  readonly hit = new Set<object>();
  /** ¿Marcado para eliminar al final del paso? */
  dead = false;
  /** Veces que lo han reflejado (para no hacer ping-pong infinito). */
  reflections = 0;

  constructor(def: ProjectileDef, owner: number, x: number, y: number, facing: 1 | -1, dmgMult: number, kbMult: number) {
    this.kind = def.kind;
    this.w = def.w;
    this.h = def.h;
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.vx = facing * def.speed;
    this.vy = def.vy ?? 0;
    this.gravity = def.gravity ?? 0;
    this.pierce = !!def.pierce;
    this.bounce = !!def.bounce;
    this.knockbackUp = def.knockbackUp;
    this.damage = def.damage * dmgMult;
    this.knockback = def.knockback * kbMult;
    this.life = def.life;
    this.owner = owner;
  }

  get box(): AABB {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  /** Sentido horizontal del vuelo (para el knockback). */
  get facing(): 1 | -1 {
    return this.vx < 0 ? -1 : 1;
  }

  step(dt: number): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life--;
    if (this.life <= 0) this.dead = true;
  }
}
