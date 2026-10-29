import { FURY, PLAYER, SHIELD } from "../config.ts";
import type { AABB, Vec2 } from "../core/types.ts";
import type { InputState } from "../core/input.ts";
import type { Platform } from "../physics/platform.ts";
import { overlaps } from "../physics/aabb.ts";
import { ActiveAttack } from "../combat/activeAttack.ts";
import {
  CHARGE,
  HEAVY_ATTACKS,
  HEAVY_LUNGE,
  LIGHT_ATTACKS,
  type AttackDir,
} from "../combat/attacks.ts";

/** Resultado de un golpe recibido, que el World usa para stats y efectos. */
export interface HitResult {
  /** ¿El golpe conectó de verdad? (false si estaba esquivando/invulnerable). */
  connected: boolean;
  /** Daño que finalmente entró (ya reducido por escudo). */
  effectiveDamage: number;
  /** Daño absorbido por el escudo. */
  blocked: number;
  /** Magnitud del knockback resultante (px/s), para detectar KO dramático. */
  knockbackSpeed: number;
}

/**
 * Jugador con física custom de platform fighter.
 *
 * El método clave es fixedUpdate(input, platforms, dt): avanza la simulación
 * un paso de tiempo FIJO. Nunca se le pasa el delta variable del frame; eso lo
 * gestiona el bucle principal con su acumulador. Mantener dt fijo hace que el
 * movimiento sea determinista y consistente.
 */
export class Player {
  /** Posición de la esquina superior izquierda (unidades de física). */
  readonly pos: Vec2;
  /** Velocidad en px/s. */
  readonly vel: Vec2 = { x: 0, y: 0 };

  readonly width = PLAYER.width;
  readonly height = PLAYER.height;

  /** Mitad del ancho, útil para centrar al jugador en una coordenada. */
  static readonly halfWidth = PLAYER.width / 2;

  /** ¿Está tocando suelo este paso? */
  onGround = false;
  /** Lado en el que toca pared: -1 pared a la izquierda, +1 derecha, 0 ninguna. */
  touchingWall: -1 | 0 | 1 = 0;
  /** ¿Está agarrado/deslizando por una pared este paso? (para render). */
  wallSliding = false;
  /** Dirección a la que mira: 1 derecha, -1 izquierda (para render/ataques). */
  facing: 1 | -1 = 1;

  /** Temporizadores para el feel del salto (en segundos). */
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumpsLeft: number = PLAYER.maxJumps;

  /** Daño acumulado en % (estilo Smash: a más %, más knockback recibido). */
  damage = 0;

  /**
   * Estadísticas acumuladas de la partida (para las calificaciones del podio).
   * dealt lo suma el World al conectar un golpe; taken/blocked se suman aquí.
   */
  readonly stats = {
    /** Daño total infligido a rivales. */
    dealt: 0,
    /** Daño total recibido (ya reducido por escudo). */
    taken: 0,
    /** Daño total absorbido por el escudo (lo que "ahorró"). */
    blocked: 0,
    /** Nº de KOs conseguidos (rivales enviados fuera). */
    kos: 0,
    /** Nº de veces que ha muerto. */
    deaths: 0,
  };

  /** Parpadeo al recibir golpe (pasos), solo visual. */
  hitFlash = 0;
  /** Aturdimiento restante (s). Mientras >0 no puede moverse ni atacar. */
  hitstunTimer = 0;

  /** Ataque en curso, o null si no está atacando. */
  attack: ActiveAttack | null = null;
  /** Pasos que lleva cargando el ataque fuerte (0 si no está cargando). */
  private heavyChargeSteps = 0;
  /** ¿Está cargando el fuerte ahora mismo? (para render). */
  charging = false;
  /** Buffer de ataque ligero pendiente (s restantes, 0 = nada). */
  private lightBufferTimer = 0;
  /** Usos del ataque fuerte restantes EN EL AIRE (como los saltos). */
  heavyAirUses: number = HEAVY_LUNGE.maxAirUses;

