// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  button,
  card,
  dialog,
  levelSelect,
  requestActivate,
  setDisabled,
  slider,
  tabs,
  toggle,
} from "./components.ts";

function key(el: HTMLElement, k: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("guarda de activación de componentes deshabilitados (R2.6)", () => {
  it("button: ignora clic y botón A deshabilitado y vuelve a funcionar al habilitar", () => {
    const onActivate = vi.fn();
    const b = button({ label: "Jugar", disabled: true, onActivate });
    document.body.appendChild(b);

    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.disabled).toBe(true);
    b.click();
    expect(requestActivate(b)).toBe(false);
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onActivate).not.toHaveBeenCalled();

    setDisabled(b, false);
    expect(b.getAttribute("aria-disabled")).toBe("false");
    b.click();
    expect(requestActivate(b)).toBe(true);
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("button con solo aria-disabled también ignora clic y Enter/Espacio", () => {
    const onActivate = vi.fn();
    const b = button({ label: "X", onActivate });
    b.setAttribute("aria-disabled", "true");
    b.click();
    const ev = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    b.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("card interactiva: ignora clic, Enter, Espacio y botón A deshabilitada", () => {
    const onActivate = vi.fn();
    const c = card({ label: "Kael", onActivate, disabled: true });
    document.body.appendChild(c);
    expect(c.tabIndex).toBe(-1);

    c.click();
    key(c, "Enter");
    key(c, " ");
    requestActivate(c);
    expect(onActivate).not.toHaveBeenCalled();

    setDisabled(c, false);
    expect(c.tabIndex).toBe(0);
    c.click();
    key(c, "Enter");
    key(c, " ");
    requestActivate(c);
    expect(onActivate).toHaveBeenCalledTimes(4);
  });

  it("toggle (role=switch) no cambia de estado deshabilitado", () => {
    const onChange = vi.fn();
    const t = toggle({ label: "Movimiento reducido", checked: false, onChange, disabled: true });
    expect(t.getAttribute("role")).toBe("switch");
    t.click();
    requestActivate(t);
    expect(onChange).not.toHaveBeenCalled();
    expect(t.getAttribute("aria-checked")).toBe("false");

    setDisabled(t, false);
    t.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(t.getAttribute("aria-checked")).toBe("true");
  });

  it("levelSelect: la raíz deshabilitada bloquea sus opciones", () => {
    const onChange = vi.fn();
    const l = levelSelect({ label: "Bloom", value: "medio", onChange });
    const alto = l.querySelector<HTMLButtonElement>('[data-level="alto"]')!;
    setDisabled(l, true);
    alto.click();
    requestActivate(alto);
    expect(onChange).not.toHaveBeenCalled();

    setDisabled(l, false);
    alto.click();
    expect(onChange).toHaveBeenCalledWith("alto");
    expect(alto.getAttribute("aria-checked")).toBe("true");
    expect(l.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
  });

  it("tabs y slider respetan la guarda", () => {
    const onTab = vi.fn();
    const tl = tabs({ tabs: [{ id: "a", label: "A" }, { id: "b", label: "B" }], selected: "a", onChange: onTab });
    setDisabled(tl, true);
    tl.querySelector<HTMLButtonElement>('[data-tab-id="b"]')!.click();
    expect(onTab).not.toHaveBeenCalled();

    const onSlide = vi.fn();
    const s = slider({ label: "Escala", min: 50, max: 100, step: 5, value: 85, onChange: onSlide, disabled: true });
    const input = s.querySelector("input")!;
    expect(input.disabled).toBe(true);
    input.value = "60";
    input.dispatchEvent(new Event("input"));
    expect(onSlide).not.toHaveBeenCalled();
    expect(input.value).toBe("85");
  });
});

describe("dialog", () => {
  it("Escape cierra solo diálogos no obligatorios y close() es idempotente", () => {
    const onClose = vi.fn();
    const d = dialog({ title: "Salir", body: [], actions: [], onClose });
    d.open();
    expect(d.el.isConnected).toBe(true);
    key(d.el, "Escape");
    d.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(d.el.isConnected).toBe(false);

    const m = dialog({ title: "Pausa", body: [], actions: [], mandatory: true });
    m.open();
    key(m.el, "Escape");
    expect(m.el.isConnected).toBe(true);
    m.close();
  });
});
