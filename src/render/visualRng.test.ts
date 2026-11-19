import { describe, expect, it } from 'vitest';
import { createVisualRng } from './visualRng';

const take = (rng: () => number, n: number): number[] => Array.from({ length: n }, () => rng());

describe('createVisualRng', () => {
  it('es determinista para la misma semilla', () => {
    expect(take(createVisualRng(1234), 50)).toEqual(take(createVisualRng(1234), 50));
  });

  it('produce secuencias distintas para semillas distintas', () => {
    expect(take(createVisualRng(1), 10)).not.toEqual(take(createVisualRng(2), 10));
  });

  it('devuelve valores en [0, 1)', () => {
    for (const seed of [0, 1, 42, 0xffffffff, -7]) {
      for (const v of take(createVisualRng(seed), 1000)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('instancias independientes no comparten estado', () => {
    const a = createVisualRng(99);
    const b = createVisualRng(99);
    take(a, 25); // avanzar solo `a`
    expect(take(b, 5)).toEqual(take(createVisualRng(99), 5));
  });
});