  /**
   * Escudo: salud del escudo en [0..1]. 1 = lleno (burbuja grande), 0 = roto.
   * Mientras `shielding` está activo se drena; al soltar se regenera.
   */
  shieldHealth = 1;
  /** ¿Está levantando el escudo ahora mismo (en suelo)? (para render). */
  shielding = false;
  /** Bloqueo por rotura de escudo (s). Mientras >0 no puede actuar. */
  private shieldBreakTimer = 0;
  /** Esquivas aéreas restantes antes de tocar suelo/pared. */
  airDodgeUses: number = SHIELD.airDodgeMaxUses;
  /** Tiempo restante de esquiva aérea activa (s); >0 = invulnerable. */
  private airDodgeTimer = 0;
  /** ¿Está en plena esquiva aérea? (para render / invulnerabilidad). */
  get dodging(): boolean {
    return this.airDodgeTimer > 0;
  }
  /** Radio actual del escudo para el render (0 si no hay escudo). */
  get shieldRadius(): number {
    if (!this.shielding) return 0;
    return SHIELD.minRadius + (SHIELD.maxRadius - SHIELD.minRadius) * this.shieldHealth;
  }

  /** Barra de furia [0..1]: se llena al infligir daño. */
  furyMeter = 0;
  /** Segundos restantes del modo furia activo (0 = inactivo). */
  furyTimer = 0;
  /** ¿Está en modo furia ahora mismo? (daño x, brillo de colores). */
  get furyActive(): boolean {
    return this.furyTimer > 0;
  }
  /** Multiplicador de daño infligido según el estado de furia. */
  get furyDamageMult(): number {
    return this.furyActive ? FURY.damageMult : 1;
  }
  /** Fracción de furia restante mientras está activa [0..1] (1 = recién activada). */
  get furyRemaining(): number {
    return this.furyActive ? this.furyTimer / FURY.duration : 0;
  }

  /** Dash en tierra: tiempo restante del impulso (s) y cooldown. */
  dashTimer = 0;
  private dashCooldownTimer = 0;
  get dashing(): boolean {
    return this.dashTimer > 0;
  }

  /**
   * Suma carga de furia por el daño infligido. Al llenarse, activa la furia.
   * Mientras la furia está activa no se acumula (se gasta primero).
   */
  addFuryCharge(damageDealt: number): void {
    if (this.furyActive) return;
    this.furyMeter = Math.min(1, this.furyMeter + damageDealt / FURY.fillPerMatch);
    if (this.furyMeter >= 1) {
      this.furyTimer = FURY.duration;
      this.furyMeter = 1;
    }
  }

  /** Bloqueo de control horizontal tras un wall jump (s). */
  private wallJumpLockTimer = 0;
  /**
   * Pared contra la que estábamos agarrados al final del paso anterior (-1/0/1).
   * La usamos al decidir el salto, ya que el estado de agarre se calcula tras
   * resolver colisiones. 1 frame de desfase a 60 Hz es imperceptible.
   */
  private wallGrabDir: -1 | 0 | 1 = 0;

  /** Posición del paso anterior, para interpolar al renderizar. */
  readonly prevPos: Vec2;

  constructor(x: number, y: number) {
    this.pos = { x, y };
    this.prevPos = { x, y };
  }

  /** Caja de colisión actual. */
  get box(): AABB {
    return { x: this.pos.x, y: this.pos.y, w: this.width, h: this.height };
  }

  /**
   * Reaparece en (worldX, worldY), centrado en worldX. Resetea velocidad,
   * estado de salto y la posición previa para que el render no interpole un
   * salto feo desde el punto de muerte.
   */
  respawn(worldX: number, worldY: number): void {
    this.pos.x = worldX - Player.halfWidth;
    this.pos.y = worldY;
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.vel.x = 0;
    this.vel.y = 0;
    this.onGround = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.jumpsLeft = PLAYER.maxJumps;
    this.wallJumpLockTimer = 0;
    this.wallGrabDir = 0;
    this.wallSliding = false;
    this.touchingWall = 0;
    this.attack = null;
    this.charging = false;
    this.heavyChargeSteps = 0;
    this.lightBufferTimer = 0;
    this.heavyAirUses = HEAVY_LUNGE.maxAirUses;
    // Al reaparecer (tras perder una vida) el daño se resetea, como en Smash.
    this.damage = 0;
    this.hitFlash = 0;
    this.hitstunTimer = 0;
    this.shieldHealth = 1;
    this.shielding = false;
    this.shieldBreakTimer = 0;
    this.airDodgeUses = SHIELD.airDodgeMaxUses;
    this.airDodgeTimer = 0;
    this.dashTimer = 0;
    this.dashCooldownTimer = 0;
    // La furia activa se corta al morir; la barra acumulada se conserva.
    this.furyTimer = 0;
    if (this.furyMeter >= 1) this.furyMeter = 0;
  }

