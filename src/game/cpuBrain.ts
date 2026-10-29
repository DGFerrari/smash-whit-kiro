import { BLAST_ZONE } from "../config.ts";
import { createInputState, type InputState } from "../core/input.ts";
import type { Player } from "../entities/player.ts";
import type { Platform } from "../physics/platform.ts";

/**
 * IA simple para la CPU. Produce un InputState a partir del estado del mundo.
 *
 * DETERMINISMO: función (casi) pura del estado del mundo, sin azar ni reloj.
 * Su único estado interno son temporizadores que avanzan con el dt fijo, así
 * que los replays con CPU se reproducen igual.
 *
 * SALTO CORRECTO (lo que fallaba antes): el salto de este juego es VARIABLE
 * (sube más cuanto más tiempo mantienes el botón) y hay DOBLE SALTO. Por eso la
 * IA no pulsa salto un frame suelto: cuando decide saltar, MANTIENE jumpHeld
 * durante una ráfaga de frames (jumpHoldSteps) para alcanzar altura. El flanco
 * jumpPressed solo se emite en el primer frame de cada salto; los siguientes
 * frames de la ráfaga solo mantienen jumpHeld. Para el doble salto emite otro
 * jumpPressed cuando ya está en el aire y aún le quedan saltos.
 *
 * Prioridades: 1) no caerse (recuperar), 2) defender, 3) atacar, 4) acercarse.
 */
export class CpuBrain {
  private readonly out: InputState = createInputState();

  /** Frames que quedan MANTENIENDO el salto actual (ráfaga de ascenso). */
  private jumpHoldSteps = 0;
  /** Cooldown tras aterrizar para no re-saltar al instante. */
  private groundJumpCooldown = 0;
  /** ¿Ya hemos consumido el doble salto en esta caída? */
  private usedDoubleJump = false;

  private dodgeCooldown = 0;
  private attackCooldown = 0;
  private holdingHeavy = 0;

  think(me: Player, foe: Player | null, platforms: Platform[]): InputState {
    const s = resetInput(this.out);

    if (this.dodgeCooldown > 0) this.dodgeCooldown--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.groundJumpCooldown > 0) this.groundJumpCooldown--;

    // Al tocar suelo se resetea el estado de salto aéreo.
    if (me.onGround) {
      this.usedDoubleJump = false;
      if (this.jumpHoldSteps > 0 && me.vel.y >= 0) this.jumpHoldSteps = 0;
    }

    if (me.stunned) {
      this.jumpHoldSteps = 0;
      this.holdingHeavy = 0;
      return s;
    }

    const meCx = me.pos.x + me.width / 2;
    const meCy = me.pos.y + me.height / 2;

    // --- 1) Recuperación: ¿en peligro de caer? ---
    const safe = safeZone(platforms);
    if (this.isInDanger(me, meCx, meCy, safe)) {
      this.recover(s, me, meCx, safe);
      return s;
    }

    // Fuera de peligro: si teníamos una ráfaga de salto en marcha, la mantenemos
    // hasta agotarla (para completar la altura del salto variable).
    if (this.jumpHoldSteps > 0) {
      this.continueJump(s, me);
    }

    if (!foe) {
      this.flushJump(s, me);
      return s;
    }

    const foeCx = foe.pos.x + foe.width / 2;
    const foeCy = foe.pos.y + foe.height / 2;
    const dx = foeCx - meCx;
    const dy = foeCy - meCy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const dir: 1 | -1 = dx >= 0 ? 1 : -1;

    // --- 2) Defensa ---
    const foeThreat = foe.attacking && adx < 90 && ady < 90;
    if (foeThreat && this.dodgeCooldown === 0) {
      s.shieldHeld = true;
      s.shieldPressed = true;
      s.moveX = -dir;
      this.dodgeCooldown = 32;
      this.holdingHeavy = 0;
      return s;
    }

    // --- 3) Ataque a rango ---
    const inRange = adx < 72 && ady < 70;
    if (inRange) {
      me.facing = dir;
      if (dy < -40) s.moveY = -1;
      else if (dy > 40) s.moveY = 1;

      const wantHeavy = me.onGround && foe.damage >= 60;
      if (wantHeavy) {
        this.holdingHeavy++;
        if (this.holdingHeavy < 10) {
          s.heavyHeld = true;
        } else {
          s.heavyReleased = true;
          this.holdingHeavy = 0;
          this.attackCooldown = 20;
        }
        return s;
      }
      if (this.attackCooldown === 0) {
        s.lightPressed = true;
        this.attackCooldown = 14;
      }
      this.holdingHeavy = 0;
      return s;
    }

    // --- 4) Acercarse ---
    this.holdingHeavy = 0;
    if (adx > 60) s.moveX = dir;

    // Saltar para alcanzar a un rival por encima: salto sostenido + doble salto.
    if (dy < -70) {
      this.wantJumpToward(s, me);
    }

