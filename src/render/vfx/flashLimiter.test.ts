import { describe, expect, it } from 'vitest';
import { createFlashLimiter } from './flashLimiter';

describe('flashLimiter', () => {
  it('sin Movimiento_Reducido no limita', () => {
    const l = createFlashLimiter();
    for (let i = 0; i < 10; i++) expect(l.tryFlash(i, 1, false)).toBe(true);
  });

  it('destellos ≤ 25 % no se limitan ni consumen cupo', () => {
    const l = createFlashLimiter();
    for (let i = 0; i < 10; i++) expect(l.tryFlash(i, 0.25, true)).toBe(true);
    expect(l.tryFlash(20, 0.5, true)).toBe(true);
    expect(l.tryFlash(21, 0.5, true)).toBe(true);
    expect(l.tryFlash(22, 0.5, true)).toBe(true);
    expect(l.tryFlash(23, 0.5, true)).toBe(false);
  });

  it('ventana deslizante (now − 1000, now]', () => {
    const l = createFlashLimiter();
    expect(l.tryFlash(0, 1, true)).toBe(true);
    expect(l.tryFlash(400, 1, true)).toBe(true);
    expect(l.tryFlash(800, 1, true)).toBe(true);
    expect(l.tryFlash(999, 1, true)).toBe(false);
    // En 1000 el instante 0 sale de la ventana.
    expect(l.tryFlash(1000, 1, true)).toBe(true);
    expect(l.tryFlash(1001, 1, true)).toBe(false);
    expect(l.tryFlash(1400, 1, true)).toBe(true);
  });

  it('nunca acepta más de 3 en cualquier ventana de 1 s', () => {
    const l = createFlashLimiter();
    const ok: number[] = [];
    for (let t = 0; t < 5000; t += 37) if (l.tryFlash(t, 0.9, true)) ok.push(t);
    for (const t of ok) expect(ok.filter((u) => u > t - 1000 && u <= t).length).toBeLessThanOrEqual(3);
  });
});