  /** ¿Está aturdido por un golpe recibido? (no puede moverse ni atacar). */
  get stunned(): boolean {
    return this.hitstunTimer > 0;
  }

  /** ¿Está en plena acción de ataque (startup/active, no cancelable)? */
  get attacking(): boolean {
    return this.attack !== null && !this.attack.cancelable;
  }

  /** ¿Se quedó sin saltos disponibles (ni en suelo ni aéreos)? */
  get outOfJumps(): boolean {
    return !this.onGround && this.coyoteTimer <= 0 && this.jumpsLeft <= 0;
  }

  /** ¿Se quedó sin usos de ataque fuerte en el aire? */
  get outOfHeavy(): boolean {
    return !this.onGround && this.heavyAirUses <= 0;
  }

  /**
   * Recibe un golpe. El knockback base del ataque se amplifica según el daño
   * acumulado: cuanto más % lleva el jugador, más lejos sale despedido.
   */
  receiveHit(
    baseKnockback: number,
    knockbackUp: number,
    damage: number,
    fromFacing: 1 | -1,
  ): HitResult {
    // Una esquiva aérea activa da invulnerabilidad: el golpe no hace nada.
    if (this.dodging) {
      return { connected: false, effectiveDamage: 0, blocked: 0, knockbackSpeed: 0 };
    }

    // Si está escudando, el escudo absorbe daño y knockback según su salud,
    // y además se drena de golpe por el impacto.
    let dmgMult = 1;
    let kbMult = 1;
    if (this.shielding && this.shieldHealth > 0) {
      // Con el escudo lleno pasa poco; cuanto más gastado, más pasa.
      const h = this.shieldHealth;
      dmgMult = SHIELD.damageTakenFull + (1 - SHIELD.damageTakenFull) * (1 - h);
      kbMult = SHIELD.knockbackTakenFull + (1 - SHIELD.knockbackTakenFull) * (1 - h);
      // El impacto consume escudo proporcional al daño recibido.
      this.shieldHealth = Math.max(0, this.shieldHealth - damage * 0.03);
      if (this.shieldHealth <= 0) this.breakShield();
    }

    const effectiveDamage = damage * dmgMult;
    const blocked = damage - effectiveDamage;
    this.damage += effectiveDamage;
    this.stats.taken += effectiveDamage;
    this.stats.blocked += blocked;

    const scale = 1 + this.damage * 0.012;
    const kb = baseKnockback * scale * kbMult;
    const horizontal = kb * (1 - knockbackUp);
    const vertical = kb * knockbackUp;

    this.vel.x = fromFacing * horizontal;
    this.vel.y = -vertical;
    this.hitFlash = 8;

    // Aturdimiento: más largo cuanto más fuerte el golpe.
    this.hitstunTimer =
      PLAYER.hitstunBase + effectiveDamage * PLAYER.hitstunPerDamage;

    // Un golpe interrumpe lo que estuvieras haciendo.
    this.attack = null;
    this.charging = false;
    this.heavyChargeSteps = 0;
    this.wallSliding = false;
    this.wallGrabDir = 0;
    this.shielding = false;

    return {
      connected: true,
      effectiveDamage,
      blocked,
      knockbackSpeed: Math.hypot(this.vel.x, this.vel.y),
    };
  }

  /** El escudo se rompe: queda bloqueado un rato y se vacía. */
  private breakShield(): void {
    this.shieldHealth = 0;
    this.shielding = false;
    this.shieldBreakTimer = SHIELD.breakLockTime;
  }

