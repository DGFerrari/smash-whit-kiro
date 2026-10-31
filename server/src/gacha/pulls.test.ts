import { describe, it, expect } from "vitest";
import { RARITIES, rollOne, rollMany, sumTokens, type Rarity } from "./pulls.ts";

/**
 * Prueba de la lógica del gacha: que las probabilidades suman 1, que cada
 * tirada da una cantidad de tokens DENTRO del rango de su rareza, y que la
 * distribución a gran escala se parece a las probabilidades definidas.
 */

describe("gacha pulls", () => {
  it("las probabilidades suman 1", () => {
    const total = (Object.keys(RARITIES) as Rarity[]).reduce(
      (s, r) => s + RARITIES[r].chance,
      0,
    );
    expect(total).toBeCloseTo(1, 6);
  });

  it("cada tirada da tokens dentro del rango de su rareza", () => {
    for (let i = 0; i < 2000; i++) {
      const { rarity, tokens } = rollOne();
      expect(tokens).toBeGreaterThanOrEqual(RARITIES[rarity].min);
      expect(tokens).toBeLessThanOrEqual(RARITIES[rarity].max);
    }
  });

  it("la distribución a gran escala se aproxima a las probabilidades", () => {
    const N = 20000;
    const counts: Record<Rarity, number> = { common: 0, epic: 0, legendary: 0 };
    for (const p of rollMany(N)) counts[p.rarity]++;
    // Tolerancia amplia (±5 puntos) para no ser frágil con el azar.
    expect(counts.common / N).toBeGreaterThan(0.65);
    expect(counts.common / N).toBeLessThan(0.75);
    expect(counts.legendary / N).toBeGreaterThan(0.05);
    expect(counts.legendary / N).toBeLessThan(0.15);
  });

  it("sumTokens agrega por rareza", () => {
    const totals = sumTokens([
      { rarity: "common", tokens: 10 },
      { rarity: "common", tokens: 5 },
      { rarity: "legendary", tokens: 3 },
    ]);
    expect(totals.common).toBe(15);
    expect(totals.epic).toBe(0);
    expect(totals.legendary).toBe(3);
  });
});
