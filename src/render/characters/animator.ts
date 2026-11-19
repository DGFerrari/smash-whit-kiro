import * as THREE from "three";

/**
 * Animador de personajes 3D (R11.3, R11.4, R11.7, R11.8, R11.9, R11.10;
 * Propiedades 25 y 26 del diseño).
 *
 * Dos capas:
 *  - Lógica PURA sin Three.js (`selectAnimState`, `transitionFor`, `stepYaw`,
 *    `resolveClipPlan`): decide qué estado toca, cómo se transita y qué clip
 *    lo representa. Es la parte que cubren las pruebas.
 *  - `CharacterAnimator`: adaptador fino sobre `THREE.AnimationMixer` que
 *    aplica esas decisiones a un modelo.
 *
 * Todo se deriva de una INSTANTÁNEA de solo lectura del jugador (R11.7): el
 * animador nunca escribe en el `Player` ni en ningún Estado_Simulación.
 */

/** Estados de animación de un personaje. */
export type AnimState =
  | "stun"
  | "dodge"
  | "shield"
  | "heavy"
  | "light"
  | "charge"
  | "wallSlide"
  | "jump"
  | "fall"
  | "run"
  | "idle"
  | "celebrate";

/** Todos los estados, en el orden de prioridad de R11.8 (+ `celebrate`). */
export const ANIM_STATES: readonly AnimState[] = [
  "stun",
  "dodge",
  "shield",
  "heavy",
  "light",
  "charge",
  "wallSlide",
  "jump",
  "fall",
  "run",
  "idle",
  "celebrate",
];

/**
 * Estado visual del jugador que necesita el animador. Es un objeto plano y de
 * solo lectura: se rellena desde el `Player` con `playerVisualState` o a mano
 * en las pruebas. Coordenadas del MUNDO (Y hacia abajo: `velY < 0` = sube).
 */
export interface PlayerVisualState {
  /** `Player.stunned` (hitstun activo). */
  readonly stunned: boolean;
  /** `Player.dodging` (esquiva aérea activa). */
  readonly dodging: boolean;
  /** `Player.shieldRadius` (0 si no hay escudo). */
  readonly shieldRadius: number;
  /** `Player.attack?.def.kind`, o `null` si no hay ataque en curso. */
  readonly attackKind: "light" | "heavy" | null;
  /** `Player.charging` (cargando el ataque pesado). */
  readonly charging: boolean;
  /** `Player.wallSliding`. */
  readonly wallSliding: boolean;
  /** `Player.onGround`. */
  readonly onGround: boolean;
  /** `Player.vel.x` (px/s). */
  readonly velX: number;
  /** `Player.vel.y` (px/s, Y hacia abajo). */
  readonly velY: number;
  /** `Player.facing`: 1 derecha, -1 izquierda. */
  readonly facing: 1 | -1;
}

/** Forma mínima del `Player` del motor que se lee (estructural, solo lectura). */
export interface PlayerLike {
  readonly stunned: boolean;
  readonly dodging: boolean;
  readonly shieldRadius: number;
  readonly attack: { readonly def: { readonly kind: "light" | "heavy" } } | null;
  readonly charging: boolean;
  readonly wallSliding: boolean;
  readonly onGround: boolean;
  readonly vel: { readonly x: number; readonly y: number };
  readonly facing: 1 | -1;
}

/** Copia los campos del jugador a una instantánea plana (no lo modifica). */
export function playerVisualState(p: PlayerLike): PlayerVisualState {
  return {
    stunned: p.stunned,
    dodging: p.dodging,
    shieldRadius: p.shieldRadius,
    attackKind: p.attack ? p.attack.def.kind : null,
    charging: p.charging,
    wallSliding: p.wallSliding,
    onGround: p.onGround,
    velX: p.vel.x,
    velY: p.vel.y,
    facing: p.facing,
  };
}

/**
 * Estado de animación de mayor prioridad entre los que se cumplen (R11.3,
 * R11.8): aturdimiento, esquiva, escudo, pesado, ligero, carga, pared, salto,
 * caída, carrera, reposo. `celebrate` no se selecciona aquí: lo fuerza el
 * post-partida (R11.9) con `CharacterAnimator.setCelebrating`.
 */
