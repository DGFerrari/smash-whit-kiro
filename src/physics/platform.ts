import type { AABB } from "../core/types.ts";

/**
 * Plataforma del nivel.
 *
 * - Sólida (oneWay = false): colisiona por los cuatro lados.
 * - Atravesable / one-way (oneWay = true): solo colisiona desde ARRIBA cuando
 *   el jugador cae sobre ella. Se puede saltar a través desde abajo y apoyarse
 *   encima. Típica del género (las plataformas flotantes de Smash).
 */
export class Platform {
  readonly box: AABB;
  readonly oneWay: boolean;

  constructor(x: number, y: number, w: number, h: number, oneWay = false) {
    this.box = { x, y, w, h };
    this.oneWay = oneWay;
  }
}
