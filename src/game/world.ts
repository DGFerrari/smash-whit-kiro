import { BLAST_ZONE, RULES, WORLD } from "../config.ts";
import { DUMMY_ATTACK } from "../combat/attacks.ts";
import { CpuBrain } from "./cpuBrain.ts";
import { Player } from "../entities/player.ts";
import { Platform } from "../physics/platform.ts";
import { overlaps } from "../physics/aabb.ts";
import { createInputState, type InputState } from "../core/input.ts";
import { debug } from "../debug/debugState.ts";
import { Rng, randomSeed } from "../core/rng.ts";
import { getCharacter, type CharacterId } from "./characters.ts";
import { getStage, type StageId, type StageKind } from "./stages.ts";

/** Modo de juego. */
export type GameMode = "training" | "versus";

export type { StageKind } from "./stages.ts";

/** Etiquetas de combatiente por índice (P1/P2). El color lo da el personaje. */
export const FIGHTER_LABELS = ["P1", "P2"] as const;

/** Quién controla a un combatiente. */
export type Controller = "human" | "cpu";

/** Configuración de una partida: qué personajes y en qué escenario. */
export interface MatchConfig {
  characters: CharacterId[];
  stage: StageId;
  /**
   * Quién controla cada combatiente (por índice). Si falta, se asume humano.
   * De momento solo el índice 1 puede ser "cpu" (elegible en la selección).
   */
  controllers?: Controller[];
}

/**
 * Efecto visual de muerte: un RAYO estilo Smash que cae sobre el punto donde el
 * combatiente cruzó la blast zone. Vive unos frames y lo dibuja el renderer.
 */
export interface DeathEffect {
  /** Punto de impacto (donde salió el combatiente). */
  x: number;
  y: number;
  color: string;
  /** Semilla para que el zigzag del rayo sea estable durante su vida. */
  readonly seed: number;
  /** Tiempo de vida restante (s) y total, para animar [1..0]. */
  life: number;
  readonly maxLife: number;
}

/**
 * Un combatiente del mundo: su cuerpo (Player), sus vidas, de quién viene el
 * input y su estado de reaparición (retraso + plataforma temporal).
 */
export class Fighter {
  lives: number;
  /** >0 = muerto, esperando para reaparecer (s restantes). */
  respawnTimer = 0;
  /** Plataforma temporal bajo el jugador tras reaparecer (o null). */
  respawnPlatform: Platform | null = null;
  /** Tiempo de vida restante de la plataforma temporal (s). */
  private respawnPlatformTimer = 0;
  /** Posición de referencia para detectar el primer movimiento tras reaparecer. */
  private respawnAnchorX = 0;

  constructor(
    readonly index: number,
    readonly player: Player,
    readonly color: string,
    readonly label: string,
    startingLives: number,
    /** Personaje que encarna este combatiente (para ataques futuros/render). */
    readonly characterId: CharacterId,
    /** ¿Es el saco de entrenamiento? */
    readonly sandbag: boolean,
    /** ¿Lo controla la CPU (IA)? */
    readonly cpu: boolean = false,
  ) {
    this.lives = startingLives;
  }

  get isDead(): boolean {
    return this.respawnTimer > 0;
  }

  /** ¿Sigue en juego? false = eliminado (sin vidas). */
  alive = true;

  /** Índice del último combatiente que lo golpeó (para atribuir el KO), o -1. */
  lastHitBy = -1;

  /**
   * Animación de la tarjeta de HUD [0..1]: 1 = visible en su sitio, 0 = caída
   * fuera de pantalla. Cae al morir y vuelve a surgir al reaparecer. La anima
   * el World cada paso.
   */
  hudAnim = 1;

  /** Temporizador de "quieto en el suelo" para el modo reposicionar (s). */
  idleStillTimer = 0;

  /** Pasos restantes de pausa entre ataques ligeros repetidos del dummy. */
  dummyAtkCooldown = 0;

  /** Cerebro de IA si este combatiente es CPU (se crea perezosamente). */
  brain: CpuBrain | null = null;

