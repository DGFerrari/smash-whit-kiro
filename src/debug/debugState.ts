/**
 * Estado de depuración compartido. Un único objeto que el panel de
 * desarrollador modifica y que el renderer (y quien haga falta) lee.
 *
 * Centralizarlo aquí hace trivial añadir nuevos toggles: añades un flag, un
 * checkbox en el menú de pausa (ui/pauseMenu.ts) y su dibujado en el renderer.
 */
export interface DebugState {
  /** Dibujar el rectángulo de la blast zone (borde invisible). */
  showBlastZone: boolean;
  /** Dibujar el contorno de la caja de colisión del jugador. */
  showHitboxes: boolean;
  /** Overlay con posición, velocidad y estado del jugador. */
  showStats: boolean;
  /** Mostrar FPS. */
  showFps: boolean;
  /** Marcar visualmente cuándo un jugador está aturdido (atacando o golpeado). */
  showStun: boolean;
  /**
   * Teñir al jugador según su estado (suelo/aire/pared). Si está desactivado,
   * el jugador usa siempre su color base. Útil para ver el estado de un vistazo.
   */
  showStateColors: boolean;
  /**
   * Fijar el dummy: se queda clavado en su posición, inmóvil, ignorando el
   * knockback (útil para practicar combos siempre en el mismo sitio).
   */
  dummyPinned: boolean;
  /**
   * Avisar visualmente cuando un jugador se queda sin saltos o sin usos de
   * ataque fuerte en el aire.
   */
  showResources: boolean;
}

/** Instancia global del estado de debug. Todo apunta a este mismo objeto. */
export const debug: DebugState = {
  showBlastZone: false,
  showHitboxes: false,
  showStats: false,
  showFps: false,
  showStun: false,
  showStateColors: true,
  dummyPinned: false,
  showResources: false,
};
