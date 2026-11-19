// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDITS, CreditsScreen } from "./creditsScreen.ts";
import { IDLE_TO_TITLE_MS, MainMenu, type MainMenuCallbacks } from "./mainMenu.ts";
import { CHANGELOG } from "../content/changelog.ts";
import { createMenuNavigator, type GamepadLike } from "./nav/menuNavigator.ts";

function pad(pressed: number[] = []): GamepadLike {
  return { buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })), axes: [0, 0] };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("creditsScreen", () => {
  it("muestra cada entrada del registro con sus cinco campos", () => {
    const nav = createMenuNavigator();
    const s = new CreditsScreen(CREDITS, nav);
    s.open();
    const entries = document.querySelectorAll(".credits-entry");
    expect(entries.length).toBe(CREDITS.length);
    expect(CREDITS.length).toBeGreaterThan(0);
    CREDITS.forEach((c, i) => {
      const text = entries[i].textContent ?? "";
      for (const v of [c.asset, c.author, c.sourceUrl, c.licenseUrl]) {
        expect(v.trim().length).toBeGreaterThan(0);
        expect(text).toContain(v);
      }
      const licenseName =
        c.license === "OFL-1.1"
          ? "SIL Open Font License 1.1"
          : c.license === "CC0-1.0"
            ? "CC0 1.0"
            : c.license === "Supercell-FCP"
              ? "Fan Content Policy de Supercell"
              : c.license;
      expect(text).toContain(licenseName);
    });
    s.close();
    nav.destroy();
  });

  it("se recorre con el gamepad y B vuelve", () => {
    let current = pad();
    const nav = createMenuNavigator({ getGamepads: () => [current] });
    const onClosed = vi.fn();
    const s = new CreditsScreen(CREDITS, nav);
    s.open(onClosed);

    const entries = Array.from(document.querySelectorAll<HTMLElement>(".credits-entry"));
    expect(document.activeElement).toBe(entries[0]);
    const last = entries[entries.length - 1];
    let t = 0;
    for (let i = 0; i < 20 && document.activeElement !== last; i++) {
      current = pad([13]);
      nav.pollGamepad((t += 16));
      current = pad();
      nav.pollGamepad((t += 16));
    }
    expect(document.activeElement).toBe(last);

    current = pad([1]);
    nav.pollGamepad((t += 16));
    expect(s.isOpen).toBe(false);
    expect(document.querySelector(".credits-screen")).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
    nav.destroy();
  });

  it("Escape cierra los créditos", () => {
    const nav = createMenuNavigator();
    const s = new CreditsScreen(CREDITS, nav);
    s.open();
    const first = document.querySelector<HTMLElement>(".credits-entry")!;
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(s.isOpen).toBe(false);
    nav.destroy();
  });
});

describe("mainMenu", () => {
  const cb = (): MainMenuCallbacks => ({
    onPlay: vi.fn(),
    onOpenReplays: vi.fn(),
    onOpenTutorial: vi.fn(),
    onOpenRanking: vi.fn(),
    onOpenGacha: vi.fn(),
    onOpenOnline: vi.fn(),
    onLogin: vi.fn(),
    onLogout: vi.fn(),
    onChangeNickname: vi.fn(),
  });

  it("muestra el logo KiroBrawl y el botón Créditos abre la pantalla", () => {
    const menu = new MainMenu(cb());
    menu.show();
    const logo = document.querySelector("#main-menu .menu-logo")!;
    expect(logo.querySelector('[aria-label="KiroBrawl"]') ?? logo.querySelector("h1")).not.toBeNull();
    expect(logo.textContent).toContain("KiroBrawl");

    const credits = Array.from(document.querySelectorAll<HTMLButtonElement>("#main-menu button")).find(
      (b) => b.textContent === "Créditos",
    )!;
    expect(credits).toBeDefined();
    credits.click();
    expect(document.querySelector(".credits-screen")).not.toBeNull();
    menu.hide();
    expect(document.querySelector(".credits-screen")).toBeNull();
  });

  it("tras 30 s sin actividad en la selección vuelve al título (el ratón reinicia la cuenta)", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
    try {
      const menu = new MainMenu(cb());
      menu.show();
      const root = document.querySelector<HTMLElement>("#main-menu")!;
      document.querySelector<HTMLElement>("#main-menu .menu-title-phase")!.click();
      expect(root.classList.contains("in-select")).toBe(true);

      vi.advanceTimersByTime(20_000);
      window.dispatchEvent(new Event("pointermove"));
      vi.advanceTimersByTime(IDLE_TO_TITLE_MS - 5_000);
      expect(root.classList.contains("in-select")).toBe(true);
      vi.advanceTimersByTime(6_000);
      expect(root.classList.contains("in-title")).toBe(true);
      menu.hide();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin botón Jugar: activar un modo entra directamente y hay panel de novedades", () => {
    const c = cb();
    const menu = new MainMenu(c);
    menu.show();
    expect(document.querySelector("#main-menu .play-btn")).toBeNull();
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>("#main-menu .mode-row"));

    // Pasar por encima solo marca el modo (descripción), no entra.
    const training = rows.find((r) => r.textContent?.includes("Entrenamiento"))!;
    training.dispatchEvent(new Event("pointerenter"));
    expect(training.classList.contains("selected")).toBe(true);
    expect(c.onPlay).not.toHaveBeenCalled();

    training.click();
    expect(c.onPlay).toHaveBeenCalledWith("training");
    rows.find((r) => r.textContent?.includes("Gacha"))!.click();
    expect(c.onOpenGacha).toHaveBeenCalledTimes(1);

    const news = document.querySelectorAll("#main-menu .menu-news__entry");
    expect(news.length).toBe(CHANGELOG.length);
    expect(document.querySelector("#main-menu .menu-news__current")?.textContent).toBe(`v${CHANGELOG[0].version}`);
    menu.hide();
  });
});
