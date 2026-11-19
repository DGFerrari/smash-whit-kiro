/**
 * Animaciones de fondo de los escenarios (R10.2, R10.5, R10.6, R10.9).
 *
 * Módulo PURO (sin Three.js): calcula la pose de cada prop animado a partir del
 * tiempo de render (segundos, derivado de `performance.now()`), nunca de ticks
 * ni del estado del motor. Toda pose es periódica: `pose(t) === pose(t + P)`
 * con `P = period / speed`, y continua dentro del periodo, así el bucle no da
 * saltos. Los campos "cíclicos" (`scroll`) viven en [0, 1) y se interpretan
 * módulo 1 (offset de textura, fracción de trayecto con fundido, giro 2π…).
 */
import type { Level } from "../quality/visualPrefs.ts";

/** Tipo de curva de animación. */
export type PoseKind =
  | "drift" // trayecto lineal en bucle (scroll) + leve vaivén vertical + fundido en los extremos
  | "fall" // caída / desplazamiento lineal en bucle (scroll)
  | "spin" // giro continuo (rot = 2π·scroll)
  | "bob" // flotación senoidal vertical
  | "sway" // balanceo angular senoidal
  | "wave" // onda: scroll lineal + vaivén vertical
  | "pulse" // intensidad que respira (suave, no es parpadeo)
  | "flicker" // parpadeo de letreros (constante con Movimiento_Reducido)
  | "scan"; // barrido lineal con fundido en los extremos

/** Apariencia que construye `propBuilders.ts` para cada prop. */
export type PropVisual =
  // Distrito Neón
  | "hoverTraffic"
  | "billboards"
  | "rain"
  | "hologram"
  | "searchlights"
  | "dirigible"
  // Risco de Pradera
  | "clouds"
  | "waterfall"
  | "grass"
  | "birds"
  | "pollen"
  | "sunRays"
  // Santuario del Alba
  | "lanterns"
  | "aurora"
  | "crystals"
  | "seaWaves"
  | "driftIslands"
  | "lightShafts"
  // Sala de Pruebas
  | "scanLine"
  | "dataPanels"
  | "spotlights"
  | "dust"
  | "drone"
  | "scoreboard";

/** Rectángulo en coordenadas de ESCENA (x a la derecha, y hacia ARRIBA). */
export interface SceneArea {
  /** Centro X. */
  x: number;
  /** Centro Y. */
  y: number;
  w: number;
  h: number;
}

export interface AnimatedPropDef {
  id: string;
  visual: PropVisual;
  pose: PoseKind;
  /** Periodo del bucle en segundos a velocidad normal. */
  period: number;
  /**
   * Amplitud base: unidades de escena para bob/drift/wave, radianes para sway,
   * profundidad [0, 1] para pulse/flicker. Ignorada en fall/spin/scan.
   */
  amplitude: number;
  /** Desfase inicial en fracción de periodo [0, 1). */
  phase?: number;
  /** Semilla visual (posiciones, patrón de parpadeo). */
  seed: number;
  /** Z de escena del prop (decide su capa). */
  z: number;
  area: SceneArea;
  color: string;
  accent?: string;
  count?: number;
  /**
   * Si el prop no está entre los N animados: `true` lo oculta (partículas que
   * no tienen sentido congeladas); `false` lo deja visible en su pose t = 0.
   */
  hideWhenStatic?: boolean;
}

/** Pose resultante. Campos continuos + `scroll` cíclico módulo 1. */
export interface PropPose {
  /** Fase del bucle en [0, 1) (cíclico). */
  scroll: number;
  /** Amplitud efectiva (ya escalada por Movimiento_Reducido). */
  amp: number;
  x: number;
  y: number;
  rot: number;
  scale: number;
  opacity: number;
  intensity: number;
}

/** N props animados por nivel (R10.5). Conjuntos acumulativos por prioridad. */
export const PROP_COUNT_BY_LEVEL: Readonly<Record<Level, number>> = Object.freeze({
  desactivado: 0,
  bajo: 2,
  medio: 4,
  alto: 6,
});

/** Factores de Movimiento_Reducido (R10.9). */
export const REDUCED_MOTION = Object.freeze({ speed: 0.4, amplitude: 0.5 });

export interface MotionFactors {
  speed: number;
  amplitude: number;
  /** ¿Se permiten parpadeos? (no con Movimiento_Reducido). */
  blink: boolean;
}

export function motionFactors(reducedMotion: boolean): MotionFactors {
  return reducedMotion
    ? { speed: REDUCED_MOTION.speed, amplitude: REDUCED_MOTION.amplitude, blink: false }
    : { speed: 1, amplitude: 1, blink: true };
}

export function animatedPropCount(level: Level): number {
  return PROP_COUNT_BY_LEVEL[level] ?? 0;
}

/** Los N primeros (por prioridad) que se animan en `level`. */
export function selectAnimatedProps<T>(defs: readonly T[], level: Level): T[] {
  return defs.slice(0, Math.min(defs.length, animatedPropCount(level)));
}

export function isPropAnimated(index: number, level: Level): boolean {
  return index >= 0 && index < animatedPropCount(level);
}

/** Periodo real del bucle (s) teniendo en cuenta Movimiento_Reducido. */
export function effectivePeriod(def: Pick<AnimatedPropDef, "period">, reducedMotion: boolean): number {
  return def.period / motionFactors(reducedMotion).speed;
}

function fract(v: number): number {
  const f = v - Math.floor(v);
  return f >= 1 ? 0 : f;
}

