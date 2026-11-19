// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { button, dialog } from "../design/components.ts";
import {
  REPEAT_DELAY_MS,
  REPEAT_IDLE,
  REPEAT_INTERVAL_MS,
  createMenuNavigator,
  orderByGeometry,
  readGamepadIntent,
  stepRepeat,
  type GamepadLike,
  type MenuNavigator,
  type RepeatState,
} from "./menuNavigator.ts";
import { backHint, keyHint } from "./keyHints.ts";
import { legendItems, setLegend } from "./legend.ts";

function key(k: string, opts: KeyboardEventInit = {}): void {
  const t = document.activeElement ?? document.body;
  t.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
}

function pad(pressed: number[] = [], axes: number[] = [0, 0]): GamepadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) }));
  return { buttons, axes, connected: true };
}

let nav: MenuNavigator | null = null;
afterEach(() => {
  nav?.destroy();
  nav = null;
  document.body.innerHTML = "";
});

describe("orderByGeometry (R4.3)", () => {
  it("ordena por fila y columna y excluye ocultos y deshabilitados", () => {
    const r = (left: number, top: number) => ({ left, top, width: 100, height: 40 });
    const order = orderByGeometry([
      { item: "c", rect: r(0, 100), visible: true, disabled: false },
      { item: "b", rect: r(200, 2), visible: true, disabled: false },
      { item: "a", rect: r(0, 0), visible: true, disabled: false },
      { item: "hidden", rect: r(100, 0), visible: false, disabled: false },
      { item: "off", rect: r(300, 0), visible: true, disabled: true },
    ]);
    expect(order).toEqual(["a", "b", "c"]);
  });
});

describe("stepRepeat (R4.2)", () => {
  it("dispara al pulsar, a los 400 ms y luego cada 150 ms; soltar reinicia", () => {
    let s: RepeatState = REPEAT_IDLE;
    const fires: number[] = [];
    for (let t = 0; t <= 1000; t += 16) {
      const r = stepRepeat(s, "down", t);
      s = r.state;
      if (r.fire) fires.push(t);
    }
    expect(fires[0]).toBe(0);
    expect(fires[1]).toBeGreaterThanOrEqual(REPEAT_DELAY_MS);
    expect(fires[1]).toBeLessThanOrEqual(500);
    for (let i = 2; i < fires.length; i++) {
      expect(fires[i] - fires[i - 1]).toBeGreaterThanOrEqual(REPEAT_INTERVAL_MS);
    }
    expect(stepRepeat(s, null, 1100).state).toEqual(REPEAT_IDLE);
  });
});

describe("readGamepadIntent", () => {
  it("cruceta con prioridad, stick con zona muerta, A y B", () => {
    expect(readGamepadIntent([pad([12], [0, 0.9])]).dir).toBe("up");
    expect(readGamepadIntent([pad([], [0.2, 0.3])]).dir).toBeNull();
    expect(readGamepadIntent([pad([], [-0.9, 0.3])]).dir).toBe("left");
    expect(readGamepadIntent([null, pad([0, 1])])).toEqual({ dir: null, a: true, b: true });
  });
});