    this.flushJump(s, me);
    return s;
  }

  // --- Lógica de salto ------------------------------------------------------

  /**
   * Pide iniciar/continuar un salto hacia arriba. Si está en suelo, arranca una
   * ráfaga de ascenso; si está en el aire y le queda doble salto y ya no sube,
   * gasta el doble salto. La ráfaga la mantiene continueJump en los frames
   * siguientes.
   */
  private wantJumpToward(s: InputState, me: Player): void {
    if (this.jumpHoldSteps > 0) return; // ya estamos en una ráfaga

    if (me.onGround && this.groundJumpCooldown === 0) {
      this.startJump(s, 12); // ráfaga larga = salto alto
      this.groundJumpCooldown = 10;
    } else if (
      !me.onGround &&
      !this.usedDoubleJump &&
      me.airJumpsLeft > 0 &&
      me.vel.y > 40 // ya cayendo o estancado: momento de doble saltar
    ) {
      this.startJump(s, 10);
      this.usedDoubleJump = true;
    }
  }

  /** Arranca una ráfaga de salto: primer frame con flanco pressed. */
  private startJump(s: InputState, holdSteps: number): void {
    s.jumpPressed = true;
    s.jumpHeld = true;
    this.jumpHoldSteps = holdSteps;
  }

  /** Mantiene jumpHeld durante la ráfaga (salto variable = más altura). */
  private continueJump(s: InputState, me: Player): void {
    this.jumpHoldSteps--;
    // Mientras sigamos subiendo, mantenemos el botón para ganar altura.
    if (me.vel.y < 0) {
      s.jumpHeld = true;
    } else {
      // Ya no subimos: soltar para no desperdiciar la ráfaga.
      this.jumpHoldSteps = 0;
    }
  }

  /** Si no se pidió salto este frame pero había ráfaga, la refleja igualmente. */
  private flushJump(s: InputState, me: Player): void {
    if (this.jumpHoldSteps > 0 && me.vel.y < 0) s.jumpHeld = true;
  }

  // --- Recuperación ---------------------------------------------------------

  private isInDanger(
    me: Player,
    meCx: number,
    meCy: number,
    safe: SafeZone,
  ): boolean {
    const outsideX = meCx < safe.left || meCx > safe.right;
    const belowGround = meCy > safe.groundY + 30 && !me.onGround;
    const nearBottom = me.pos.y > BLAST_ZONE.bottom - 450;
    return (outsideX && !me.onGround) || belowGround || nearBottom;
  }

  /**
   * Vuelve al escenario. Secuencia de recuperación:
   *   1) Ir horizontalmente hacia el centro SIEMPRE.
   *   2) Mientras queden saltos (suelo o doble salto), saltar SOSTENIDO para
   *      ganar la máxima altura.
   *   3) Cuando ya no queden saltos, usar el fuerte-arriba (resorte) como
   *      último recurso para remontar.
   */
  private recover(s: InputState, me: Player, meCx: number, safe: SafeZone): void {
    const center = (safe.left + safe.right) / 2;
    s.moveX = meCx < center ? 1 : -1;
    me.facing = s.moveX > 0 ? 1 : -1;

    // Continuar una ráfaga de salto en curso (mantener altura).
    if (this.jumpHoldSteps > 0) {
      this.continueJump(s, me);
      return;
    }

    // Si estamos por debajo del nivel del suelo (o cayendo), intentar remontar.
    const needHeight = me.pos.y + me.height > safe.groundY - 10 || me.vel.y > 0;
    if (!needHeight) return;

    if (me.onGround && this.groundJumpCooldown === 0) {
      this.startJump(s, 12);
      this.groundJumpCooldown = 10;
    } else if (!me.onGround && !this.usedDoubleJump && me.airJumpsLeft > 0) {
      // Doble salto de recuperación.
      this.startJump(s, 12);
      this.usedDoubleJump = true;
    } else if (me.outOfJumps && !me.outOfHeavy) {
      // Sin saltos: fuerte-arriba como resorte (gasta un uso aéreo del fuerte).
      s.moveY = -1;
      s.heavyReleased = true;
    }
  }
}

interface SafeZone {
  left: number;
  right: number;
  groundY: number;
}

function safeZone(platforms: Platform[]): SafeZone {
  let left = Infinity;
  let right = -Infinity;
  let groundY = 0;
  for (const p of platforms) {
    if (p.oneWay) continue;
    left = Math.min(left, p.box.x);
    right = Math.max(right, p.box.x + p.box.w);
    groundY = Math.max(groundY, p.box.y);
  }
  if (!Number.isFinite(left)) {
    return { left: -300, right: 300, groundY: 360 };
  }
  const margin = 70;
  return { left: left + margin, right: right - margin, groundY };
}

function resetInput(s: InputState): InputState {
  s.moveX = 0;
  s.moveY = 0;
  s.jumpHeld = false;
  s.jumpPressed = false;
  s.lightPressed = false;
  s.heavyHeld = false;
  s.heavyReleased = false;
  s.shieldHeld = false;
  s.shieldPressed = false;
  return s;
}