/** Fase [0, 1) del prop en el instante `t` (segundos de render). */
export function propPhase(
  def: Pick<AnimatedPropDef, "period" | "phase">,
  t: number,
  reducedMotion: boolean,
): number {
  const p = effectivePeriod(def, reducedMotion);
  if (!(p > 0) || !Number.isFinite(t)) return fract(def.phase ?? 0);
  return fract(t / p + (def.phase ?? 0));
}

const TAU = Math.PI * 2;

/** Pseudoaleatorio puro en [0, 1) (hash de seno), estable por semilla e índice. */
export function hash01(seed: number, i: number): number {
  const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Distancia circular entre dos fases de [0, 1). */
function cyclicDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

/**
 * Parpadeo continuo: 3 caídas breves (ventana coseno) en fases fijas por
 * semilla. Devuelve intensidad en [1 - depth, 1]. Periódico y sin saltos.
 */
export function flickerIntensity(u: number, seed: number, depth: number): number {
  const width = 0.045;
  let dip = 0;
  for (let i = 0; i < 3; i++) {
    const d = cyclicDist(u, hash01(seed, i));
    if (d < width) dip = Math.max(dip, 0.5 + 0.5 * Math.cos((Math.PI * d) / width));
  }
  return 1 - depth * dip;
}

/** Fundido de extremos de un trayecto en bucle: 0 en u = 0 y u = 1. */
export function edgeFade(u: number): number {
  return Math.min(1, Math.max(0, 4 * Math.sin(Math.PI * u)));
}

/** Pose en reposo (t = 0 sin desfase) — útil como valor neutro. */
export const NEUTRAL_POSE: Readonly<PropPose> = Object.freeze({
  scroll: 0,
  amp: 0,
  x: 0,
  y: 0,
  rot: 0,
  scale: 1,
  opacity: 1,
  intensity: 1,
});

/** Pose del prop en el instante `t` (segundos de render). Función pura. */
export function propPose(def: AnimatedPropDef, t: number, reducedMotion: boolean): PropPose {
  const m = motionFactors(reducedMotion);
  const u = propPhase(def, t, reducedMotion);
  const amp = def.amplitude * m.amplitude;
  const s = Math.sin(TAU * u);
  const c = Math.cos(TAU * u);
  const pose: PropPose = { ...NEUTRAL_POSE, scroll: u, amp };

  switch (def.pose) {
    case "drift":
      pose.y = amp * Math.sin(TAU * 2 * u);
      pose.opacity = edgeFade(u);
      break;
    case "fall":
      break;
    case "spin":
      pose.rot = TAU * u;
      pose.y = amp * s;
      break;
    case "bob":
      pose.y = amp * s;
      pose.rot = 0.08 * m.amplitude * c;
      break;
    case "sway":
      pose.rot = amp * s;
      break;
    case "wave":
      pose.y = amp * s;
      pose.x = amp * 0.5 * c;
      break;
    case "pulse":
      pose.intensity = 1 - Math.min(1, amp) * (0.5 - 0.5 * c);
      pose.scale = 1 + 0.05 * m.amplitude * s;
      break;
    case "flicker":
      // Con Movimiento_Reducido los parpadeos quedan a intensidad constante.
      pose.intensity = m.blink ? flickerIntensity(u, def.seed, Math.min(1, def.amplitude)) : 1;
      break;
    case "scan":
      pose.opacity = edgeFade(u);
      break;
  }
  return pose;
}

// ---------------------------------------------------------------------------
// Controlador (sin Three.js): decide qué props se animan, cuáles se congelan
// en su pose t = 0 y cuáles se ocultan, y aplica las poses cada frame.
// ---------------------------------------------------------------------------

/** Adaptador mínimo que implementa cada prop construido en Three.js. */
export interface PropHandle {
  apply(pose: PropPose): void;
  setVisible(visible: boolean): void;
}

export class PropController {
  private level: Level;
  private reducedMotion: boolean;

  constructor(
    private readonly defs: readonly AnimatedPropDef[],
    private readonly handles: readonly PropHandle[],
    level: Level,
    reducedMotion = false,
  ) {
    this.level = level;
    this.reducedMotion = reducedMotion;
    this.refresh();
  }

  /** Cambia el nivel de animaciones de fondo (R10.7): solo visibilidad/poses. */
  setLevel(level: Level): void {
    if (level === this.level) return;
    this.level = level;
    this.refresh();
  }

  getLevel(): Level {
    return this.level;
  }

  /** Ids de los props animados en el nivel actual (por prioridad). */
  animatedIds(): string[] {
    return selectAnimatedProps(this.defs, this.level).map((d) => d.id);
  }

  /** Avanza las animaciones. `t` en segundos de render (`performance.now()/1000`). */
  update(t: number, reducedMotion: boolean): void {
    if (reducedMotion !== this.reducedMotion) {
      this.reducedMotion = reducedMotion;
      this.refresh();
    }
    const n = Math.min(this.defs.length, animatedPropCount(this.level));
    for (let i = 0; i < n; i++) this.handles[i]?.apply(propPose(this.defs[i], t, reducedMotion));
  }

  private refresh(): void {
    this.defs.forEach((def, i) => {
      const h = this.handles[i];
      if (!h) return;
      const animated = isPropAnimated(i, this.level);
      h.setVisible(animated || !def.hideWhenStatic);
      if (!animated) h.apply(propPose(def, 0, this.reducedMotion));
    });
  }
}