export function selectAnimState(v: PlayerVisualState): AnimState {
  if (v.stunned) return "stun";
  if (v.dodging) return "dodge";
  if (v.shieldRadius > 0) return "shield";
  if (v.attackKind === "heavy") return "heavy";
  if (v.attackKind === "light") return "light";
  if (v.charging) return "charge";
  if (v.wallSliding) return "wallSlide";
  if (!v.onGround) return v.velY < 0 ? "jump" : "fall";
  return v.velX !== 0 ? "run" : "idle";
}

// ---------------------------------------------------------------------------
// Transiciones (R11.10)
// ---------------------------------------------------------------------------

/** Duración del fundido cruzado entre estados (s); ≤ 150 ms por R11.10. */
export const CROSSFADE_SECONDS = 0.12;

/** Estados que arrancan sin fundido, en su primer fotograma activo. */
export const INSTANT_STATES: ReadonlySet<AnimState> = new Set<AnimState>([
  "light",
  "heavy",
  "dodge",
]);

/** Estados que se reproducen una sola vez y se quedan en su último fotograma. */
const ONE_SHOT_STATES: ReadonlySet<AnimState> = new Set<AnimState>([
  "light",
  "heavy",
  "dodge",
]);

export type Transition =
  | { readonly kind: "none" }
  | { readonly kind: "instant" }
  | { readonly kind: "crossfade"; readonly duration: number };

/** Cómo pasar de `prev` a `next` (pura). `prev = null` = primer estado. */
export function transitionFor(prev: AnimState | null, next: AnimState): Transition {
  if (prev === next) return { kind: "none" };
  if (prev === null || INSTANT_STATES.has(next)) return { kind: "instant" };
  return { kind: "crossfade", duration: CROSSFADE_SECONDS };
}

// ---------------------------------------------------------------------------
// Orientación (R11.4)
// ---------------------------------------------------------------------------

/** Duración de un giro completo de -90° a +90° (s); ≤ 100 ms por R11.4. */
export const TURN_SECONDS = 0.08;
/** Velocidad angular (rad/s) para que el giro de π dure `TURN_SECONDS`. */
export const YAW_SPEED = Math.PI / TURN_SECONDS;

/** Yaw objetivo del modelo: +90° mirando a la derecha, -90° a la izquierda. */
export function targetYaw(facing: 1 | -1): number {
  return facing * (Math.PI / 2);
}

