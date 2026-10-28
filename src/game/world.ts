import { BLAST_ZONE, RULES, WORLD } from "../config.ts";
import { Player } from "../entities/player.ts";
import { Platform } from "../physics/platform.ts";
import { overlaps } from "../physics/aabb.ts";
import { createInputState, type InputState } from "../core/input.ts";

/**
 * El "mundo" contiene todo el estado simulable: jugador(es) y plataformas.
 * Las coordenadas son de MUNDO (el centro de la isla está en x=0), no de
 * pantalla. La cámara se encarga luego de traducir mundo -> pantalla.
 */
export class World {
  readonly player: Player;
  /**
   * El dummy es un Player normal (mismo cuerpo, misma física, recibe golpes
   * igual). No recibe input (se queda "tieso"), así pegarle simula de verdad
   * golpear a otro jugador. El mundo lo devuelve despacio a su sitio cuando
   * queda quieto en el suelo, para repetir pruebas.
   */
  readonly dummy: Player;

  /** Input neutro permanente para el dummy. */
  private readonly dummyInput: InputState = createInputState();
  /** Posición de reposo del dummy. */
  private readonly dummyHomeX: number;

  readonly platforms: Platform[] = [];

  lives: number = RULES.startingLives;
  gameOver = false;

  constructor() {
    this.buildIsland();

    this.player = new Player(
      RULES.respawnX - Player.halfWidth,
      RULES.respawnY,
    );

    // Dummy a la derecha del spawn, apoyado sobre la isla.
    this.dummyHomeX = 220 - Player.halfWidth;
    this.dummy = new Player(this.dummyHomeX, WORLD.groundY - 100);
  }

  /** Construye una isla flotante centrada en x=0. */
  private buildIsland(): void {
    const g = WORLD.groundY;

    // Plataforma principal (la isla): ancha, con paredes altas a los lados.
    this.platforms.push(new Platform(-440, g, 880, 220));

    // Dos plataformas flotantes ATRAVESABLES (one-way).
    this.platforms.push(new Platform(-260, g - 150, 200, 20, true));
    this.platforms.push(new Platform(60, g - 250, 200, 20, true));
  }

  /** Avanza la simulación un paso de tiempo fijo con el input dado. */
  step(input: InputState, dt: number): void {
    this.player.fixedUpdate(input, this.platforms, dt);
    // El dummy se simula con input neutro: cae, colisiona y recibe knockback,
    // pero no actúa por sí mismo.
    this.dummy.fixedUpdate(this.dummyInput, this.platforms, dt);
    this.returnDummyHome();
    this.resolveHits();
    this.checkBlastZone();
  }

  /**
   * Devuelve el dummy despacio a su posición de reposo cuando está quieto en el
   * suelo, para poder repetir pruebas sin perseguirlo.
   */
  private returnDummyHome(): void {
    const quiet =
      this.dummy.onGround &&
      Math.abs(this.dummy.vel.x) < 20 &&
      Math.abs(this.dummy.vel.y) < 20;
    if (quiet) {
      this.dummy.pos.x += (this.dummyHomeX - this.dummy.pos.x) * 0.04;
    }
    // Si cae fuera por la blast zone, lo reaparecemos en su sitio.
    const b = this.dummy.box;
    const out =
      b.x + b.w < BLAST_ZONE.left ||
      b.x > BLAST_ZONE.right ||
      b.y + b.h < BLAST_ZONE.top ||
      b.y > BLAST_ZONE.bottom;
    if (out) {
      this.dummy.respawn(this.dummyHomeX + Player.halfWidth, WORLD.groundY - 100);
    }
  }

  /**
   * Comprueba si la hitbox activa del jugador golpea al dummy. Un mismo ataque
   * solo golpea una vez (controlado por ActiveAttack).
   */
  private resolveHits(): void {
    const atk = this.player.attack;
    if (!atk || !atk.hitbox) return;
    if (atk.hasHit(this.dummy)) return;

    if (overlaps(atk.hitbox, this.dummy.box)) {
      this.dummy.receiveHit(
        atk.knockback,
        atk.def.knockbackUp,
        atk.damage,
        atk.attackerFacing,
      );
    }
  }

  /** Si el jugador sale del rectángulo letal, pierde vida y reaparece. */
  private checkBlastZone(): void {
    const b = this.player.box;
    const out =
      b.x + b.w < BLAST_ZONE.left ||
      b.x > BLAST_ZONE.right ||
      b.y + b.h < BLAST_ZONE.top ||
      b.y > BLAST_ZONE.bottom;

    if (out) {
      this.onPlayerDied();
    }
  }

  private onPlayerDied(): void {
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives === 0) {
      // De momento, al llegar a 0 reiniciamos vidas para seguir probando.
      this.lives = RULES.startingLives;
    }
    this.player.respawn(RULES.respawnX, RULES.respawnY);
  }
}
