/**
 * Todos los valores que definen el "feel" del juego viven aquí.
 * Trabajamos en unidades de física: el mundo se simula a FIXED_HZ pasos por
 * segundo, y las velocidades/aceleraciones están expresadas en px/segundo.
 */

/**
 * Resolución interna del "lienzo lógico". El canvas real ocupa toda la ventana,
 * pero la cámara trabaja sobre estas dimensiones de referencia y escala al
 * tamaño real. Mantener esto fijo conserva un feel consistente en cualquier
 * pantalla y no afecta a la física (que trabaja en coordenadas de mundo).
 */
export const VIEW = {
  width: 960,
  height: 540,
} as const;

/**
 * El mundo es más grande que la vista: una isla flotante rodeada de vacío.
 * Estas coordenadas de mundo definen dónde está la isla y dónde están las
 * "blast zones" (los bordes invisibles letales).
 */
export const WORLD = {
  /** Centro horizontal del mundo donde colocamos la isla. */
  centerX: 0,
  /** Altura de referencia del suelo de la isla (coordenada Y de mundo). */
  groundY: 360,
} as const;

/**
 * Blast zones: rectángulo invisible alrededor de la isla. Si el jugador cruza
 * cualquiera de estos límites, pierde una vida y reaparece. Son coordenadas de
 * mundo (no de pantalla), así que la cámara no afecta a dónde están.
 */
export const BLAST_ZONE = {
  left: -1100,
  right: 1100,
  top: -820,
  bottom: 1040,
} as const;

/**
 * Cámara de "encuadre" estilo Smash.
 *
 * La cámara calcula una caja objetivo (en coords de mundo) que SIEMPRE contiene
 * la isla y al jugador, le añade un margen, y elige el zoom para que esa caja
 * quepa justo en pantalla. Resultado: parada sobre la isla cuando estás cerca,
 * y al alejarte se desplaza un poco hacia ti y quita zoom, de modo que al tocar
 * la blast zone estás justo en el filo de la pantalla.
 */
export const CAMERA = {
  /** Suavizado del seguimiento de posición (0..1 por frame; más alto = más pegada). */
  smooth: 0.1,
  /** Suavizado del zoom (separado; algo más lento se ve mejor). */
  zoomSmooth: 0.08,

  /**
   * Caja base que la cámara siempre intenta mostrar, centrada en la isla
   * (coords de mundo relativas a WORLD.centerX / WORLD.groundY). Define el
   * encuadre "en reposo" cuando el jugador está sobre la isla.
   */
  baseHalfWidth: 520,
  baseHalfHeight: 300,
  /** Centro vertical del encuadre base respecto a groundY (negativo = sube). */
  baseCenterOffsetY: -120,

  /** Margen extra alrededor del contenido a encuadrar (px de mundo). */
  margin: 90,

  /** Topes de zoom para que nunca se acerque o aleje demasiado. */
  minZoom: 0.5,
  maxZoom: 1.5,

  /** Zoom extra multiplicativo al pausar (1.25 = 25% más cerca). */
  pauseZoomBoost: 1.25,

  /**
   * Al pausar, la cámara se acerca y se desplaza hacia el jugador (0 = sin
   * desplazamiento, 1 = centrada del todo en el jugador). Al despausar vuelve
   * al encuadre normal de la isla.
   */
  pauseFocusLerp: 0.85,
} as const;

/**
 * POV (zoom global que el jugador ajusta en Opciones). Es un multiplicador
 * sobre el zoom calculado por la cámara: 1 = por defecto, <1 aleja (ves más),
 * >1 acerca (ves menos). No afecta a la física.
 */
export const POV = {
  min: 0.7,
  max: 1.4,
  default: 1,
  /** Paso del slider en Opciones. */
  step: 0.05,
} as const;

/** Reglas de combate básicas: vidas y reaparición. */
export const RULES = {
  startingLives: 3,
  /** Punto de reaparición en coordenadas de mundo (centro de referencia). */
  respawnX: 0,
  respawnY: -120,

  /** Retraso tras morir antes de reaparecer (segundos). */
  respawnDelay: 1.4,

  /**
   * Reaparición repartida: en vez de salir siempre en el centro, los puntos de
   * spawn se reparten en X alrededor del centro para que dos jugadores que
   * reaparecen a la vez no colisionen. Se elige el más libre.
   */
  respawnSpreadX: 260,

  /**
   * Plataforma temporal de reaparición: aparece bajo el jugador, lo sostiene
   * quieto en el aire y se destruye en cuanto el jugador se mueve o actúa (o al
   * agotarse este tiempo de seguridad).
   */
  respawnPlatformMaxTime: 4, // s de cortesía antes de desaparecer sola
} as const;

/** Simulación con timestep fijo. 60 Hz es el estándar para un fighter. */
export const FIXED_HZ = 60;
export const FIXED_DT = 1 / FIXED_HZ; // segundos por paso de física

