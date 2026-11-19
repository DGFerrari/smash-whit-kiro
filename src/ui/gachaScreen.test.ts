// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableDevAccount, enableDevAccount, resetDevAccount } from "../net/devAccount.ts";
import { GachaScreen } from "./gachaScreen.ts";
import { InventoryScreen } from "./inventoryScreen.ts";
import { loadPullHistory } from "./gachaArt.ts";

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

beforeEach(() => {
  // Sin animaciones: la secuencia se resuelve al instante.
  document.documentElement.setAttribute("data-reduced-motion", "");
  enableDevAccount();
});

afterEach(() => {
  disableDevAccount();
  resetDevAccount();
  document.documentElement.removeAttribute("data-reduced-motion");
  document.body.replaceChildren();
});

describe("Gacha + Inventario", () => {
  it("tirada ×10: abre el cofre, revela 10 cartas, resume y vuelve al cofre", async () => {
    const onOpenInventory = vi.fn();
    const g = new GachaScreen({ onBack: vi.fn(), onOpenInventory });
    g.show();
    await settle();
    const arena = document.querySelector<HTMLElement>("#gacha-screen .kbg-arena")!;
    expect(arena.dataset.state).toBe("idle");

    const pull10 = document.querySelector<HTMLButtonElement>("#gacha-screen .kbg-pull--multi")!;
    expect(pull10.getAttribute("aria-disabled")).toBe("false");
    pull10.click();
    await settle();

    const cards = document.querySelectorAll("#gacha-screen .kbg-card");
    expect(cards.length).toBe(10);
    expect(document.querySelectorAll("#gacha-screen .kbg-card.is-flipped").length).toBe(10);
    expect(arena.dataset.state).toBe("done");
    expect(document.querySelectorAll("#gacha-screen .kbg-summary__chip").length).toBeGreaterThan(0);
    expect(loadPullHistory()[0]?.pulls.length).toBe(10);

    // Continuar: vuelve al cofre y a las tiradas.
    const next = document.querySelector<HTMLButtonElement>("#gacha-screen .kbg-next")!;
    next.click();
    expect(arena.dataset.state).toBe("idle");
    expect(document.querySelectorAll("#gacha-screen .kbg-card").length).toBe(0);

    document.querySelector<HTMLButtonElement>("#gacha-screen .kbg-inv-btn")!.click();
    expect(onOpenInventory).toHaveBeenCalledTimes(1);
    g.hide();
  });

  it("el inventario muestra los tokens por rareza y el historial local", async () => {
    const g = new GachaScreen({ onBack: vi.fn(), onOpenInventory: vi.fn() });
    g.show();
    await settle();
    document.querySelector<HTMLButtonElement>("#gacha-screen .kbg-pull")!.click();
    await settle();
    g.hide();

    const inv = new InventoryScreen({ onBack: vi.fn(), onOpenGacha: vi.fn() });
    inv.show();
    await settle();
    const counts = Array.from(document.querySelectorAll("#inventory-screen .kbi-item__count")).map((e) =>
      Number(e.textContent),
    );
    expect(counts).toHaveLength(3);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    document.querySelectorAll<HTMLButtonElement>("#inventory-screen .kb-tab")[1]!.click();
    const rows = document.querySelectorAll("#inventory-screen .kbi-hrow").length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBe(loadPullHistory().length);
    expect(loadPullHistory()[0]?.pulls.length).toBe(1);
    inv.hide();
  });
});