/** Avanza `current` hacia `target` a `YAW_SPEED` durante `dt` s (pura). */
export function stepYaw(current: number, target: number, dt: number): number {
  const maxStep = YAW_SPEED * Math.max(0, dt);
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

// ---------------------------------------------------------------------------
// Clips y sustitutos
// ---------------------------------------------------------------------------

/**
 * Sustitutos cuando falta el clip de un estado, por orden de preferencia
 * (diseño: `fall → jump`, `wallSlide → fall`, `charge → heavy` congelado).
 * Si ninguno existe se usa `idle` y, en último término, el primer clip.
 */
const CLIP_FALLBACKS: Readonly<Record<AnimState, readonly AnimState[]>> = {
  stun: ["fall"],
  dodge: ["jump", "fall"],
  shield: [],
  heavy: ["light"],
  light: ["heavy"],
  charge: ["heavy"],
  wallSlide: ["fall", "jump"],
  jump: ["fall"],
  fall: ["jump"],
  run: [],
  idle: [],
  celebrate: [],
};

/** Clip elegido para un estado. `frozen` = se muestra en pausa (pose fija). */
export interface ClipChoice {
  readonly clip: string;
  readonly frozen: boolean;
}

/** Fracción del clip pesado en la que se congela la pose de carga. */
export const CHARGE_FREEZE_FRACTION = 0.3;

/**
 * Resuelve qué clip representa cada estado (pura). `names` son los nombres de
 * clip disponibles en el archivo; `mapping` es `CharacterDef.animationClips`
 * (estado → nombre del clip). Sin mapeo se busca un clip llamado como el
 * estado (sin distinguir mayúsculas). Devuelve `null` en todos los estados si
 * el modelo no trae ningún clip.
 */
export function resolveClipPlan(
  names: readonly string[],
  mapping: Partial<Record<AnimState, string>> = {},
): Record<AnimState, ClipChoice | null> {
  const byLower = new Map<string, string>();
  for (const n of names) byLower.set(n.toLowerCase(), n);

  const own = (s: AnimState): string | null => {
    const mapped = mapping[s];
    if (mapped !== undefined && names.includes(mapped)) return mapped;
    return byLower.get(s.toLowerCase()) ?? null;
  };

  const plan = {} as Record<AnimState, ClipChoice | null>;
  for (const s of ANIM_STATES) {
    let choice: ClipChoice | null = null;
    const direct = own(s);
    if (direct) {
      choice = { clip: direct, frozen: false };
    } else {
      for (const alt of CLIP_FALLBACKS[s]) {
        const c = own(alt);
        if (c) {
          // La carga reutiliza el pesado como pose fija (diseño).
          choice = { clip: c, frozen: s === "charge" && alt === "heavy" };
          break;
        }
      }
      if (!choice) {
        const idle = own("idle") ?? names[0] ?? null;
        if (idle) choice = { clip: idle, frozen: false };
      }
    }
    plan[s] = choice;
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Adaptador Three.js
// ---------------------------------------------------------------------------

/**
 * Controla las animaciones y el giro de un modelo. Uso por frame:
 *
 *   animator.update(playerVisualState(player), dtSeconds);
 *
 * Tolera modelos sin clips o con clips incompletos: los estados sin clip usan
 * un sustituto y, si no hay ninguno, solo se aplica el giro.
 */
export class CharacterAnimator {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimState, THREE.AnimationAction>();
  private current: AnimState | null = null;
  private celebrating = false;
  private yaw: number | null = null;

  constructor(
    private readonly root: THREE.Object3D,
    clips: readonly THREE.AnimationClip[],
    mapping: Partial<Record<AnimState, string>> = {},
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    const byName = new Map(clips.map((c) => [c.name, c] as const));
    const plan = resolveClipPlan(
      clips.map((c) => c.name),
      mapping,
    );

    for (const s of ANIM_STATES) {
      const choice = plan[s];
      if (!choice) continue;
      const base = byName.get(choice.clip);
      if (!base) continue;
      // Un estado congelado necesita su propia acción: el mixer cachea una
      // acción por clip, así que se clona para no pausar la del pesado.
      const clip = choice.frozen ? base.clone() : base;
      const action = this.mixer.clipAction(clip);
      if (choice.frozen) {
        action.time = clip.duration * CHARGE_FREEZE_FRACTION;
        action.timeScale = 0;
      } else if (ONE_SHOT_STATES.has(s)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.actions.set(s, action);
    }
  }

  /** Estado de animación que se está mostrando (o `null` antes del primero). */
  get state(): AnimState | null {
    return this.current;
  }

  /** Yaw actual aplicado al modelo (rad), o `null` antes del primer frame. */
  get currentYaw(): number | null {
    return this.yaw;
  }

  /** Fuerza (o deja de forzar) la celebración del ganador (R11.9). */
  setCelebrating(on: boolean): void {
    this.celebrating = on;
  }

  /** Avanza un frame a partir del estado visual interpolado del jugador. */
  update(v: PlayerVisualState, dt: number): void {
    const next = this.celebrating ? "celebrate" : selectAnimState(v);
    this.applyState(next);
    this.applyYaw(v.facing, dt);
    this.mixer.update(Math.max(0, dt));
  }

  /** Libera las acciones y la caché del mixer. */
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.actions.clear();
  }

  private applyState(next: AnimState): void {
    const prev = this.current;
    const t = transitionFor(prev, next);
    if (t.kind === "none") return;
    this.current = next;

    const from = prev ? this.actions.get(prev) : undefined;
    const to = this.actions.get(next);
    if (!to) {
      // Sin clip (modelo sin animaciones): solo se registra el estado.
      return;
    }
    const frozen = to.timeScale === 0;
    const startTime = frozen ? to.time : 0;

    if (from === to) {
      // Mismo clip por sustitución: solo se reinicia si el estado lo pide.
      if (t.kind === "instant") to.reset().play();
      return;
    }

    to.reset();
    if (frozen) {
      to.time = startTime;
      to.setEffectiveTimeScale(0);
    }
    to.setEffectiveWeight(1).play();

    if (t.kind === "instant" || !from) {
      // Fundido 0: la nueva animación ocupa el primer frame entero (R11.10).
      for (const [s, a] of this.actions) if (s !== next && a !== to) a.stop();
    } else {
      from.crossFadeTo(to, t.duration, false);
    }
  }

  private applyYaw(facing: 1 | -1, dt: number): void {
    const target = targetYaw(facing);
    this.yaw = this.yaw === null ? target : stepYaw(this.yaw, target, dt);
    this.root.rotation.y = this.yaw;
  }
}
