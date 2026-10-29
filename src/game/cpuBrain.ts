import { BLAST_ZONE } from "../config.ts";
import { createInputState, type InputState } from "../core/input.ts";
import type { Player } from "../entities/player.ts";
import type { Platform } from "../physics/platform.ts";

/**
 * IA simple para la CPU. Produce un InputState a partir del estado del mundo.
 *
 * DISEÑO Y DETERMINISMO: esta función NO usa aleatoriedad ni tiempo real; es
 * una función (casi) pura del estado del mundo. Eso es importante porque la
 * simulación es determinista y los replays se reproducen re-simulando: si la
 * IA decidiera al azar, el replay no cuadraría. El único estado que guarda es
 * el CpuBrain (temporizadores internos que avanzan con dt fijo), que también es
 * determinista.
 *
 * Prioridades (de más a menos urgente):
 *   1. No caerse: si está fuera de la isla o volando hacia el vacío, recupera
 *      hacia el centro (mover + saltar + fuerte-arriba como resorte).
 *   2. Defender: si el rival está atacando y cerca, escudo/esquiva.
 *   3. Atacar: si el rival está a distancia de golpe, pega (ligero de cerca,
 *      fuerte si el rival ya tiene daño alto y estamos en el suelo).
 *   4. Acercarse: si no, camina hacia el rival manteniendo una distancia.
 */
export class CpuBrain {
  /** Margen horizontal seguro respecto al centro de la isla (px de mundo). */
  private readonly out: InputState = createInputState();

  /** Antirrebote de salto: pasos restantes antes de poder re-saltar. */
  private jumpCooldown = 0;
  /** Antirrebote de esquiva/escudo. */
  private dodgeCooldown = 0;
  /** Antirrebote de ataque, para no spamear. */
  private attackCooldown = 0;
  /** Estado del mantenido del fuerte: pasos que llevamos cargando (0 = no). */
  private holdingHeavy = 0;

  /**
   * Calcula el input de la CPU para este paso.
   * @param me cuerpo de la CPU.
   * @param foe cuerpo del rival (o null si no hay).
   * @param platforms plataformas efectivas del escenario.
   */
  think(me: Player, foe: Player | null, platforms: Platform[]): InputState {
    const s = resetInput(this.out);

    // Decrementa antirrebotes (pasos de física).
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (this.dodgeCooldown > 0) this.dodgeCooldown--;
    if (this.attackCooldown > 0) this.attackCooldown--;

    // Si está aturdido, no puede hacer nada útil: input neutro.
    if (me.stunned) {
      this.holdingHeavy = 0;
      return s;
    }

    const meCx = me.pos.x + me.width / 2;
    const meCy = me.pos.y + me.height / 2;

    // --- 1) Recuperación: ¿estamos en peligro de caer? ---
    const safe = safeZone(platforms);
    const danger = this.isInDanger(me, meCx, safe);
    if (danger) {
      this.recover(s, meCx, meCy, safe);
      return s;
    }

    if (!foe) return s; // sin rival, nos quedamos quietos

    const foeCx = foe.pos.x + foe.width / 2;
    const foeCy = foe.pos.y + foe.height / 2;
    const dx = foeCx - meCx;
    const dy = foeCy - meCy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const dir: 1 | -1 = dx >= 0 ? 1 : -1;

    // --- 2) Defensa: el rival ataca y está cerca -> escudo o esquiva ---
    const foeThreat = foe.attacking && adx < 90 && ady < 90;
    if (foeThreat && this.dodgeCooldown === 0) {
      // En suelo: escudo (bloquea). En el aire: esquiva (shieldPressed aéreo).
      s.shieldHeld = true;
      s.shieldPressed = true;
      // Nos apartamos un poco del rival mientras defendemos.
      s.moveX = -dir;
      this.dodgeCooldown = 32;
      this.holdingHeavy = 0;
      return s;
    }

    // --- 3) Ataque: a rango de golpe ---
    const inRange = adx < 72 && ady < 70;
    if (inRange) {
      // Mirar/orientar hacia el rival.
      s.moveX = 0;
      // Apuntar arriba/abajo si el rival está claramente por encima/debajo.
      if (dy < -40) s.moveY = -1;
      else if (dy > 40) s.moveY = 1;

      // Fuerte si el rival ya tiene daño alto y estamos en el suelo (remate);
      // si no, ligero rápido.
      const wantHeavy = me.onGround && foe.damage >= 60;
      if (wantHeavy) {
        // Cargamos el fuerte unos pasos y lo soltamos.
        this.holdingHeavy++;
        if (this.holdingHeavy < 10) {
          s.heavyHeld = true;
        } else {
          s.heavyReleased = true; // lanza el fuerte cargado
          this.holdingHeavy = 0;
          this.attackCooldown = 20;
        }
        // Mientras carga, se orienta hacia el rival.
        s.moveX = 0;
        this.faceFoe(me, dir);
        return s;
      }

      if (this.attackCooldown === 0) {
        s.lightPressed = true;
        this.attackCooldown = 14;
      }
      this.faceFoe(me, dir);
      this.holdingHeavy = 0;
      return s;
    }

    // --- 4) Acercarse ---
    this.holdingHeavy = 0;
    // Mantener una distancia mínima: si está lejos, acercarse; muy cerca, quieto.
    if (adx > 60) {
      s.moveX = dir;
    }
    // Si el rival está por encima y estamos en el suelo, saltar para alcanzarlo.
    if (dy < -70 && me.onGround && this.jumpCooldown === 0) {
      s.jumpPressed = true;
      s.jumpHeld = true;
      this.jumpCooldown = 22;
    }
    return s;
  }

