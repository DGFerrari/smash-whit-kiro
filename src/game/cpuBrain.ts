import { BLAST_ZONE } from "../config.ts";
import { createInputState, type InputState } from "../core/input.ts";
import type { Player } from "../entities/player.ts";
import type { Platform } from "../physics/platform.ts";
import type { CpuDifficulty } from "./world.ts";

/**
 * IA de la CPU. Produce un InputState a partir del estado del mundo.
 *
 * DETERMINISMO: función del estado del mundo, sin azar ni reloj. Su único estado
 * interno son temporizadores que avanzan con el dt fijo, así que los replays
 * con CPU se reproducen igual.
 *
 * Mecánicas que entiende (lo que fallaba antes):
 *  - SALTO VARIABLE: mantiene jumpHeld durante una ráfaga para ganar altura.
 *  - DOBLE SALTO: emite otro salto en el aire si le queda.
 *  - ESQUIVA AÉREA: shieldPressed en el aire para desplazarse (recuperación y
 *    para acercarse volando).
 *  - FUERTE-ARRIBA / FUERTE DIRECCIONAL: recuperación y remate.
 *  - DROP-THROUGH: pulsar abajo sobre una one-way para caer a través.
 *
 * DIFICULTAD: un perfil ajusta agresividad, defensa, rango y carga del fuerte.
 */

interface DifficultyProfile {
  /** Prob. (0..1) de atacar cuando está a rango. Más bajo = más pasivo. */
  aggression: number;
  /** Prob. (0..1) de defender cuando el rival ataca cerca. */
  defense: number;
  /** Distancia a la que decide acercarse a pegar (px). */
  engageRange: number;
  /** Umbral de daño del rival para preferir fuerte sobre ligero. */
  heavyDamageThreshold: number;
  /** Reactividad: cuántos pasos de cooldown entre ataques (menos = más rápido). */
  attackCooldown: number;
  /** ¿Persigue al rival al borde para rematarlo fuera? (edgeguard). */
  edgeguard: boolean;
}

const PROFILES: Record<CpuDifficulty, DifficultyProfile> = {
  // Fácil: se defiende bien, pero ataca poco y despacio. No acosa.
  easy: {
    aggression: 0.35,
    defense: 0.85,
    engageRange: 90,
    heavyDamageThreshold: 90,
    attackCooldown: 34,
    edgeguard: false,
  },
  // Normal: equilibrada.
  normal: {
    aggression: 0.7,
    defense: 0.6,
    engageRange: 150,
    heavyDamageThreshold: 60,
    attackCooldown: 18,
    edgeguard: false,
  },
  // Difícil: agresiva, te busca, remata y persigue al borde.
  hard: {
    aggression: 0.95,
    defense: 0.55,
    engageRange: 320,
    heavyDamageThreshold: 35,
    attackCooldown: 10,
    edgeguard: true,
  },
};

export class CpuBrain {
  private readonly out: InputState = createInputState();
  private readonly prof: DifficultyProfile;

  /** Frames que quedan manteniendo el salto actual (ráfaga de ascenso). */
  private jumpHoldSteps = 0;
  private groundJumpCooldown = 0;
  private usedDoubleJump = false;
  private usedAirDodgeRecover = false;
  private usedHeavyRecover = false;

  private dodgeCooldown = 0;
  private attackCooldown = 0;
  private holdingHeavy = 0;
  /** Objetivo de carga del fuerte en curso (frames). Varía para dar variedad. */
  private heavyTargetHold = 0;
  /** Contador determinista para alternar decisiones (en vez de azar). */
  private tick = 0;

  /**
   * Offset de "personalidad" [0..n) para desincronizar varias CPUs. Desfasa los
   * ritmos de ataque y los patrones de carga, para que no hagan todas lo mismo
   * a la vez cuando están pegadas al mismo rival. Es determinista (lo fija el
   * índice del fighter), así no rompe replays.
   */
  private readonly variation: number;

  constructor(difficulty: CpuDifficulty = "normal", variation = 0) {
    this.prof = PROFILES[difficulty];
    this.variation = variation;
    // Arrancamos el tick desfasado para que cada CPU no actúe en el mismo frame.
    this.tick = variation * 11;
  }

  think(me: Player, foe: Player | null, platforms: Platform[]): InputState {
    const s = resetInput(this.out);
    this.tick++;

    if (this.dodgeCooldown > 0) this.dodgeCooldown--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.groundJumpCooldown > 0) this.groundJumpCooldown--;