  /**
   * Un paso de simulación con timestep fijo.
   * @param input intención del jugador (humano, IA o red) para este paso.
   * @param platforms plataformas sólidas del nivel.
   * @param dt segundos por paso (siempre el mismo valor, FIXED_DT).
   */
  fixedUpdate(input: InputState, platforms: Platform[], dt: number): void {
    // Guardamos la posición previa antes de mover: la usa el render.
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;

    // Si está aturdido, ignora toda intención: solo lo mueve la física.
    if (this.hitstunTimer > 0) {
      this.applyGravity(dt);
      this.moveAndCollideX(dt, platforms);
      this.moveAndCollideY(dt, platforms);
      this.wallSliding = false;
      this.wallGrabDir = 0;
      this.updateTimers(dt);
      return;
    }

    // Escudo / esquiva se procesa antes del combate: si estás escudando no
    // atacas, y una esquiva aérea consume el input de este paso.
    this.handleShield(input, dt);

    // Combate: primero avanzamos el ataque en curso; luego, si estamos libres,
    // procesamos los inputs de ataque.
    this.updateAttack();
    if (!this.shielding && this.shieldBreakTimer <= 0) {
      this.handleAttackInput(input);
    }

    // Mientras atacamos, cargamos, escudamos o esquivamos no hay movimiento.
    const canMove = !this.isBusy();

    if (canMove) {
      this.applyHorizontal(input, dt);
      this.applyJump(input, dt);
    } else if (this.dashing) {
      // Durante el dash mantenemos el impulso (no frenamos ni aceleramos).
    } else if (this.onGround) {
      // En SUELO, al atacar/cargar nos anclamos (frenamos) para no deslizar.
      this.vel.x = approach(this.vel.x, 0, PLAYER.groundFriction * dt);
    }
    // En el AIRE, atacar/cargar NO toca la velocidad horizontal: conservamos el
    // momentum y seguimos volando con la inercia que llevábamos.
    this.applyGravity(dt);

    // Integramos y resolvemos colisiones por ejes separados.
    this.moveAndCollideX(dt, platforms);
    this.moveAndCollideY(dt, platforms);

    // El agarre a la pared se evalúa tras colisionar (necesita touchingWall).
    // No se puede uno agarrar mientras ataca/carga.
    if (!this.isBusy()) {
      this.applyWallSlide(input);
    } else {
      this.wallSliding = false;
      this.wallGrabDir = 0;
    }

    this.updateTimers(dt);
  }

  /**
   * ¿Está ocupado de forma que bloquea moverse/saltar? Cargando sí; atacando
   * solo durante startup/active. En RECOVERY te dejamos moverte y encadenar,
   * para que el combate fluya y no se sienta "pegado".
   */
  private isBusy(): boolean {
    if (this.charging) return true;
    if (this.attack && !this.attack.cancelable) return true;
    if (this.shielding) return true;
    if (this.shieldBreakTimer > 0) return true;
    if (this.dodging) return true;
    if (this.dashing) return true;
    return false;
  }

  /**
   * Escudo y esquiva.
   *  - En SUELO: mantener el botón levanta el escudo (burbuja que se encoge).
   *    Al soltar, se baja. Si se agota del todo, se rompe (bloqueo temporal).
   *  - En el AIRE: pulsar el botón hace una esquiva/impulso en la dirección
   *    apuntada (o hacia donde miras si no apuntas). Sirve para cambiar de
   *    dirección en el aire y recuperar. Usos limitados por salto.
   */
  private handleShield(input: InputState, dt: number): void {
    // Avanza temporizadores propios del escudo.
    this.shieldBreakTimer = Math.max(0, this.shieldBreakTimer - dt);
    this.airDodgeTimer = Math.max(0, this.airDodgeTimer - dt);

    // Si el escudo está roto, no se puede usar nada hasta que pase el bloqueo.
    if (this.shieldBreakTimer > 0) {
      this.shielding = false;
      return;
    }

    if (this.onGround) {
      // Esquiva aérea termina al tocar suelo; recarga de usos.
      this.airDodgeUses = SHIELD.airDodgeMaxUses;

      // Dash en tierra: pulsar escudo (flanco) mientras te mueves = impulso en
      // esa dirección, en vez de levantar el escudo.
      if (
        input.shieldPressed &&
        input.moveX !== 0 &&
        this.dashCooldownTimer <= 0 &&
        !this.attacking
      ) {
        this.doGroundDash(input.moveX > 0 ? 1 : -1);
        return;
      }

      const wantsShield = input.shieldHeld;
      if (wantsShield && this.shieldHealth > 0 && !this.attacking) {
        this.shielding = true;
        // Drena mientras se mantiene.
        this.shieldHealth = Math.max(
          0,
          this.shieldHealth - dt / SHIELD.drainTime,
        );
        if (this.shieldHealth <= 0) this.breakShield();
        // Escudando en suelo: anclado (no se desliza).
        this.vel.x = approach(this.vel.x, 0, PLAYER.groundFriction * dt);
      } else {
        this.shielding = false;
        this.regenShield(dt);
      }
      return;
    }

    // --- En el aire ---
    this.shielding = false; // la burbuja solo se levanta en suelo
    this.regenShield(dt);

    // Esquiva aérea al pulsar (flanco), si quedan usos y no estamos ya en una.
    if (input.shieldPressed && this.airDodgeUses > 0 && this.airDodgeTimer <= 0) {
      this.doAirDodge(input);
    }
  }

