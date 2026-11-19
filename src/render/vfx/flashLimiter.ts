/**
 * Limitador de destellos a pantalla completa (R9.7).
 *
 * Con Movimiento_Reducido, los destellos cuya área proyectada supera el 25 %
 * del viewport se aceptan como máximo 3 veces en la ventana deslizante
 * `(now − 1000, now]`. Los destellos ≤ 25 % (o sin Movimiento_Reducido) no
 * pasan por el limitador ni consumen cupo.
 */

export const FLASH_WINDOW_MS = 1000;
export const FLASH_MAX_IN_WINDOW = 3;
export const FLASH_AREA_THRESHOLD = 0.25;

export interface FlashLimiter {
  /** ¿Se puede mostrar el destello? Si sí y está limitado, consume cupo. */
  tryFlash(nowMs: number, areaFraction: number, reducedMotion: boolean): boolean;
  /** Consulta directa del limitador para un destello grande. */
  allow(nowMs: number): boolean;
  reset(): void;
}

export function createFlashLimiter(): FlashLimiter {
  // Cola fija de instantes aceptados (como mucho FLASH_MAX_IN_WINDOW).
  const accepted: number[] = [];

  const allow = (now: number): boolean => {
    while (accepted.length > 0 && accepted[0] <= now - FLASH_WINDOW_MS) accepted.shift();
    if (accepted.length >= FLASH_MAX_IN_WINDOW) return false;
    accepted.push(now);
    return true;
  };

  return {
    allow,
    tryFlash(now, areaFraction, reducedMotion) {
      if (!reducedMotion || !(areaFraction > FLASH_AREA_THRESHOLD)) return true;
      return allow(now);
    },
    reset() {
      accepted.length = 0;
    },
  };
}