    if (me.onGround) {
      this.usedDoubleJump = false;
      this.usedAirDodgeRecover = false;
      this.usedHeavyRecover = false;
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

    if (this.jumpHoldSteps > 0) this.continueJump(s, me);

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
    if (foeThreat && this.dodgeCooldown === 0 && this.chance(this.prof.defense)) {
      s.shieldHeld = true;
      s.shieldPressed = true;
      s.moveX = -dir; // apartarse
      this.dodgeCooldown = 30;
      this.holdingHeavy = 0;
      return s;
    }

    // --- 3) Ataque a rango ---
    const inRange = adx < 74 && ady < 72;
    if (inRange) {
      me.facing = dir;
      if (dy < -40) s.moveY = -1;
      else if (dy > 40) s.moveY = 1;

      // ¿Fuerte o ligero? Fuerte si el rival ya tiene daño (según perfil) y
      // estamos en el suelo; la CARGA varía para dar golpes poco/muy cargados.
      const wantHeavy =
        me.onGround && foe.damage >= this.prof.heavyDamageThreshold;
      if (wantHeavy) {
        this.doChargedHeavy(s, me, dir);
        return s;
      }
      if (this.attackCooldown === 0 && this.chance(this.prof.aggression)) {
        s.lightPressed = true;
        // Cooldown con desfase por personalidad: cada CPU ataca a su ritmo.
        this.attackCooldown = this.prof.attackCooldown + (this.variation % 3) * 5;
      }
      this.holdingHeavy = 0;
      return s;
    }

    // --- 4) Acercarse / merodear (según agresividad/alcance del perfil) ---
    this.holdingHeavy = 0;
    // Distancia de "pegado" un poco distinta por CPU, para no apilarse todas en
    // el mismo punto haciendo lo mismo.
    const keepDist = 56 + (this.variation % 3) * 16;
    const shouldEngage = adx < this.prof.engageRange || this.prof.edgeguard;
    if (shouldEngage && adx > keepDist) {
      s.moveX = dir;
    } else if (!shouldEngage && adx < 120) {
      // Perfil pasivo (fácil): mantiene distancia si está muy cerca sin atacar.
      s.moveX = -dir;
    } else {
      // No hay nada urgente y el rival está lejos: MERODEAR en vez de quedarse
      // quieta. Alterna acercarse / alejarse / parar en un ciclo determinista
      // desfasado por personalidad, para que se sienta viva y varíe entre CPUs.
      s.moveX = this.wanderDir(dir);
    }

    // Saltar hacia un rival por encima.
    if (dy < -70) this.wantJumpToward(s, me);
    // Rival claramente por DEBAJO y estamos en el suelo: intentar bajar a través
    // de una plataforma one-way pulsando abajo (si no hay, no pasa nada).
    if (dy > 90 && me.onGround && adx < 120) {
      s.moveY = 1;
    }
    // En difícil, si el rival está fuera de la isla, perseguir para rematar.
    if (this.prof.edgeguard && (foeCx < safe.left || foeCx > safe.right)) {
      s.moveX = dir;
      if (foeCy < meCy - 40) this.wantJumpToward(s, me);
    }

    this.flushJump(s, me);
    return s;
  }

  // --- Ataque fuerte con carga variable -------------------------------------

  /**
   * Carga el fuerte durante un número de frames que varía (determinista) entre
   * un toque y una carga larga, y lo lanza. Da golpes poco y muy cargados.
   */
  private doChargedHeavy(s: InputState, me: Player, dir: 1 | -1): void {
    me.facing = dir;
    if (this.holdingHeavy === 0) {
      // Elegimos objetivo de carga al empezar: alterna corto/medio/largo según
      // un patrón determinista (no azar, para no romper replays). El offset de
      // personalidad desfasa el patrón entre CPUs.
      const seq = [6, 44, 20, 54, 10, 30];
      this.heavyTargetHold = seq[(this.tick + this.variation) % seq.length];
    }
    this.holdingHeavy++;
    if (this.holdingHeavy < this.heavyTargetHold) {
      s.heavyHeld = true;
    } else {
      s.heavyReleased = true;
      this.holdingHeavy = 0;
      this.attackCooldown = this.prof.attackCooldown + 8;
    }
  }

  // --- Salto ----------------------------------------------------------------

  private wantJumpToward(s: InputState, me: Player): void {
    if (this.jumpHoldSteps > 0) return;
    if (me.onGround && this.groundJumpCooldown === 0) {
      this.startJump(s, 12);
      this.groundJumpCooldown = 10;
    } else if (
      !me.onGround &&
      !this.usedDoubleJump &&
      me.airJumpsLeft > 0 &&
      me.vel.y > 40
    ) {
      this.startJump(s, 10);
      this.usedDoubleJump = true;
    }
  }

  private startJump(s: InputState, holdSteps: number): void {
    s.jumpPressed = true;
    s.jumpHeld = true;
    this.jumpHoldSteps = holdSteps;
  }