  private regenShield(dt: number): void {
    if (this.shieldHealth < 1) {
      this.shieldHealth = Math.min(1, this.shieldHealth + dt / SHIELD.regenTime);
    }
  }

  /** Dash en tierra hacia `dir` (1 derecha, -1 izquierda). */
  private doGroundDash(dir: 1 | -1): void {
    this.facing = dir;
    this.vel.x = dir * SHIELD.dashSpeed;
    this.dashTimer = SHIELD.dashTime;
    this.dashCooldownTimer = SHIELD.dashCooldown;
    this.shielding = false;
    // Cancela ataque/carga en curso.
    this.attack = null;
    this.charging = false;
    this.heavyChargeSteps = 0;
  }

  /**
   * Esquiva aérea direccional: impulso en la dirección apuntada (o hacia donde
   * miras si no se apunta). Da invulnerabilidad breve y permite cambiar de
   * dirección en el aire. Consume un uso.
   */
  private doAirDodge(input: InputState): void {
    let dx = input.moveX;
    let dy = input.moveY;
    if (dx === 0 && dy === 0) {
      // Sin dirección: esquiva horizontal hacia donde miramos.
      dx = this.facing;
    }
    // Normaliza para que la diagonal no sea más rápida.
    const len = Math.hypot(dx, dy) || 1;
    this.vel.x = (dx / len) * SHIELD.airDodgeSpeed;
    this.vel.y = (dy / len) * SHIELD.airDodgeSpeed;
    if (dx !== 0) this.facing = dx > 0 ? 1 : -1;
    this.airDodgeTimer = SHIELD.airDodgeTime;
    this.airDodgeUses = Math.max(0, this.airDodgeUses - 1);
    // Cancela ataque/carga en curso.
    this.attack = null;
    this.charging = false;
    this.heavyChargeSteps = 0;
  }

  /** Avanza el ataque en curso y lo descarta al terminar. */
  private updateAttack(): void {
    if (this.attack) {
      const alive = this.attack.step(this.box);
      if (!alive) this.attack = null;
    }
  }