  /**
   * ¿La plataforma temporal debe parpadear este frame? Parpadea más rápido
   * cuanto menos tiempo le queda, avisando de que va a desaparecer.
   */
  get respawnPlatformBlinkOn(): boolean {
    if (!this.respawnPlatform) return false;
    const left = this.respawnPlatformTimer;
    // Frecuencia de parpadeo acelerada en el último tramo.
    const hz = left < 1 ? 10 : left < 2 ? 5 : 2.5;
    return Math.floor(left * hz) % 2 === 0;
  }

  /** Arranca la plataforma temporal bajo el jugador recién reaparecido. */
  armRespawnPlatform(platform: Platform): void {
    this.respawnPlatform = platform;
    this.respawnPlatformTimer = RULES.respawnPlatformMaxTime;
    this.respawnAnchorX = this.player.pos.x;
  }

  /**
   * Actualiza la plataforma temporal: se destruye en cuanto el jugador se mueve
   * (o actúa), o al agotarse su tiempo de cortesía.
   */
  updateRespawnPlatform(dt: number): void {
    if (!this.respawnPlatform) return;
    this.respawnPlatformTimer -= dt;

    const moved = Math.abs(this.player.pos.x - this.respawnAnchorX) > 2;
    const acted =
      this.player.vel.y < -1 || // saltó
      this.player.attack !== null ||
      this.player.charging ||
      this.player.shielding ||
      this.player.dodging;

    if (moved || acted || this.respawnPlatformTimer <= 0) {
      this.respawnPlatform = null;
    }
  }
}

/**
 * El "mundo" contiene todo el estado simulable: combatientes y plataformas.
 * Las coordenadas son de MUNDO (el centro de la isla está en x=0), no de
 * pantalla. La cámara se encarga luego de traducir mundo -> pantalla.
 */
export class World {
  readonly mode: GameMode;
  /** Geometría del escenario (isla / rejilla de entrenamiento). */
  readonly stage: StageKind;
  /** Id del escenario elegido (para render de tema/fondo y para el replay). */
  readonly stageId: StageId;
  /** Personajes de cada combatiente (para render y el replay). */
  readonly characters: CharacterId[];
  readonly fighters: Fighter[] = [];

  /** Plataformas fijas del nivel (isla + flotantes). */
  readonly platforms: Platform[] = [];

  /** Efectos de muerte activos (visuales). */
  readonly deathEffects: DeathEffect[] = [];

  /** ¿Terminó la partida? Y el índice del ganador (o -1 = empate). */
  gameOver = false;
  winnerIndex = -1;
  /** ¿La partida acabó en empate? (para el podio). */
  draw = false;

  /** Tiempo restante del 1vs1 en segundos. Infinity = sin límite (training). */
  timeLeft: number;

  /**
   * Evento de "KO dramático" pendiente de consumir por la capa de presentación
   * (para la cámara lenta + destello). Se activa cuando un golpe manda a un
   * rival con un knockback que lo va a matar casi seguro. El loop lo lee y lo
   * limpia. Guarda el índice del golpeado.
   */
  pendingDramaticKO: number | null = null;

  /**
   * Petición de "cámara en el punto de muerte": tras morir alguien, la cámara
   * se queda un rato enfocando dónde ocurrió para ver bien el rayo. El loop lo
   * consume (lo pone a null) y corre la cinemática.
   */
  pendingDeathFocus: { x: number; y: number } | null = null;

  /** Input neutro permanente para el dummy en entrenamiento. */
  private readonly dummyInput: InputState = createInputState();

  /** Semilla y RNG determinista de la partida (clave para replays idénticos). */
  readonly seed: number;
  private readonly rng: Rng;