  private continueJump(s: InputState, me: Player): void {
    this.jumpHoldSteps--;
    if (me.vel.y < 0) s.jumpHeld = true;
    else this.jumpHoldSteps = 0;
  }

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
    // Fuera del tramo de suelo sólido (y en el aire).
    const outsideX = (meCx < safe.left || meCx > safe.right) && !me.onGround;
    // Por debajo del nivel del suelo sin pisar nada.
    const belowGround = meCy > safe.groundY + 20 && !me.onGround;
    const nearBottom = me.pos.y > BLAST_ZONE.bottom - 500;
    // Lanzados hacia fuera cerca del borde (reaccionar PRONTO, con margen amplio).
    const flungOut =
      !me.onGround &&
      ((meCx < safe.left + 90 && me.vel.x < 0) ||
        (meCx > safe.right - 90 && me.vel.x > 0));
    // Pegados a una pared en el aire: SIEMPRE es situación de recuperación, para
    // que el wall jump se dispare y no se quede deslizando.
    const onWall = !me.onGround && me.touchingWall !== 0;
    return outsideX || belowGround || nearBottom || flungOut || onWall;
  }

  /**
   * Recuperación aérea completa, en orden de prioridad para maximizar la vuelta:
   *   1) Siempre empujar horizontalmente hacia el centro.
   *   2) ESQUIVA AÉREA en diagonal hacia el centro (gran desplazamiento) si aún
   *      no la usamos y estamos lejos lateralmente.
   *   3) Salto sostenido (suelo) / DOBLE SALTO (aire) para ganar altura.
   *   4) FUERTE-ARRIBA (resorte) como último recurso cuando no quedan saltos.
   */
  private recover(s: InputState, me: Player, meCx: number, safe: SafeZone): void {
    const center = (safe.left + safe.right) / 2;
    const toCenter: 1 | -1 = meCx < center ? 1 : -1;

    // === PRIORIDAD MÁXIMA: ¿pegados a una pared? ===
    // Si tocamos/deslizamos una pared, el salto se convierte en WALL JUMP, que
    // nos lanza en diagonal ALEJÁNDONOS de la pared (hacia el centro). Esto es
    // lo que fallaba: antes la CPU empujaba contra la pared (activando el wall
    // slide) y se quedaba enganchada deslizándose sin saltar nunca.
    if (!me.onGround && me.touchingWall !== 0) {
      // Para hacer wall jump hay que (a) estar en wall slide y (b) saltar. El
      // wall slide requiere empujar HACIA la pared un frame; luego saltamos.
      const wallDir = me.touchingWall; // -1 pared izq, +1 pared der
      if (me.wallSliding) {
        // Ya estamos agarrados: SALTAR (wall jump). No mantenemos: el impulso
        // diagonal ya nos separa; el lock de wall jump protege el empuje.
        s.jumpPressed = true;
        s.jumpHeld = true;
        this.jumpHoldSteps = 6;
        this.usedDoubleJump = false; // el wall jump recupera saltos
      } else {
        // Tocamos pared pero aún no agarrados: empujar hacia la pared para
        // activar el wall slide (y así poder wall-jumpear el siguiente frame).
        s.moveX = wallDir;
      }
      me.facing = toCenter;
      return;
    }

    // Movimiento horizontal por defecto: hacia el centro.
    s.moveX = toCenter;
    me.facing = toCenter;

    // Continuar una ráfaga de salto en curso.
    if (this.jumpHoldSteps > 0) {
      this.continueJump(s, me);
      return;
    }

    const farOutX = meCx < safe.left - 60 || meCx > safe.right + 60;

    // 1) Esquiva aérea hacia el centro: mucho desplazamiento horizontal, ideal
    // cuando nos han sacado lejos de lado.
    if (!me.onGround && farOutX && !this.usedAirDodgeRecover && !me.outOfJumps) {
      s.shieldPressed = true;
      s.shieldHeld = true;
      s.moveX = toCenter; // dirección de la esquiva
      this.usedAirDodgeRecover = true;
      return;
    }

    // 2) Ganar altura con saltos.
    const needHeight = me.pos.y + me.height > safe.groundY - 10 || me.vel.y > 0;
    if (needHeight) {
      if (me.onGround && this.groundJumpCooldown === 0) {
        this.startJump(s, 12);
        this.groundJumpCooldown = 10;
        return;
      }
      if (!me.onGround && !this.usedDoubleJump && me.airJumpsLeft > 0) {
        this.startJump(s, 12);
        this.usedDoubleJump = true;
        return;
      }
      // 3) Fuerte-arriba como resorte final.
      if (me.outOfJumps && !me.outOfHeavy && !this.usedHeavyRecover) {
        s.moveY = -1;
        s.heavyReleased = true;
        this.usedHeavyRecover = true;
      }
    }
  }

  /**
   * Dirección de merodeo cuando no hay objetivo urgente: un ciclo lento y
   * determinista (acercarse / parar / alejarse / parar) desfasado por la
   * personalidad, para que la CPU se mueva en vez de quedarse plantada y para
   * que varias CPUs no hagan lo mismo a la vez. `toFoe` es la dirección hacia
   * el rival (+1/-1).
   */
  private wanderDir(toFoe: 1 | -1): number {
    // Ciclo de ~160 pasos (~2.6 s) dividido en 4 fases.
    const phase = Math.floor(((this.tick + this.variation * 37) % 160) / 40);
    switch (phase) {
      case 0:
        return toFoe; // se acerca
      case 1:
        return 0; // observa
      case 2:
        return -toFoe as number; // se aleja
      default:
        return 0; // observa
    }
  }

  /** Decisión determinista tipo "probabilidad" usando el tick interno. */
  private chance(p: number): boolean {
    if (p >= 1) return true;
    if (p <= 0) return false;
    // Secuencia determinista repartida: p=0.7 -> ~7 de cada 10 ticks.
    return (this.tick * 7) % 10 < Math.round(p * 10);
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