  /**
   * Procesa inputs de ataque. Usa un buffer para el ligero y permite cancelar
   * el recovery del ataque actual con uno nuevo, de modo que se encadenan sin
   * la pausa larga de antes.
   */
  private handleAttackInput(input: InputState): void {
    // Bufferizamos el ligero: si lo pulsas mientras aún no puedes atacar, se
    // guarda un instante y sale en cuanto estés libre.
    if (input.lightPressed) {
      this.lightBufferTimer = PLAYER.attackBuffer;
    }

    // ¿Podemos iniciar un ataque? Sí si no hay ataque, o si el actual ya está
    // en recovery (cancelable). Cargar bloquea (estás manteniendo el fuerte).
    const canStart =
      !this.charging && (this.attack === null || this.attack.cancelable);

    // --- Fuerte: cargar mientras se mantiene, lanzar al soltar ---
    // En el aire solo si quedan usos (como los saltos).
    const canHeavy = this.onGround || this.heavyAirUses > 0;
    if (input.heavyHeld && canStart && canHeavy) {
      this.charging = true;
      this.heavyChargeSteps = 1;
      this.attack = null; // cancela el recovery anterior al empezar a cargar
      this.lightBufferTimer = 0;
      return;
    }
    if (this.charging) {
      if (input.heavyHeld) {
        this.heavyChargeSteps = Math.min(
          this.heavyChargeSteps + 1,
          CHARGE.maxChargeSteps,
        );
        return;
      }
      // Soltó: lanzamos el fuerte con lo cargado.
      const dir = this.attackDir(input);
      this.orientForAttack(input, dir);
      const charge01 = this.heavyChargeSteps / CHARGE.maxChargeSteps;
      this.startAttack("heavy", dir, charge01);
      this.applyHeavyLunge(dir);
      this.charging = false;
      this.heavyChargeSteps = 0;
      return;
    }

    // --- Ligero: sale del buffer en cuanto podemos ---
    if (this.lightBufferTimer > 0 && canStart) {
      const dir = this.attackDir(input);
      this.orientForAttack(input, dir);
      this.startAttack("light", dir, 0);
      this.lightBufferTimer = 0;
    }
  }

  /** Dirección del ataque a partir del input (vertical tiene prioridad). */
  private attackDir(input: InputState): AttackDir {
    if (input.moveY < 0) return "up";
    if (input.moveY > 0) return "down";
    if (input.moveX !== 0) return "side";
    return "neutral";
  }

  private startAttack(
    kind: "light" | "heavy",
    dir: AttackDir,
    charge01: number,
  ): void {
    const def = kind === "light" ? LIGHT_ATTACKS[dir] : HEAVY_ATTACKS[dir];
    // Iniciar un ataque cancela el recovery del anterior (encadenado).
    this.attack = new ActiveAttack(def, this.facing, charge01);
  }

  /**
   * Lanza un ataque de forma programática (lo usa el dummy de entrenamiento al
   * pulsar un botón del menú). Orienta el facing según la dirección lateral.
   * El fuerte sale con una carga media para que se note.
   */
  forceAttack(kind: "light" | "heavy", dir: AttackDir): void {
    if (this.stunned) return;
    if (dir === "side") {
      // Orienta hacia el lado del ataque (por defecto a la derecha).
      this.facing = this.facing; // mantenemos el facing actual
    }
    const charge = kind === "heavy" ? 0.6 : 0;
    this.startAttack(kind, dir, charge);
  }

  /**
   * Impulso que el fuerte da al PROPIO jugador, en la dirección del ataque.
   * Cancela el movimiento previo (se SUSTITUYE la velocidad) para que sirva de
   * recuperación: te lanza hacia donde atacas. Gasta un uso aéreo.
   */
  private applyHeavyLunge(dir: AttackDir): void {
    switch (dir) {
      case "up":
        this.vel.x = 0;
        this.vel.y = -HEAVY_LUNGE.speedUp;
        break;
      case "down":
        this.vel.x = 0;
        this.vel.y = HEAVY_LUNGE.speedDown;
        break;
      case "side":
      case "neutral":
      default:
        this.vel.x = this.facing * HEAVY_LUNGE.speedX;
        // Un pelín de elevación para que el lateral también ayude a volver.
        this.vel.y = Math.min(this.vel.y, -120);
        break;
    }
    if (!this.onGround) {
      this.heavyAirUses = Math.max(0, this.heavyAirUses - 1);
    }
  }

  /**
   * Orienta el facing hacia la X pulsada al atacar lateral. Se llama desde
   * startAttack vía attackDir, pero lo aplicamos aparte para dejarlo explícito.
   */
  private orientForAttack(input: InputState, dir: AttackDir): void {
    if (dir === "side" && input.moveX !== 0) {
      this.facing = input.moveX > 0 ? 1 : -1;
    }
  }

  /** Progreso de carga actual [0..1], para el render. */
  get chargeRatio(): number {
    return this.heavyChargeSteps / CHARGE.maxChargeSteps;
  }