  /**
   * @param mode training/versus.
   * @param seed semilla determinista (para replays idénticos).
   * @param config personajes y escenario elegidos. Si falta, se usan valores
   *   por defecto según el modo (azul vs rojo en isla neón; azul vs saco en
   *   entrenamiento).
   */
  constructor(
    mode: GameMode = "training",
    seed: number = randomSeed(),
    config?: Partial<MatchConfig>,
  ) {
    this.mode = mode;
    this.seed = seed;
    this.rng = new Rng(seed);
    // Solo el 1vs1 tiene límite de tiempo; entrenamiento es ilimitado.
    this.timeLeft = mode === "versus" ? RULES.matchTimeLimit : Infinity;

    // Personajes: por defecto azul vs (rojo | saco según modo).
    const defChars: CharacterId[] =
      mode === "training" ? ["blue", "sandbag"] : ["blue", "red"];
    this.characters = config?.characters ?? defChars;

    // Escenario: por defecto training-grid en entrenamiento; isla neón en versus.
    this.stageId = config?.stage ?? (mode === "training" ? "training" : "neonIsland");
    this.stage = getStage(this.stageId).kind;
    this.buildStage();

    // Fighter 0: siempre el jugador humano principal.
    const c0 = getCharacter(this.characters[0]);
    const p1 = new Player(RULES.respawnX - Player.halfWidth, RULES.respawnY);
    this.fighters.push(
      new Fighter(0, p1, c0.color, FIGHTER_LABELS[0], RULES.startingLives, c0.id, !!c0.sandbag),
    );

    // Fighter 1: en versus es P2 humano; en entrenamiento es el dummy.
    const c1 = getCharacter(this.characters[1]);
    const startX = 220;
    const p2 = new Player(startX - Player.halfWidth, WORLD.groundY - 100);
    const isCpu1 = config?.controllers?.[1] === "cpu";
    const label1 = c1.sandbag ? "DUMMY" : isCpu1 ? "CPU" : FIGHTER_LABELS[1];
    this.fighters.push(
      new Fighter(
        1,
        p2,
        c1.color,
        label1,
        mode === "versus" ? RULES.startingLives : Infinity,
        c1.id,
        !!c1.sandbag,
        isCpu1,
      ),
    );
  }

  /** Acceso cómodo al jugador principal (fighter 0). */
  get player(): Player {
    return this.fighters[0].player;
  }

  /** Construye el escenario según `this.stage`. */
  private buildStage(): void {
    if (this.stage === "trainingGrid") {
      this.buildTrainingGrid();
    } else {
      this.buildIsland();
    }
  }

  /** Construye una isla flotante centrada en x=0 (versus). */
  private buildIsland(): void {
    const g = WORLD.groundY;

    // Plataforma principal (la isla): ancha, con paredes altas a los lados.
    this.platforms.push(new Platform(-440, g, 880, 220));

    // Dos plataformas flotantes ATRAVESABLES (one-way).
    this.platforms.push(new Platform(-260, g - 150, 200, 20, true));
    this.platforms.push(new Platform(60, g - 250, 200, 20, true));
  }

  /**
   * Escenario de ENTRENAMIENTO: una sola plataforma sólida que va de extremo a
   * extremo del mapa (hasta las blast zones laterales), sin plataformas de
   * apoyo extra. El fondo cuadriculado y la numeración de distancias los dibuja
   * el renderer; aquí solo definimos la geometría física.
   */
  private buildTrainingGrid(): void {
    const g = WORLD.groundY;
    const left = BLAST_ZONE.left;
    const width = BLAST_ZONE.right - BLAST_ZONE.left;
    // Suelo de borde a borde; altura generosa para que no se caiga por debajo.
    this.platforms.push(new Platform(left, g, width, 260));
  }

  /** El primer rival vivo y no-muerto de un combatiente (o null). */
  private opponentOf(self: Fighter): Player | null {
    for (const f of this.fighters) {
      if (f === self) continue;
      if (!f.alive || f.isDead) continue;
      return f.player;
    }
    return null;
  }

  /** Plataformas efectivas este paso: las fijas + las temporales de respawn. */
  private activePlatforms(): Platform[] {
    const temp = this.fighters
      .map((f) => f.respawnPlatform)
      .filter((p): p is Platform => p !== null);
    return temp.length ? [...this.platforms, ...temp] : this.platforms;
  }

