import { bindings, type Action, type PlayerSlot } from "./bindings.ts";

/**
 * Estado de intención de un jugador para un paso de simulación.
 *
 * Importante: la física NUNCA lee el teclado directamente. Lee este objeto.
 * Así, la misma lógica de jugador sirve para:
 *   - un humano (teclado rellena el InputState),
 *   - una IA (single player),
 *   - la red (multiplayer / rollback).
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

/**
 * Lee el teclado y produce InputState a partir de un perfil de teclas
 * configurable (ver core/bindings.ts). Detecta flancos (pressed/released).
 *
 * Nota de diseño: "arriba" ya NO salta. El salto tiene su propia tecla; W/↑
 * solo sirven para apuntar la dirección del ataque.
 *
 * Una instancia por jugador (slot "p1" / "p2"). Varias instancias pueden
 * compartir el mismo `window`: cada una filtra solo sus propias teclas.
 */
export class KeyboardInput {
  private pressed = new Set<string>();
  private jumpConsumed = false;
  private lightConsumed = false;
  private shieldConsumed = false;
  /** Estado del fuerte en el paso anterior, para detectar el "release". */
  private heavyWasHeld = false;

  constructor(private readonly slot: PlayerSlot = "p1") {}

  /** Teclas asignadas a una acción de este jugador (lectura en vivo). */
  private keysFor(action: Action): string[] {
    return bindings[this.slot][action];
  }

  attach(target: Window = window): void {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("blur", this.onBlur);
  }

  detach(target: Window = window): void {
    target.removeEventListener("keydown", this.onKeyDown);
    target.removeEventListener("keyup", this.onKeyUp);
    target.removeEventListener("blur", this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (this.isGameKey(key)) e.preventDefault();
    this.pressed.add(key);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    this.pressed.delete(key);
    if (!this.anyOf("jump")) this.jumpConsumed = false;
    if (!this.anyOf("light")) this.lightConsumed = false;
    if (!this.anyOf("shield")) this.shieldConsumed = false;
  };

  private onBlur = (): void => {
    this.pressed.clear();
    this.jumpConsumed = false;
    this.lightConsumed = false;
    this.shieldConsumed = false;
    this.heavyWasHeld = false;
  };

  private isGameKey(key: string): boolean {
    const b = bindings[this.slot];
    for (const action of Object.keys(b) as Action[]) {
      if (b[action].includes(key)) return true;
    }
    return false;
  }

  private anyOf(action: Action): boolean {
    for (const k of this.keysFor(action)) if (this.pressed.has(k)) return true;
    return false;
  }

  sample(out: InputState): void {
    const l = this.anyOf("left");
    const r = this.anyOf("right");
    const u = this.anyOf("up");
    const d = this.anyOf("down");

    out.moveX = (r ? 1 : 0) - (l ? 1 : 0);
    out.moveY = (d ? 1 : 0) - (u ? 1 : 0);

    // Salto (flanco de subida).
    const jumpHeld = this.anyOf("jump");
    out.jumpHeld = jumpHeld;
    if (jumpHeld && !this.jumpConsumed) {
      out.jumpPressed = true;
      this.jumpConsumed = true;
    } else {
      out.jumpPressed = false;
    }

    // Ligero (flanco de subida).
    const lightHeld = this.anyOf("light");
    if (lightHeld && !this.lightConsumed) {
      out.lightPressed = true;
      this.lightConsumed = true;
    } else {
      out.lightPressed = false;
    }

    // Fuerte: held + detección de release (soltar tras mantener).
    const heavyHeld = this.anyOf("heavy");
    out.heavyHeld = heavyHeld;
    out.heavyReleased = this.heavyWasHeld && !heavyHeld;
    this.heavyWasHeld = heavyHeld;

    // Escudo / esquiva: held + flanco de subida.
    const shieldHeld = this.anyOf("shield");
    out.shieldHeld = shieldHeld;
    if (shieldHeld && !this.shieldConsumed) {
      out.shieldPressed = true;
      this.shieldConsumed = true;
    } else {
      out.shieldPressed = false;
    }
  }
}
