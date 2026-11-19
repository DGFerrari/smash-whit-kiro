import { describe, expect, it } from "vitest";
import {
  HudAnimTracker,
  LIFE_BREAK_MS,
  SHAKE_MS,
  buildHudPanel,
  damageT,
  layoutColumns,
  percentText,
  shakeFrame,
} from "./hudModel.ts";
import { characterLore } from "../content/lore.ts";

describe("hudModel", () => {
  it("damageT: 0 neutro, 1 a partir de 150 % y monótono", () => {
    expect(damageT(0)).toBe(0);
    expect(damageT(75)).toBeCloseTo(0.5);
    expect(damageT(150)).toBe(1);
    expect(damageT(999)).toBe(1);
    expect(damageT(-5)).toBe(0);
  });

  it("percentText es un entero seguido de %", () => {
    expect(percentText(42.6)).toBe("43%");
    expect(percentText(0)).toBe("0%");
  });

  it("panel: nombre visible, vidas, retrato atenuado y furia", () => {
    const p = buildHudPanel({ label: "P1", color: "#fff", characterId: "blue", damage: 12, lives: 0, fury: 0.4 });
    expect(p.name).toBe(characterLore("blue").name);
    expect(p.livesActive).toBe(0);
    expect(p.portraitDimmed).toBe(true);
    expect(p.furyFill).toBeCloseTo(0.4);
    expect(p.furyState).toBe("charging");

    const a = buildHudPanel({ label: "P2", color: "#fff", damage: 0, lives: 3, furyActive: true, furyRemaining: 0.7 });
    expect(a.name).toBe("P2");
    expect(a.livesActive).toBe(3);
    expect(a.portraitDimmed).toBe(false);
    expect(a.furyState).toBe("active");
    expect(a.furyFill).toBeCloseTo(0.7);
  });

  it("sacudida termina en escala 1 y offset 0; movimiento reducido sin escala", () => {
    expect(shakeFrame(0).scale).toBeGreaterThan(1);
    const end = shakeFrame(SHAKE_MS);
    expect(end).toMatchObject({ scale: 1, offsetX: 0, offsetY: 0, done: true });
    const rm = shakeFrame(50, true);
    expect(rm.scale).toBe(1);
    expect(rm.offsetX).toBe(0);
    expect(rm.pulse).toBeGreaterThan(0);
  });

  it("tracker reinicia la sacudida y rompe solo la vida perdida", () => {
    const t = new HudAnimTracker();
    t.update([{ damage: 0, lives: 3 }], 0);
    t.update([{ damage: 10, lives: 3 }], 100);
    t.update([{ damage: 20, lives: 3 }], 250); // reinicio
    expect(t.shake(0, 250 + SHAKE_MS - 1).done).toBe(false);
    expect(t.shake(0, 250 + SHAKE_MS).done).toBe(true);

    t.update([{ damage: 0, lives: 2 }], 1000);
    expect(t.breaks(0, 1000)).toEqual([{ index: 2, p: 0 }]);
    expect(t.breaks(0, 1000 + LIFE_BREAK_MS)).toEqual([]);
  });

  it("columnas sin solaparse ni recortarse (máx. 360 px)", () => {
    for (const w of [1280, 1920, 2560]) {
      for (let n = 2; n <= 4; n++) {
        const cols = layoutColumns(n, w);
        expect(cols).toHaveLength(n);
        expect(cols[0].x).toBeGreaterThanOrEqual(0);
        expect(cols[n - 1].x + cols[n - 1].w).toBeLessThanOrEqual(w);
        for (let i = 1; i < n; i++) expect(cols[i].x).toBeGreaterThanOrEqual(cols[i - 1].x + cols[i - 1].w);
        expect(cols[0].w).toBeLessThanOrEqual(360);
      }
    }
  });
});