  /**
   * Avanza la simulación un paso de tiempo fijo.
   * @param inputs intención de cada combatiente (índice = fighter). En
   *   entrenamiento, el índice 1 se ignora (el dummy usa input neutro).
   */
  step(inputs: InputState[], dt: number): void {
    // Nota: NO frenamos la simulación al marcar gameOver. Dejamos que el último
    // KO (knockback + rayo) se reproduzca en cámara lenta durante el "FINISH"
    // antes del podio. El resultado (winnerIndex) ya quedó fijado.

    // Cronómetro del 1vs1: al agotarse, se resuelve por vidas y luego por daño.
    if (!this.gameOver && Number.isFinite(this.timeLeft)) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) {
        this.resolveByTime();
      }
    }

    const platforms = this.activePlatforms();

    for (const f of this.fighters) {
      this.updateFighter(f, inputs[f.index], dt, platforms);
      // Animación de la tarjeta de HUD: cae al morir/eliminarse, surge al vivir.
      const target = !f.alive || f.isDead ? 0 : 1;
      f.hudAnim += (target - f.hudAnim) * Math.min(1, dt * 12);
    }

    this.resolveHits();
    this.updateDeathEffects(dt);
  }

  private updateFighter(
    f: Fighter,
    input: InputState | undefined,
    dt: number,
    platforms: Platform[],
  ): void {
    // Muerto: corre el reloj de reaparición y no se simula el cuerpo.
    if (f.respawnTimer > 0) {
      f.respawnTimer -= dt;
      if (f.respawnTimer <= 0) this.doRespawn(f);
      return;
    }

    // El saco de entrenamiento se controla con su propia lógica (no input).
    if (f.sandbag) {
      this.updateDummy(f, dt, platforms);
    } else if (f.cpu) {
      // CPU: la IA genera su InputState a partir del estado del mundo.
      if (!f.brain) f.brain = new CpuBrain();
      const foe = this.opponentOf(f);
      const aiInput = f.brain.think(f.player, foe, platforms);
      f.player.fixedUpdate(aiInput, platforms, dt);
    } else {
      f.player.fixedUpdate(input ?? this.dummyInput, platforms, dt);
    }

    f.updateRespawnPlatform(dt);
    this.checkBlastZone(f);
  }

  /**
   * Dummy de entrenamiento. Comportamiento según debug.dummyBehavior:
   *  - freeze: clavado donde está, inmóvil (ignora knockback).
   *  - reposition: física normal, pero vuelve al centro si queda quieto.
   *  - free: física normal.
   * Además ejecuta las acciones de ataque disparadas desde el menú.
   */
  private updateDummy(f: Fighter, dt: number, platforms: Platform[]): void {
    const dummy = f.player;

    // Ataque en bucle pedido desde el menú (si hay uno seleccionado).
    this.updateDummyAttack(f);

    if (debug.dummyBehavior === "freeze") {
      // Clavado en su posición actual (solo fijamos velocidad y prevPos).
      dummy.vel.x = 0;
      dummy.vel.y = 0;
      dummy.prevPos.x = dummy.pos.x;
      dummy.prevPos.y = dummy.pos.y;
      // Dejamos avanzar el ataque en curso sin moverse.
      dummy.fixedUpdate(this.dummyInput, platforms, dt);
      // Reanclamos por si el ataque/gravedad lo movió un pelín.
      dummy.vel.x = 0;
      dummy.vel.y = 0;
      return;
    }

    dummy.fixedUpdate(this.dummyInput, platforms, dt);

    if (debug.dummyBehavior === "reposition") {
      this.repositionDummy(f, dt);
    }
  }

  /**
   * Repite el ataque seleccionado para el dummy. El ligero deja una pausa entre
   * golpes (anti-spam); el fuerte se relanza en cuanto puede, siempre a carga
   * completa (forceAttack ya usa carga 1 para el fuerte).
   */
  private updateDummyAttack(f: Fighter): void {
    const sel = debug.dummyAttack;
    if (!sel) {
      f.dummyAtkCooldown = 0;
      return;
    }
    if (f.dummyAtkCooldown > 0) {
      f.dummyAtkCooldown--;
      return;
    }
    // Solo lanzamos cuando el dummy está libre (no atacando ni cargando).
    if (!f.player.canStartAttack) return;

    f.player.forceAttack(sel.kind, sel.dir);
    // Tras un ligero, imponemos una pausa; el fuerte se encadena sin pausa
    // extra (ya es lento de por sí).
    f.dummyAtkCooldown = sel.kind === "light" ? DUMMY_ATTACK.lightIntervalSteps : 0;
  }

  /**
   * Modo reposicionar: si el dummy lleva unos segundos quieto en el suelo,
   * vuelve despacio al centro del mapa para repetir pruebas desde el mismo
   * sitio. "Quieto" = en el suelo y casi sin velocidad.
   */
  private repositionDummy(f: Fighter, dt: number): void {
    const dummy = f.player;
    const still =
      dummy.onGround &&
      Math.abs(dummy.vel.x) < 8 &&
      Math.abs(dummy.vel.y) < 8 &&
      dummy.attack === null;

    if (still) {
      f.idleStillTimer += dt;
    } else {
      f.idleStillTimer = 0;
    }

    if (f.idleStillTimer >= 1.2) {
      // Centro de referencia del dummy.
      const centerX = RULES.respawnX - Player.halfWidth;
      const dx = centerX - dummy.pos.x;
      if (Math.abs(dx) < 2) {
        dummy.pos.x = centerX;
        dummy.vel.x = 0;
      } else {
        // Vuelve deslizándose suave al centro.
        dummy.pos.x += dx * Math.min(1, dt * 4);
      }
    }
  }

  /**
   * Resuelve golpes entre combatientes. Cada ataque activo intenta golpear a
   * todos los demás (en versus, ambos sentidos). Un ataque solo golpea una vez
   * a cada objetivo.
   */
  private resolveHits(): void {
    for (const attacker of this.fighters) {
      const atk = attacker.player.attack;
      if (!atk || !atk.hitbox) continue;

      for (const target of this.fighters) {
        if (target === attacker) continue;
        if (target.respawnTimer > 0) continue; // no golpear a muertos/reapareciendo
        if (atk.hasHit(target.player)) continue;
        if (overlaps(atk.hitbox, target.player.box)) {
          // El modo furia multiplica el daño y el knockback del atacante.
          const mult = attacker.player.furyDamageMult;
          const res = target.player.receiveHit(
            atk.knockback * mult,
            atk.def.knockbackUp,
            atk.damage * mult,
            atk.attackerFacing,
          );
          if (res.connected) {
            // El atacante se apunta el daño infligido y carga su furia.
            attacker.player.stats.dealt += res.effectiveDamage;
            attacker.player.addFuryCharge(res.effectiveDamage);
            // Recordamos quién golpeó por última vez (para atribuir el KO).
            target.lastHitBy = attacker.index;
            // ¿KO dramático? Golpe potente sobre un rival ya cargado, con
            // knockback suficiente para sacarlo. Solo en versus y una vez.
            if (
              this.mode === "versus" &&
              this.pendingDramaticKO === null &&
              target.player.damage >= 85 &&
              res.knockbackSpeed >= 950
            ) {
              this.pendingDramaticKO = target.index;
            }
          }
        }
      }
    }
  }

  /** Si un combatiente sale del rectángulo letal, muere. */
  private checkBlastZone(f: Fighter): void {
    const b = f.player.box;
    const out =
      b.x + b.w < BLAST_ZONE.left ||
      b.x > BLAST_ZONE.right ||
      b.y + b.h < BLAST_ZONE.top || // el borde de ARRIBA también mata
      b.y > BLAST_ZONE.bottom;

    if (out) this.onFighterDied(f);
  }

  private onFighterDied(f: Fighter): void {
    // Efecto de muerte en el punto de salida.
    this.spawnDeathEffect(f);

    // Estadísticas: muerte propia y KO para quien le pegó por última vez.
    f.player.stats.deaths += 1;
    if (f.lastHitBy >= 0 && f.lastHitBy !== f.index) {
      this.fighters[f.lastHitBy].player.stats.kos += 1;
    }
    f.lastHitBy = -1;

    // En ENTRENAMIENTO nadie se elimina: el dummy tiene vidas infinitas y el
    // jugador recarga vidas al llegar a 0, para poder seguir practicando.
    if (this.mode === "training") {
      if (Number.isFinite(f.lives)) {
        f.lives = Math.max(0, f.lives - 1);
        if (f.lives <= 0) f.lives = RULES.startingLives;
      }
      f.respawnTimer = RULES.respawnDelay;
      return;
    }

    // VERSUS: se descuenta vida; a 0 vidas queda fuera de combate.
    f.lives = Math.max(0, f.lives - 1);
    if (f.lives <= 0) {
      f.alive = false;
      this.checkMatchOver();
      return;
    }
    f.respawnTimer = RULES.respawnDelay;
  }

  /** Dibuja/registra el efecto de muerte en la posición actual del fighter. */
  private spawnDeathEffect(f: Fighter): void {
    const b = f.player.box;
    // Punto aproximado donde salió: centro del cuerpo recortado a la zona.
    const x = clamp(b.x + b.w / 2, BLAST_ZONE.left, BLAST_ZONE.right);
    const y = clamp(b.y + b.h / 2, BLAST_ZONE.top, BLAST_ZONE.bottom);
    this.deathEffects.push({
      x,
      y,
      color: f.color,
      seed: this.rng.range(0, 1000),
      life: 0.6,
      maxLife: 0.6,
    });

    // Pedimos a la cámara que se quede un momento enfocando este punto.
    this.pendingDeathFocus = { x, y };
  }

  private updateDeathEffects(dt: number): void {
    for (const e of this.deathEffects) e.life -= dt;
    // Elimina los caducados.
    for (let i = this.deathEffects.length - 1; i >= 0; i--) {
      if (this.deathEffects[i].life <= 0) this.deathEffects.splice(i, 1);
    }
  }

  /**
   * Reaparece al combatiente: posición repartida (no siempre el centro) para
   * que dos que reaparecen a la vez no colisionen, quieto en el aire sobre una
   * plataforma temporal que se destruye al primer movimiento.
   */
  private doRespawn(f: Fighter): void {
    const x = this.chooseRespawnX(f);
    const y = RULES.respawnY;
    f.player.respawn(x, y);

    // Plataforma temporal justo bajo los pies, atravesable (one-way), para
    // sostenerlo quieto en el aire hasta que se mueva.
    const pb = f.player.box;
    const platW = pb.w + 48;
    const platX = pb.x + pb.w / 2 - platW / 2;
    const platY = pb.y + pb.h; // justo bajo los pies
    f.armRespawnPlatform(new Platform(platX, platY, platW, 14, true));
  }

  /**
   * Elige una X de reaparición repartida alrededor del centro, evitando quedar
   * encima de otro combatiente que esté vivo o reapareciendo.
   */
  private chooseRespawnX(self: Fighter): number {
    const spread = RULES.respawnSpreadX;
    const candidates = [
      RULES.respawnX,
      RULES.respawnX - spread,
      RULES.respawnX + spread,
      RULES.respawnX - spread * 1.6,
      RULES.respawnX + spread * 1.6,
    ];

    // Posiciones ocupadas (centros X) de los demás combatientes vivos.
    const others = this.fighters
      .filter((o) => o !== self && o.alive)
      .map((o) => o.player.pos.x + o.player.width / 2);

    let best = candidates[0];
    let bestDist = -1;
    for (const c of candidates) {
      let minDist = Infinity;
      for (const o of others) minDist = Math.min(minDist, Math.abs(c - o));
      if (others.length === 0) return c; // nadie más: usa el primero libre
      if (minDist > bestDist) {
        bestDist = minDist;
        best = c;
      }
    }
    return best;
  }

  /** Comprueba si la partida terminó (solo en versus). */
  private checkMatchOver(): void {
    if (this.mode !== "versus") return;
    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length <= 1) {
      this.gameOver = true;
      this.winnerIndex = alive.length === 1 ? alive[0].index : -1;
      this.draw = alive.length === 0;
    }
  }

  /**
   * Resolución por tiempo agotado (1vs1): gana quien tenga MÁS vidas; a igualdad
   * de vidas, quien tenga MENOS % de daño acumulado; si todo empata, es empate.
   */
  private resolveByTime(): void {
    if (this.gameOver) return;
    this.gameOver = true;

    const contenders = this.fighters.filter((f) => f.alive);
    if (contenders.length === 0) {
      this.winnerIndex = -1;
      this.draw = true;
      return;
    }

    let best = contenders[0];
    let tie = false;
    for (let i = 1; i < contenders.length; i++) {
      const f = contenders[i];
      if (f.lives > best.lives) {
        best = f;
        tie = false;
      } else if (f.lives === best.lives) {
        // Menos daño gana el desempate.
        if (f.player.damage < best.player.damage) {
          best = f;
          tie = false;
        } else if (f.player.damage === best.player.damage) {
          tie = true;
        }
      }
    }

    if (tie) {
      this.winnerIndex = -1;
      this.draw = true;
    } else {
      this.winnerIndex = best.index;
      this.draw = false;
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
