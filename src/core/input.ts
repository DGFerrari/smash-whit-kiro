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
  };
}

/**
 * Lee el teclado y produce InputState. Detecta flancos (pressed/released) para
 * salto, ataque ligero y ataque fuerte.
 *
 * Controles:
 *   - Mover: A/D o flechas; agacharse/apuntar: S/↓, apuntar arriba: W/↑.
 *     (ojo: W/↑ también salta; para apuntar arriba sin saltar usa el eje.)
 *   - Salto: Espacio, W, ↑
 *   - Ligero: J
 *   - Fuerte (cargable): K
 */
export class KeyboardInput {
  private pressed = new Set<string>();
  private jumpConsumed = false;
  private lightConsumed = false;
  /** Estado del fuerte en el paso anterior, para detectar el "release". */
  private heavyWasHeld = false;

  private readonly left = new Set(["a", "arrowleft"]);
  private readonly right = new Set(["d", "arrowright"]);
  private readonly up = new Set(["w", "arrowup"]);
  private readonly down = new Set(["s", "arrowdown"]);
  private readonly jump = new Set(["w", "arrowup", " "]);
  private readonly light = new Set(["j"]);
  private readonly heavy = new Set(["k"]);

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
    if (this.jump.has(key) && !this.anyOf(this.jump)) this.jumpConsumed = false;
    if (this.light.has(key) && !this.anyOf(this.light)) {
      this.lightConsumed = false;
    }
  };

  private onBlur = (): void => {
    this.pressed.clear();
    this.jumpConsumed = false;
    this.lightConsumed = false;
    this.heavyWasHeld = false;
  };

  private isGameKey(key: string): boolean {
    return (
      this.left.has(key) ||
      this.right.has(key) ||
      this.up.has(key) ||
      this.down.has(key) ||
      this.jump.has(key) ||
      this.light.has(key) ||
      this.heavy.has(key)
    );
  }

  private anyOf(set: Set<string>): boolean {
    for (const k of set) if (this.pressed.has(k)) return true;
    return false;
  }

  sample(out: InputState): void {
    const l = this.anyOf(this.left);
    const r = this.anyOf(this.right);
    const u = this.anyOf(this.up);
    const d = this.anyOf(this.down);

    out.moveX = (r ? 1 : 0) - (l ? 1 : 0);
    out.moveY = (d ? 1 : 0) - (u ? 1 : 0);

    // Salto (flanco de subida).
    const jumpHeld = this.anyOf(this.jump);
    out.jumpHeld = jumpHeld;
    if (jumpHeld && !this.jumpConsumed) {
      out.jumpPressed = true;
      this.jumpConsumed = true;
    } else {
      out.jumpPressed = false;
    }

    // Ligero (flanco de subida).
    const lightHeld = this.anyOf(this.light);
    if (lightHeld && !this.lightConsumed) {
      out.lightPressed = true;
      this.lightConsumed = true;
    } else {
      out.lightPressed = false;
    }

    // Fuerte: held + detección de release (soltar tras mantener).
    const heavyHeld = this.anyOf(this.heavy);
    out.heavyHeld = heavyHeld;
    out.heavyReleased = this.heavyWasHeld && !heavyHeld;
    this.heavyWasHeld = heavyHeld;
  }
}