/**
 * Para que la física no "explote" si la pestaña se congela (p. ej. cambias de
 * ventana), limitamos cuántos pasos recuperamos en un solo frame.
 */
export const MAX_STEPS_PER_FRAME = 5;

/** Parámetros de movimiento del jugador. Juega con estos para el feel. */
export const PLAYER = {
  width: 36,
  height: 56,

  /** Gravedad en px/s^2. Más ligera para poder reaccionar en el aire. */
  gravity: 1900,

  /** Velocidad horizontal máxima al correr (px/s). */
  moveSpeed: 420,

  /** Aceleración en suelo y aire (px/s^2). Suelo responde más rápido. */
  groundAccel: 4800,
  airAccel: 2600,

  /** Frenado cuando no hay input (px/s^2). */
  groundFriction: 5200,
  airFriction: 1200,

  /** Velocidad inicial del salto (px/s, hacia arriba = negativo). */
  jumpSpeed: 880,

  /** Caída máxima absoluta (tope de seguridad, px/s). */
  maxFallSpeed: 1300,

  /**
   * Caída a velocidad (casi) CONSTANTE: al caer, en vez de acelerar sin fin,
   * el jugador se acerca rápido a `fallSpeed` y se queda ahí. `fallAccel` es
   * lo deprisa que llega a esa velocidad terminal.
   */
  fallSpeed: 720, // px/s de caída estable
  fallAccel: 4200, // px/s^2 para alcanzar fallSpeed

  /**
   * Salto más "jugoso":
   * - coyoteTime: margen para saltar justo después de salir de una plataforma.
   * - jumpBuffer: margen para registrar un salto pulsado justo antes de aterrizar.
   */
  coyoteTime: 0.1, // s
  jumpBuffer: 0.1, // s

  /** Salto variable: al soltar el botón en pleno ascenso, cortamos el impulso. */
  jumpCutMultiplier: 0.45,

  /** Número de saltos (1 = solo desde suelo; 2 = doble salto aéreo). */
  maxJumps: 2,

  /**
   * Agarre a la pared (wall slide):
   * - Si estás en el aire, cayendo, mirando y empujando hacia una pared que
   *   tocas, deslizas hacia abajo a wallSlideSpeed (mucho más lento que caer).
   * - Mientras te agarras, se recuperan los saltos.
   */
  wallSlideSpeed: 150, // px/s de caída máxima pegado a la pared

  /** Margen para bufferizar un ataque pulsado justo antes de poder usarlo (s). */
  attackBuffer: 0.14,

  /**
   * Hitstun (aturdimiento al recibir un golpe): durante este tiempo el jugador
   * no puede moverse ni atacar, solo lo arrastra el knockback. La duración base
   * se amplía con el daño del golpe recibido.
   */
  hitstunBase: 0.12, // s por golpe
  hitstunPerDamage: 0.012, // s extra por punto de daño del golpe

  /**
   * Wall jump: al saltar estando agarrado a una pared, el impulso es diagonal
   * (alejándose de la pared), no recto hacia arriba.
   */
  wallJumpSpeedY: 920, // impulso vertical del wall jump (px/s, hacia arriba)
  wallJumpSpeedX: 520, // impulso horizontal, alejándose de la pared (px/s)
  /**
   * Tras un wall jump bloqueamos el control horizontal un instante para que el
   * empuje de separación no se cancele al mantener la tecla hacia la pared.
   */
  wallJumpLockTime: 0.18, // s
} as const;

/**
 * Escudo / esquiva (al estilo Smash).
 *
 * Mantener el botón de escudo levanta una burbuja que se ENCOGE con el tiempo.
 * Mientras aguanta, reduce el daño recibido (y el knockback). Si se agota, el
 * escudo "se rompe" y queda un pequeño castigo. En el AIRE, pulsar escudo hace
 * una esquiva/impulso en la dirección apuntada (sirve para cambiar de dirección
 * en el aire / recuperar).
 */
export const SHIELD = {
  /** Radio de la burbuja a pleno escudo (px). */
  maxRadius: 42,
  /** Radio mínimo justo antes de romperse (px). */
  minRadius: 10,
  /** Tiempo en segundos de mantener el escudo hasta agotarlo del todo. */
  drainTime: 2.4,
  /** Tiempo de recarga completa al soltar (s). */
  regenTime: 3.2,
  /** Si el escudo se agota del todo, se bloquea este tiempo (rotura). */
  breakLockTime: 1.2,
  /** Fracción de daño que PASA con el escudo lleno (0.25 = absorbe el 75%). */
  damageTakenFull: 0.25,
  /** Fracción de knockback que pasa con el escudo lleno. */
  knockbackTakenFull: 0.35,

  /** Esquiva aérea: impulso (px/s) en la dirección apuntada. */
  airDodgeSpeed: 720,
  /** Esquiva aérea: duración de invulnerabilidad/control (s). */
  airDodgeTime: 0.22,
  /** Usos de esquiva aérea antes de tocar suelo/pared (como los saltos). */
  airDodgeMaxUses: 1,
} as const;