  private applyHorizontal(input: InputState, dt: number): void {
    // Durante el bloqueo tras un wall jump, el input horizontal no manda: así
    // el empuje de separación de la pared no se cancela de inmediato.
    if (this.wallJumpLockTimer > 0) return;

    const wantsMove = input.moveX !== 0;
    const accel = this.onGround ? PLAYER.groundAccel : PLAYER.airAccel;
    const friction = this.onGround ? PLAYER.groundFriction : PLAYER.airFriction;

    if (wantsMove) {
      this.facing = input.moveX > 0 ? 1 : -1;
      const target = input.moveX * PLAYER.moveSpeed;
      // Aceleramos hacia la velocidad objetivo.
      this.vel.x = approach(this.vel.x, target, accel * dt);
    } else {
      // Sin input: frenamos hacia 0.
      this.vel.x = approach(this.vel.x, 0, friction * dt);
    }
  }

  private applyJump(input: InputState, dt: number): void {
    // Bufferizamos el salto: si lo pulsa justo antes de tocar suelo, se guarda.
    if (input.jumpPressed) {
      this.jumpBufferTimer = PLAYER.jumpBuffer;
    } else {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    }

    const canGroundJump = this.onGround || this.coyoteTimer > 0;
    const canWallJump = !this.onGround && this.wallGrabDir !== 0;
    const wantsToJump = this.jumpBufferTimer > 0;

    if (wantsToJump) {
      if (canGroundJump) {
        this.doJump();
      } else if (canWallJump) {
        // Agarrados a la pared: salto diagonal alejándonos de ella.
        this.doWallJump();
      } else if (this.jumpsLeft > 0) {
        // Salto aéreo (doble salto).
        this.doJump();
      }
    }

    // Salto variable: si suelta el botón mientras sube, cortamos el impulso.
    if (!input.jumpHeld && this.vel.y < 0) {
      this.vel.y *= PLAYER.jumpCutMultiplier;
    }
  }

  private doJump(): void {
    this.vel.y = -PLAYER.jumpSpeed;
    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.onGround = false;
    this.jumpsLeft = Math.max(0, this.jumpsLeft - 1);
  }

  /**
   * Wall jump: impulso diagonal ALEJÁNDOSE de la pared. wallGrabDir es el lado
   * donde está la pared (-1 izq, +1 der), así que el empuje horizontal va en
   * sentido contrario. Bloquea el control horizontal un instante.
   */
  private doWallJump(): void {
    const away = -this.wallGrabDir; // sentido opuesto a la pared
    this.vel.y = -PLAYER.wallJumpSpeedY;
    this.vel.x = away * PLAYER.wallJumpSpeedX;
    this.facing = away === 1 ? 1 : -1; // miramos hacia donde saltamos
    this.wallJumpLockTimer = PLAYER.wallJumpLockTime;
    this.jumpBufferTimer = 0;
    this.wallGrabDir = 0; // consumimos el agarre
    this.wallSliding = false;
    this.onGround = false;
    // No gastamos salto aéreo: el wall jump es su propia acción.
  }

  private applyGravity(dt: number): void {
    if (this.vel.y < 0) {
      // Subiendo: gravedad normal (da el arco natural del salto).
      this.vel.y += PLAYER.gravity * dt;
    } else {
      // Cayendo: en vez de acelerar sin fin, nos acercamos rápido a una
      // velocidad de caída CONSTANTE (terminal). Así la caída es predecible y
      // no "pesa" cada vez más.
      this.vel.y = approach(this.vel.y, PLAYER.fallSpeed, PLAYER.fallAccel * dt);
    }
    if (this.vel.y > PLAYER.maxFallSpeed) {
      this.vel.y = PLAYER.maxFallSpeed;
    }
  }

  private moveAndCollideX(dt: number, platforms: Platform[]): void {
    this.pos.x += this.vel.x * dt;
    this.touchingWall = 0;
    for (const p of platforms) {
      // Las plataformas one-way no tienen paredes laterales: se atraviesan.
      if (p.oneWay) continue;
      if (!overlaps(this.box, p.box)) continue;
      if (this.vel.x > 0) {
        // Moviéndonos a la derecha: nos pegamos al borde izquierdo de la plat.
        this.pos.x = p.box.x - this.width;
        this.touchingWall = 1;
      } else if (this.vel.x < 0) {
        this.pos.x = p.box.x + p.box.w;
        this.touchingWall = -1;
      }
      this.vel.x = 0;
    }
  }

