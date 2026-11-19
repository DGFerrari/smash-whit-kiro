// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindings, resetBindings } from "../core/bindings.ts";
import { getQualityManager } from "../render/quality/qualityManager.ts";
import { PauseMenu } from "./pauseMenu.ts";

function key(target: EventTarget, k: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

function clickByText(text: string): void {
  const btn = Array.from(document.querySelectorAll<HTMLButtonElement>("#pause-menu button")).find(
    (b) => b.textContent === text,
  );
  if (!btn) throw new Error(`No existe el botón «${text}»`);
  btn.click();
}

let menu: PauseMenu | null = null;
afterEach(() => {
  menu?.destroy();
  menu = null;
  resetBindings("p1");
  document.body.replaceChildren();
});

function makeMenu() {
  const cb = { onOpen: vi.fn(), onClose: vi.fn(), onQuitToMenu: vi.fn(), mode: "versus" as const };
  menu = new PauseMenu(cb);
  return cb;
}

describe("PauseMenu", () => {
  it("abre como diálogo obligatorio y Escape equivale a Continuar / Volver", () => {
    const cb = makeMenu();
    key(window, "Escape");
    expect(menu!.isOpen).toBe(true);
    expect(cb.onOpen).toHaveBeenCalledTimes(1);
    const box = document.querySelector("#pause-menu [role=alertdialog]");
    expect(box?.getAttribute("aria-modal")).toBe("true");

    clickByText("Opciones");
    expect(document.querySelector(".kb-pause__title")?.textContent).toBe("Opciones");
    key(document.activeElement ?? document.body, "Escape");
    expect(document.querySelector(".kb-pause__title")?.textContent).toBe("Pausa");
    expect(menu!.isOpen).toBe(true);

    key(document.activeElement ?? document.body, "Escape");
    expect(menu!.isOpen).toBe(false);
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it("Gráficos y Accesibilidad escriben en el Gestor_Calidad", () => {
    makeMenu();
    const qm = getQualityManager();
    key(window, "Escape");
    clickByText("Opciones");

    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".kb-tab")).map((t) => t.textContent);
    expect(tabs).toEqual(["Gráficos", "Accesibilidad", "Controles", "Audio", "Depuración"]);
    // Un selector por Control_Gráfico de nivel + deslizador de escala.
    expect(document.querySelectorAll(".kb-pause__level").length).toBe(9);
    const range = document.querySelector<HTMLInputElement>('[data-control="renderScale"] input');
    expect([range?.min, range?.max, range?.step]).toEqual(["50", "100", "5"]);

    document.querySelector<HTMLButtonElement>('[data-pause-key="preset-alto"]')!.click();
    expect(qm.getPreferences().preset).toBe("alto");
    const custom = document.querySelector<HTMLElement>(".kb-pause__custom")!;
    expect(custom.hidden).toBe(true);

    document
      .querySelector<HTMLButtonElement>('[data-control="particles"] .kb-level__opt[data-level="bajo"]')!
      .click();
    expect(qm.getPreferences().controls.particles).toBe("bajo");
    expect(qm.getPreferences().preset).toBe("personalizado");
    expect(custom.hidden).toBe(false);

    clickByText("Accesibilidad");
    const before = qm.getPreferences().reducedMotion;
    document.querySelector<HTMLButtonElement>(".kb-pause__tabpanel .kb-toggle")!.click();
    expect(qm.getPreferences().reducedMotion).toBe(!before);
    qm.setReducedMotion(false);
  });

  it("reasigna con el diálogo «Pulsa una tecla» y persiste con rebind", () => {
    makeMenu();
    key(window, "Escape");
    clickByText("Opciones");
    clickByText("Controles");
    clickByText("Cambiar teclas");
    clickByText("Jugador 1");

    const keyBtn = document.querySelector<HTMLButtonElement>('[data-pause-key^="key-p1-"]')!;
    const action = keyBtn.dataset.pauseKey!.replace("key-p1-", "") as keyof typeof bindings.p1;
    keyBtn.click();
    const dlg = document.querySelector(".kb-pause__capture [role=alertdialog]");
    expect(dlg?.textContent).toContain("Pulsa una tecla");

    key(window, "K");
    expect(document.querySelector(".kb-pause__capture")).toBeNull();
    expect(bindings.p1[action]).toEqual(["k"]);
    // Escape durante la captura no cierra el menú.
    expect(menu!.isOpen).toBe(true);
  });
});
