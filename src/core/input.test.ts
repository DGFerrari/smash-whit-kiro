// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createInputState, KeyboardInput } from "./input.ts";

afterEach(() => {
  document.body.replaceChildren();
});

function press(target: EventTarget, key: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe("KeyboardInput y menús abiertos", () => {
  it("Enter sobre un botón de un menú montado es del menú (no se cancela ni salta)", () => {
    const input = new KeyboardInput("p2"); // p2: salto = Enter
    input.attach(window);
    const menu = document.createElement("div");
    menu.setAttribute("data-kb-nav-root", "");
    const btn = document.createElement("button");
    menu.appendChild(btn);
    document.body.appendChild(menu);

    const e = press(btn, "Enter");
    expect(e.defaultPrevented).toBe(false);
    const s = createInputState();
    input.sample(s);
    expect(s.jumpHeld).toBe(false);

    // Fuera de un menú abierto, Enter vuelve a ser la tecla de salto.
    menu.removeAttribute("data-kb-nav-root");
    const e2 = press(btn, "Enter");
    expect(e2.defaultPrevented).toBe(true);
    input.sample(s);
    expect(s.jumpHeld).toBe(true);
    input.detach(window);
  });
});
