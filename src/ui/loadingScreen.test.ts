// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetOutcome, LoadHandle } from "../assets/assetLoader.ts";
import type { LoadProgress } from "../assets/progress.ts";
import { REFRESH_MS, TIP_MAX_CHARS, clampTip, createLoadingScreen, defaultTips } from "./loadingScreen.ts";

function fakeHandle(initial: LoadProgress) {
  let current = initial;
  let resolve!: () => void;
  const done = new Promise<Map<string, AssetOutcome>>((r) => (resolve = () => r(new Map())));
  const handle: LoadHandle = {
    progress: () => current,
    onProgress: () => () => {},
    done,
  };
  return { handle, set: (p: LoadProgress) => (current = p), finish: resolve };
}

const p = (o: Partial<LoadProgress>): LoadProgress => ({
  bytesLoaded: 0, bytesTotal: null, assetsDone: 0, assetsTotal: 4, percent: 0, ...o,
});

afterEach(() => vi.useRealTimers());

describe("loadingScreen", () => {
  it("muestra logo, barra accesible, MB, restantes y consejo", () => {
    const s = createLoadingScreen({ tipStart: 0 });
    s.update(p({ bytesLoaded: 12_400_000, bytesTotal: 30_000_000, assetsDone: 1, percent: 41 }));
    const bar = s.el.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("41");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuetext")).toContain("41 %");
    expect(s.el.querySelector(".kb-loading__percent")!.textContent).toBe("41 %");
    expect(s.el.querySelector(".kb-loading__bytes")!.textContent).toBe("12,4 MB / 30,0 MB");
    expect(s.el.querySelector(".kb-loading__remaining")!.textContent).toBe("3 recursos restantes");
    expect(s.el.querySelector(".kb-loading__logo")).not.toBeNull();
    const tip = s.el.querySelector(".kb-loading__tip-text")!.textContent!;
    expect(tip.length).toBeGreaterThan(0);
    s.destroy();
  });

  it("oculta MB si el tamaño es desconocido", () => {
    const s = createLoadingScreen();
    s.update(p({ assetsDone: 2, percent: 50 }));
    expect((s.el.querySelector(".kb-loading__bytes") as HTMLElement).hidden).toBe(true);
    s.destroy();
  });

  it("refresca por sondeo cada ≤ 250 ms y termina al 100 %", async () => {
    vi.useFakeTimers();
    const s = createLoadingScreen();
    const f = fakeHandle(p({ percent: 10 }));
    const done = s.bind(f.handle);
    f.set(p({ assetsDone: 2, percent: 50 }));
    vi.advanceTimersByTime(REFRESH_MS);
    expect(REFRESH_MS).toBeLessThanOrEqual(250);
    expect(s.el.querySelector(".kb-loading__percent")!.textContent).toBe("50 %");
    f.set(p({ assetsDone: 4, percent: 100 }));
    f.finish();
    const final = await done;
    expect(final.percent).toBe(100);
    expect(s.el.classList.contains("kb-loading--complete")).toBe(true);
    s.destroy();
  });

  it("variante de partida con retratos y escenario", async () => {
    const s = createLoadingScreen({ variant: "match", characters: ["blue", "red"], stage: "neonIsland" });
    expect(s.el.querySelectorAll(".kb-loading__fighter")).toHaveLength(2);
    expect(s.el.querySelector(".kb-loading__stage-name")!.textContent).toBe("Distrito Neón");
    // Todo en caché: el handle ya está terminado → 100 % de inmediato.
    const f = fakeHandle(p({ assetsDone: 4, percent: 100 }));
    f.finish();
    const t0 = Date.now();
    await s.bind(f.handle);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(s.el.querySelector(".kb-loading__percent")!.textContent).toBe("100 %");
    s.destroy();
  });

  it("los consejos tienen entre 1 y 200 caracteres", () => {
    for (const t of [...defaultTips(), clampTip("x".repeat(500)), clampTip("  ")]) {
      expect([...t].length).toBeGreaterThanOrEqual(1);
      expect([...t].length).toBeLessThanOrEqual(TIP_MAX_CHARS);
    }
  });
});
