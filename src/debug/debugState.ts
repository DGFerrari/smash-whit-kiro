import { POV } from "../config.ts";

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
   * Comportamiento del dummy de entrenamiento:
   *  - "free": física normal, recibe golpes y knockback.
   *  - "freeze": clavado donde está, inmóvil, ignora el knockback.
   *  - "reposition": recibe golpes, pero si se queda quieto en el suelo unos
   *    segundos vuelve solo al centro del mapa.
   */
  dummyBehavior: "free" | "freeze" | "reposition";
  /**
   * Acción pendiente que el dummy debe EJECUTAR (la dispara un botón del menú y
   * la consume el World en el siguiente paso). null = nada pendiente.
   */
  dummyAction:
    | { kind: "light" | "heavy"; dir: "neutral" | "side" | "up" | "down" }
    | null;
  /**
   * Avisar visualmente cuando un jugador se queda sin saltos o sin usos de
   * ataque fuerte en el aire.
   */
  showResources: boolean;
  /**
   * POV: multiplicador de zoom que el jugador ajusta en Opciones. 1 = por
   * defecto; menor aleja (ves más campo), mayor acerca. No es realmente
   * "debug", pero vive aquí porque es el estado global compartido con el render.
   */
  povZoom: number;
}

/** Instancia global del estado de debug. Todo apunta a este mismo objeto. */
export const debug: DebugState = {
  showBlastZone: false,
  showHitboxes: false,
  showStats: false,
  showFps: false,
  showStun: false,
  showStateColors: true,
  dummyBehavior: "free",
  dummyAction: null,
  showResources: false,
  povZoom: POV.default,
};
