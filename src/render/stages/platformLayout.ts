/**
 * Geometría visual de plataformas a partir de las cajas de colisión (R10.3).
 *
 * Módulo PURO (sin Three.js). Las cajas del motor se leen, nunca se escriben.
 *
 * Convenciones:
 *  - Mundo: y hacia ABAJO, `box.y` es el borde superior (donde se pisa).
 *  - Escena: y hacia ARRIBA (`sceneY = -worldY`).
 *  - La cara FRONTAL de las piezas de combate está en z = 0 (plano de juego),
 *    de modo que la proyección de los bordes superior/izquierdo/derecho
 *    coincide exactamente con la caja de colisión con cualquier zoom. La caja
 *    se extiende hacia el fondo (z negativo). Los luchadores nunca se solapan
 *    en XY con una plataforma sólida, así que no quedan tapados.
 *  - Piezas de combate (`body`, `cap`, `rim`) quedan DENTRO de la caja en XY y
 *    entre todas tocan sus bordes superior, izquierdo y derecho.
 *  - Decoración (`under`) queda entera POR DEBAJO del borde inferior de la caja;
 *    la decoración "detrás" se coloca con z < `platformBackZ(...)`.
 */
import type { AABB } from "../../engine/core/types.ts";
import { DEPTH } from "../../engine/config.ts";

export type VisualRole = "body" | "cap" | "rim" | "under";

/** Caja visual en coordenadas de escena (centro + tamaño). */
export interface VisualBox {
  role: VisualRole;
  cx: number;
  cy: number;
  cz: number;
  w: number;
  h: number;
  d: number;
}

export interface SceneBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  front: number;
  back: number;
}

/** Profundidad Z de la cara frontal de las plataformas. */
export const PLATFORM_FRONT_Z = 0;
/** Alto de la tapa superior de las sólidas. */
export const CAP_H = 10;
/** Grosor de los bordes emisivos (rim). */
export const RIM_W = 3;
/** Cuánto sobresale el rim por delante de la cara frontal (z > 0). */
export const RIM_D = 1.5;

/** Las cajas "suelo de borde a borde" (entrenamiento) no llevan bajos. */
const MAX_UNDERSIDE_W = 1500;

export function platformDepth(oneWay: boolean): number {
  return oneWay ? DEPTH.platformOneWay : DEPTH.platformSolid;
}

/** Z de la cara trasera: la decoración "detrás" debe quedar con z ≤ este valor. */
export function platformBackZ(oneWay: boolean): number {
  return PLATFORM_FRONT_Z - platformDepth(oneWay);
}

/** Rectángulo de combate (escena) de una caja de colisión. */
export function combatRect(box: AABB): { left: number; right: number; top: number; bottom: number } {
  return { left: box.x, right: box.x + box.w, top: -box.y, bottom: -(box.y + box.h) };
}

export function boundsOf(b: VisualBox): SceneBounds {
  return {
    left: b.cx - b.w / 2,
    right: b.cx + b.w / 2,
    top: b.cy + b.h / 2,
    bottom: b.cy - b.h / 2,
    front: b.cz + b.d / 2,
    back: b.cz - b.d / 2,
  };
}

/** Construye una caja a partir de sus bordes de escena. */
function fromEdges(
  role: VisualRole,
  left: number,
  right: number,
  top: number,
  bottom: number,
  front: number,
  back: number,
): VisualBox {
  return {
    role,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    cz: (front + back) / 2,
    w: right - left,
    h: top - bottom,
    d: front - back,
  };
}

export interface LayoutOptions {
  /** Generar bajos escalonados decorativos (solo sólidas). Por defecto `true`. */
  underside?: boolean;
}

/**
 * Piezas visuales de una plataforma. Determinista y sin aleatoriedad.
 * Sólida: tapa + cuerpo + rim superior/laterales/inferior + bajos escalonados.
 * Atravesable: cuerpo + rim superior + rim inferior.
 */
export function platformLayout(box: AABB, oneWay: boolean, opts: LayoutOptions = {}): VisualBox[] {
  const r = combatRect(box);
  const front = PLATFORM_FRONT_Z;
  const depth = platformDepth(oneWay);
  const back = front - depth;
  const rimFront = front + RIM_D;
  const rimH = Math.min(RIM_W, box.h / 4);
  const rimW = Math.min(RIM_W, box.w / 4);
  const parts: VisualBox[] = [];

  if (oneWay) {
    parts.push(fromEdges("body", r.left, r.right, r.top, r.bottom, front, back));
  } else {
    const capH = Math.min(CAP_H, box.h / 2);
    // Tapa ligeramente más profunda por detrás (nunca por delante: z = 0).
    parts.push(fromEdges("cap", r.left, r.right, r.top, r.top - capH, front, back - 0.5));
    parts.push(fromEdges("body", r.left, r.right, r.top - capH, r.bottom, front, back));
    // Rims laterales (por debajo del rim superior para no solaparse).
    parts.push(fromEdges("rim", r.left, r.left + rimW, r.top - rimH, r.bottom, rimFront, front));
    parts.push(fromEdges("rim", r.right - rimW, r.right, r.top - rimH, r.bottom, rimFront, front));
  }
  // Rim superior (borde de pisada) e inferior.
  parts.push(fromEdges("rim", r.left, r.right, r.top, r.top - rimH, rimFront, front));
  parts.push(fromEdges("rim", r.left + rimW, r.right - rimW, r.bottom + rimH, r.bottom, rimFront, front));

  const wantUnder = (opts.underside ?? true) && !oneWay && box.w <= MAX_UNDERSIDE_W;
  if (wantUnder) {
    // Bajos escalonados que se estrechan hacia abajo (roca/maquinaria).
    const steps = [
      { wf: 0.86, hf: 0.32, df: 0.9 },
      { wf: 0.6, hf: 0.3, df: 0.75 },
      { wf: 0.32, hf: 0.26, df: 0.55 },
    ];
    let top = r.bottom;
    const cx = (r.left + r.right) / 2;
    const zc = (front + back) / 2;
    for (const s of steps) {
      const w = box.w * s.wf;
      const h = box.h * s.hf;
      const d = depth * s.df;
      parts.push(fromEdges("under", cx - w / 2, cx + w / 2, top, top - h, zc + d / 2, zc - d / 2));
      top -= h;
    }
  }
  return parts;
}

/** ¿Es una pieza de la superficie de combate? */
export function isCombatRole(role: VisualRole): boolean {
  return role !== "under";
}
