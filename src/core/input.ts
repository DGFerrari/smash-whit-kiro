import { bindings, type Action, type PlayerSlot } from "./bindings.ts";
import { type InputState } from "../engine/core/inputState.ts";

// El tipo y su constructor viven en `inputState.ts` (módulo PURO, sin
// navegador) para que el motor pueda importarlos sin arrastrar `localStorage`.
// Los re-exportamos aquí por comodidad de los consumidores de cliente (loop,
// pantallas) que ya importan ambas cosas desde "core/input.ts".
export { createInputState, type InputState } from "../engine/core/inputState.ts";

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
