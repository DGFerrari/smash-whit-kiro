/**
 * Estado de intención de un jugador para un paso de simulación.
 *
 * Importante: la física NUNCA lee el teclado directamente. Lee este objeto.
 * Así, la misma lógica de jugador sirve para:
 *   - un humano (teclado rellena el InputState),
 *   - una IA (single player),
 *   - la red (multiplayer / rollback).
 *
 * Este módulo es PURO (sin navegador): define el tipo y su constructor. Vive
 * aparte de `KeyboardInput` (que sí lee el teclado y los bindings) para que el
 * MOTOR de simulación pueda importar solo el tipo sin arrastrar `localStorage`
 * ni el DOM. El lector de teclado está en `core/input.ts`.
 */
export interface InputState {
  /** Eje horizontal deseado: -1 izquierda, 0 nada, +1 derecha. */
  moveX: number;
  /** Eje vertical deseado: -1 arriba, 0 nada, +1 abajo (para dirección de ataque). */
  moveY: number;
  /** El botón de salto está mantenido en este paso. */
  jumpHeld: boolean;
  /** El botón de salto se acaba de pulsar en este paso (flanco de subida). */
  jumpPressed: boolean;
  /** El botón de ataque ligero se acaba de pulsar (flanco de subida). */
  lightPressed: boolean;
  /** El botón de ataque fuerte está mantenido (para cargar). */
  heavyHeld: boolean;
  /** El botón de ataque fuerte se acaba de soltar (lanza el cargado). */
  heavyReleased: boolean;
  /** El botón de escudo/esquiva está mantenido. */
  shieldHeld: boolean;
  /** El botón de escudo/esquiva se acaba de pulsar (flanco de subida). */
  shieldPressed: boolean;
}

export function createInputState(): InputState {
  return {
    moveX: 0,
    moveY: 0,
    jumpHeld: false,
    jumpPressed: false,
    lightPressed: false,
    heavyHeld: false,
    heavyReleased: false,
    shieldHeld: false,
    shieldPressed: false,
  };
}
