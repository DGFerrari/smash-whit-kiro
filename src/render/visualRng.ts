/**
 * PRNG visual independiente (mulberry32).
 *
 * Toda aleatoriedad puramente cosmética (partículas, ruido de vibración,
 * siluetas procedimentales…) sale de aquí. Cada llamada a `createVisualRng`
 * crea un estado propio encapsulado en un cierre: no importa ni comparte
 * estado con el RNG de la Simulación (`src/engine/core/rng.ts`), por lo que
 * consumir números visuales nunca altera el determinismo del `World` (R13.5).
 */
export function createVisualRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