  /** ¿Está la CPU en peligro de caerse al vacío? */
  private isInDanger(me: Player, meCx: number, safe: SafeZone): boolean {
    // Fuera del margen horizontal seguro de la isla.
    const outsideX = meCx < safe.left || meCx > safe.right;
    // Por debajo del nivel del suelo y sin pisar nada (cayendo al vacío).
    const belowGround = me.pos.y + me.height > safe.groundY + 40 && !me.onGround;
    // Cerca del borde letal inferior.
    const nearBottom = me.pos.y > BLAST_ZONE.bottom - 400;
    return (outsideX && !me.onGround) || belowGround || nearBottom;
  }

  /** Vuelve hacia el centro de la isla, saltando/usando el fuerte-arriba. */
  private recover(s: InputState, meCx: number, meCy: number, safe: SafeZone): void {
    const center = (safe.left + safe.right) / 2;
    s.moveX = meCx < center ? 1 : -1;

    // Si vamos cayendo, intentamos remontar: primero salto; si ya sin saltos,
    // un fuerte-arriba (resorte) para recuperar altura.
    if (meCy > safe.groundY - 20) {
      if (this.jumpCooldown === 0) {
        s.jumpPressed = true;
        s.jumpHeld = true;
        this.jumpCooldown = 16;
      } else {
        // Fuerte-arriba como recuperación aérea.
        s.moveY = -1;
        s.heavyReleased = true;
      }
    }
  }

  /** Orienta el facing de la CPU hacia el rival (sin movernos). */
  private faceFoe(me: Player, dir: 1 | -1): void {
    me.facing = dir;
  }
}

interface SafeZone {
  left: number;
  right: number;
  groundY: number;
}

/**
 * Zona "segura" horizontal: el tramo que ocupan las plataformas SÓLIDAS (no
 * one-way), con un margen. La CPU intenta mantenerse dentro.
 */
function safeZone(platforms: Platform[]): SafeZone {
  let left = Infinity;
  let right = -Infinity;
  let groundY = 0;
  for (const p of platforms) {
    if (p.oneWay) continue; // solo el suelo sólido define "tierra firme"
    left = Math.min(left, p.box.x);
    right = Math.max(right, p.box.x + p.box.w);
    groundY = Math.max(groundY, p.box.y);
  }
  if (!Number.isFinite(left)) {
    // Sin suelo sólido (no debería pasar): usa el centro del mundo.
    return { left: -300, right: 300, groundY: 360 };
  }
  // Margen interior: la CPU considera peligroso acercarse demasiado al borde.
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