describe("createMenuNavigator", () => {
  function screen(labels: string[], onActivate = vi.fn()) {
    const root = document.createElement("div");
    const btns = labels.map((label) => button({ label, onActivate: () => onActivate(label) }));
    root.append(...btns);
    document.body.appendChild(root);
    return { root, btns, onActivate };
  }

  it("no intercepta teclas sin raíz montada", () => {
    nav = createMenuNavigator({ getGamepads: () => [] });
    const spy = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
    window.addEventListener("keydown", spy);
    key("ArrowDown");
    window.removeEventListener("keydown", spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.results[0].value).toBe(false);
  });

  it("foco inicial, Tab/flechas cíclicos y salta deshabilitados y ocultos", () => {
    nav = createMenuNavigator({ getGamepads: () => [] });
    const { root, btns } = screen(["A", "B", "C", "D"]);
    btns[1].disabled = true;
    btns[2].hidden = true;
    nav.mount(root);
    expect(document.activeElement).toBe(btns[0]);
    expect(btns[0].hasAttribute("data-focused")).toBe(true);
    key("Tab");
    expect(document.activeElement).toBe(btns[3]);
    key("ArrowDown");
    expect(document.activeElement).toBe(btns[0]);
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(btns[3]);
    expect(document.querySelectorAll("[data-focused]").length).toBe(1);
  });

  it("diálogo: trampa, Escape cierra y el foco vuelve al opener; la raíz superior gana", () => {
    nav = createMenuNavigator({ getGamepads: () => [] });
    const { root, btns } = screen(["Abrir", "Otro"]);
    nav.mount(root);
    const onOk = vi.fn();
    const d = dialog({
      title: "¿Salir?",
      body: [],
      actions: [button({ label: "Sí", onActivate: onOk }), button({ label: "No", onActivate: () => d.close() })],
    });
    d.open();
    nav.mount(d.el, { dialog: true });
    const [yes, no] = Array.from(d.el.querySelectorAll("button"));
    expect(document.activeElement).toBe(yes);
    key("Tab");
    expect(document.activeElement).toBe(no);
    key("Tab");
    expect(document.activeElement).toBe(yes);
    btns[1].focus(); // intento de salir del diálogo
    expect(d.el.contains(document.activeElement)).toBe(true);
    key("Escape");
    expect(d.el.isConnected).toBe(false);
    expect(onOk).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(btns[0]);
  });

  it("diálogo obligatorio ignora Escape; si el opener desaparece, foco al primero", () => {
    nav = createMenuNavigator({ getGamepads: () => [] });
    const { root, btns } = screen(["A", "B"]);
    nav.mount(root);
    btns[1].focus();
    const d = dialog({ title: "Aviso", body: [], actions: [button({ label: "OK", onActivate: () => {} })], mandatory: true });
    d.open();
    const unmount = nav.mount(d.el, { dialog: true, mandatory: true });
    key("Escape");
    expect(d.el.isConnected).toBe(true);
    btns[1].remove();
    d.close();
    unmount();
    expect(document.activeElement).toBe(btns[0]);
  });

  it("gamepad: mueve con repetición, A activa por flanco y B cierra el diálogo", () => {
    let pads: GamepadLike[] = [pad()];
    nav = createMenuNavigator({ getGamepads: () => pads });
    const { root, btns, onActivate } = screen(["A", "B", "C"]);
    nav.mount(root);
    pads = [pad([13])];
    nav.pollGamepad(0);
    expect(document.activeElement).toBe(btns[1]);
    nav.pollGamepad(200);
    expect(document.activeElement).toBe(btns[1]);
    nav.pollGamepad(400);
    expect(document.activeElement).toBe(btns[2]);
    pads = [pad([0])];
    nav.pollGamepad(500);
    nav.pollGamepad(516);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("C");

    const d = dialog({ title: "D", body: [], actions: [button({ label: "Sí", onActivate: () => {} })] });
    d.open();
    nav.mount(d.el, { dialog: true });
    pads = [pad([1])];
    nav.pollGamepad(600);
    expect(d.el.isConnected).toBe(false);
    expect(document.activeElement).toBe(btns[2]);
  });

  it("atajos: tecla y botón de mando activan su control; Escape activa el de volver", () => {
    let pads: GamepadLike[] = [pad()];
    nav = createMenuNavigator({ getGamepads: () => pads });
    const { root, btns, onActivate } = screen(["Jugar", "Aleatorio", "Atrás"]);
    keyHint(btns[1], "r", { pad: "x" });
    backHint(btns[2]);
    nav.mount(root);
    key("r");
    expect(onActivate).toHaveBeenLastCalledWith("Aleatorio");
    key("Escape");
    expect(onActivate).toHaveBeenLastCalledWith("Atrás");
    key("Backspace");
    expect(onActivate).toHaveBeenCalledTimes(3);
    // X del mando (índice 2), por flanco.
    pads = [pad([2])];
    nav.pollGamepad(0);
    nav.pollGamepad(16);
    expect(onActivate).toHaveBeenCalledTimes(4);
    expect(onActivate).toHaveBeenLastCalledWith("Aleatorio");
    // Deshabilitado u oculto: el atajo no hace nada.
    btns[1].hidden = true;
    key("r");
    expect(onActivate).toHaveBeenCalledTimes(4);
  });

  it("atajos de pantalla (hotkeys) y la tecla dibujada no ensucia el texto del botón", () => {
    nav = createMenuNavigator({ getGamepads: () => [] });
    const { root, btns } = screen(["Uno"]);
    keyHint(btns[0], "c");
    expect(btns[0].textContent).toBe("Uno");
    const fn = vi.fn();
    nav.mount(root, { hotkeys: { "1": fn } });
    key("1");
    expect(fn).toHaveBeenCalledTimes(1);
    // En un campo de texto las letras son del campo.
    const input = document.createElement("input");
    root.appendChild(input);
    input.focus();
    key("1");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("leyenda: mover/aceptar, extras, atajos y volver al final", () => {
    const updates: Array<string[] | null> = [];
    nav = createMenuNavigator({
      getGamepads: () => [],
      legend: { update: (ctx) => updates.push(ctx ? legendItems(ctx).map((i) => `${i.key}:${i.label}`) : null) },
    });
    const { root, btns } = screen(["Seguir", "‹ Atrás"]);
    keyHint(btns[0], "c", { label: "Continuar" });
    backHint(btns[1], "Atrás");
    setLegend(root, { accept: "Elegir", items: [{ key: "r", label: "Aleatorio" }] });
    const unmount = nav.mount(root);
    const last = () => updates[updates.length - 1];
    expect(last()).toEqual(["arrows:Mover", "enter:Elegir", "r:Aleatorio", "c:Continuar", "escape:Atrás"]);
    unmount();
    expect(last()).toBeNull();
  });
});
