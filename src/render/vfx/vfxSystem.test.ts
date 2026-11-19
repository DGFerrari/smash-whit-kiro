import { describe, expect, it } from "vitest";
import { chargeEmission, impactIntensity, inwardDir, levelFactor } from "./vfxSystem.ts";

describe("vfxSystem (funciones puras)", () => {
  it("ligero: sin vibración ni líneas y más pequeño que cualquier fuerte", () => {
    const light = impactIntensity(false, 1);
    expect(light.shakeMs).toBe(0);
    expect(light.speedLines).toBe(0);
    for (const k of [0, 0.3, 1]) expect(impactIntensity(true, k).scale).toBeGreaterThan(light.scale);
  });

  it("fuerte: monótono en k y acotado (vibración 100–400 ms)", () => {
    let prev = impactIntensity(true, 0);
    expect(prev.shakeMs).toBe(100);
    for (let k = 0.05; k <= 1.0001; k += 0.05) {
      const cur = impactIntensity(true, k);
      expect(cur.shakeMs).toBeGreaterThanOrEqual(prev.shakeMs);
      expect(cur.speedLines).toBeGreaterThanOrEqual(prev.speedLines);
      expect(cur.scale).toBeGreaterThanOrEqual(prev.scale);
      prev = cur;
    }
    expect(impactIntensity(true, 5).shakeMs).toBe(400);
  });

  it("emisión de carga monótona en la proporción", () => {
    let prev = -1;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const n = chargeEmission(r, 1);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(chargeEmission(1, 0)).toBe(0);
  });

  it("KO orientado hacia el interior", () => {
    expect(inwardDir("left").x).toBe(1);
    expect(inwardDir("right").x).toBe(-1);
    expect(inwardDir("top").y).toBe(1);
    expect(inwardDir("bottom").y).toBe(-1);
  });

  it("factor por nivel", () => {
    expect(levelFactor("desactivado")).toBe(0);
    expect(levelFactor("bajo")).toBeLessThan(levelFactor("medio"));
    expect(levelFactor("medio")).toBeLessThan(levelFactor("alto"));
  });
});
