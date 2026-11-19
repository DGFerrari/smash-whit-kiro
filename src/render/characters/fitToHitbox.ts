/**
 * Ajuste de un modelo de personaje a la caja de colisión del jugador
 * (R11.2, R12.1; Propiedad 24 del diseño).
 *
 * Módulo puro: no depende de Three.js. Recibe números planos y devuelve la
 * escala y la traslación que el adaptador aplica al `Object3D` del modelo:
 *
 *   object.scale.set(fit.scaleX, fit.scaleY, fit.scaleZ);
 *   object.position.set(fit.offsetX, fit.offsetY, z);
 *
 * ESPACIO DE COORDENADAS: todo se expresa en ESPACIO DE ESCENA (Y hacia
 * arriba), que es el espacio de `THREE.Box3` del modelo. El mundo de la
 * Simulación tiene Y hacia abajo (`sceneY = -worldY`); para convertir la caja
 * de colisión del motor usa `worldBoxToSceneHitbox`, que transforma el borde
 * inferior del mundo (`y + h`) en `bottomY = -(y + h)` de escena.
 */

/** Tolerancia admitida en ancho y alto respecto a la caja de colisión (±15 %). */
export const FIT_TOLERANCE = 0.15;

/**
 * Banda de proporción `sx / sy` en la que se usa escala uniforme `s = sy`.
 * Dentro de ella el error horizontal de la escala uniforme (`sy / sx`) queda
 * en [0,87; 1,15], es decir, dentro de ±15 %.
 */
export const UNIFORM_RATIO_MIN = 0.87;
export const UNIFORM_RATIO_MAX = 1.15;

/** Caja envolvente del modelo en su espacio local de escena (Y arriba). */
export interface ModelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Caja de colisión en espacio de escena (Y arriba). */
export interface SceneHitbox {
  /** Centro horizontal de la caja. */
  centerX: number;
  /** Borde inferior (pies) de la caja: el menor Y de escena. */
  bottomY: number;
  width: number;
  height: number;
}

/** Caja AABB del motor (Y abajo; `x`,`y` = esquina superior izquierda). */
export interface WorldBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FitResult {
  scaleX: number;
  scaleY: number;
  /** Profundidad: sigue a la escala horizontal para no deformar la sección. */
  scaleZ: number;
  offsetX: number;
  offsetY: number;
  /** `true` si se aplicó escala uniforme (`scaleX === scaleY`). */
  uniform: boolean;
}

/** Convierte una AABB del mundo (Y abajo) a caja de colisión de escena (Y arriba). */
export function worldBoxToSceneHitbox(box: WorldBox): SceneHitbox {
  return {
    centerX: box.x + box.w / 2,
    bottomY: -(box.y + box.h),
    width: box.w,
    height: box.h,
  };
}

const isPositiveFinite = (n: number): boolean => Number.isFinite(n) && n > 0;

/**
 * Calcula escala y traslación para que la silueta del modelo coincida con la
 * caja de colisión: alto exacto (`sy = hh / bh`), ancho dentro de ±15 %, base
 * del modelo (`minY`) sobre el borde inferior de la caja y centro X alineado.
 *
 * - Si `sx / sy ∈ [0,87; 1,15]` se usa escala uniforme `s = sy`.
 * - Si no, escala no uniforme acotada: `sx` se limita lo más cerca posible de
 *   `sy` (menos deformación) sin salir de ±15 % del ancho de la caja.
 *
 * @throws RangeError si alguna dimensión no es finita y positiva.
 */
export function fitToHitbox(bbox: ModelBounds, hitbox: SceneHitbox): FitResult {
  const bw = bbox.maxX - bbox.minX;
  const bh = bbox.maxY - bbox.minY;
  if (!isPositiveFinite(bw) || !isPositiveFinite(bh)) {
    throw new RangeError(`fitToHitbox: caja del modelo degenerada (${bw} x ${bh})`);
  }
  if (!isPositiveFinite(hitbox.width) || !isPositiveFinite(hitbox.height)) {
    throw new RangeError(
      `fitToHitbox: caja de colisión inválida (${hitbox.width} x ${hitbox.height})`,
    );
  }

  const exactSx = hitbox.width / bw;
  const sy = hitbox.height / bh;
  const ratio = exactSx / sy;

  let sx: number;
  let uniform: boolean;
  if (ratio >= UNIFORM_RATIO_MIN && ratio <= UNIFORM_RATIO_MAX) {
    sx = sy;
    uniform = true;
  } else {
    const lo = exactSx * (1 - FIT_TOLERANCE);
    const hi = exactSx * (1 + FIT_TOLERANCE);
    sx = Math.min(hi, Math.max(lo, sy));
    uniform = false;
  }

  const modelCenterX = (bbox.minX + bbox.maxX) / 2;
  return {
    scaleX: sx,
    scaleY: sy,
    scaleZ: sx,
    offsetX: hitbox.centerX - modelCenterX * sx,
    offsetY: hitbox.bottomY - bbox.minY * sy,
    uniform,
  };
}