  private moveAndCollideY(dt: number, platforms: Platform[]): void {
    // Pies en el paso anterior, para decidir si una plataforma one-way nos
    // sostiene (solo si veníamos desde arriba, nunca atravesándola al subir).
    const prevFeet = this.prevPos.y + this.height;
    this.pos.y += this.vel.y * dt;
    let grounded = false;

    for (const p of platforms) {
      if (!overlaps(this.box, p.box)) continue;

      if (p.oneWay) {
        // One-way: solo colisiona cayendo y si los pies estaban por encima del
        // borde superior en el paso previo (con 1px de tolerancia).
        const fallingOntoTop = this.vel.y > 0 && prevFeet <= p.box.y + 1;
        if (fallingOntoTop) {
          this.pos.y = p.box.y - this.height;
          this.vel.y = 0;
          grounded = true;
        }
        // Si no, la atravesamos (subiendo o entrando por el lado/abajo).
        continue;
      }

      if (this.vel.y > 0) {
        // Cayendo: aterrizamos sobre la plataforma.
        this.pos.y = p.box.y - this.height;
        grounded = true;
      } else if (this.vel.y < 0) {
        // Subiendo: nos golpeamos la cabeza con el techo.
        this.pos.y = p.box.y + p.box.h;
      }
      this.vel.y = 0;
    }

    this.onGround = grounded;
  }

  /**
   * Agarre a la pared: si estamos en el aire, cayendo, tocando una pared y
   * empujando con el input hacia ella (mirando hacia ella), deslizamos despacio
   * y recuperamos los saltos.
   */
  private applyWallSlide(input: InputState): void {
    this.wallSliding = false;
    this.wallGrabDir = 0;

    if (this.onGround || this.touchingWall === 0) return;
    // Durante el bloqueo del wall jump no re-agarramos (si no, saltar contra la
    // pared que acabas de dejar te volvería a pegar al instante).
    if (this.wallJumpLockTimer > 0) return;
    // Hay que estar empujando hacia la pared que tocamos.
    const pushingIntoWall = input.moveX === this.touchingWall;
    // Solo al caer (no mientras aún subimos tras un salto).
    const falling = this.vel.y > 0;

    if (pushingIntoWall && falling) {
      this.wallSliding = true;
      this.wallGrabDir = this.touchingWall; // recordamos el lado para el salto
      this.facing = this.touchingWall; // miramos hacia la pared
      if (this.vel.y > PLAYER.wallSlideSpeed) {
        this.vel.y = PLAYER.wallSlideSpeed;
      }
      // Recuperamos saltos y usos del fuerte/esquiva aéreos mientras agarrados.
      this.jumpsLeft = PLAYER.maxJumps;
      this.heavyAirUses = HEAVY_LUNGE.maxAirUses;
      this.airDodgeUses = SHIELD.airDodgeMaxUses;
    }
  }

  private updateTimers(dt: number): void {
    this.wallJumpLockTimer = Math.max(0, this.wallJumpLockTimer - dt);
    this.lightBufferTimer = Math.max(0, this.lightBufferTimer - dt);
    this.hitstunTimer = Math.max(0, this.hitstunTimer - dt);
    this.furyTimer = Math.max(0, this.furyTimer - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);
    // Al acabar la furia, la barra se vacía (hay que volver a cargarla).
    if (this.furyTimer <= 0 && this.furyMeter >= 1) this.furyMeter = 0;
    if (this.hitFlash > 0) this.hitFlash--;

    if (this.onGround) {
      // Tocar suelo recarga el coyote time, los saltos y el fuerte aéreo.
      this.coyoteTimer = PLAYER.coyoteTime;
      this.jumpsLeft = PLAYER.maxJumps;
      this.heavyAirUses = HEAVY_LUNGE.maxAirUses;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }
  }
}

/** Mueve `current` hacia `target` como mucho `maxDelta`, sin pasarse. */
function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}
