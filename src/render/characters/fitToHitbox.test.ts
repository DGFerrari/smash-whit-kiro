import { describe, expect, it } from 'vitest';
import { fitToHitbox, worldBoxToSceneHitbox, type ModelBounds, type FitResult } from './fitToHitbox';

/** Caja resultante de aplicar el ajuste a la caja del modelo (espacio de escena). */
const fitted = (b: ModelBounds, f: FitResult) => ({
  minX: b.minX * f.scaleX + f.offsetX,
  maxX: b.maxX * f.scaleX + f.offsetX,
  minY: b.minY * f.scaleY + f.offsetY,
  maxY: b.maxY * f.scaleY + f.offsetY,
});

describe('worldBoxToSceneHitbox', () => {
  it('convierte el borde inferior del mundo (Y abajo) a escena (Y arriba)', () => {
    expect(worldBoxToSceneHitbox({ x: 100, y: 200, w: 36, h: 56 })).toEqual({
      centerX: 118,
      bottomY: -256,
      width: 36,
      height: 56,
    });
  });
});

describe('fitToHitbox', () => {
  const hitbox = worldBoxToSceneHitbox({ x: 100, y: 200, w: 36, h: 56 });

  it('usa escala uniforme con proporción parecida y alinea base y centro X', () => {
    // Modelo de 0,6 x 1 (proporción 36/56 ≈ 0,643 → sx/sy ≈ 1,07).
    const bbox = { minX: -0.3, maxX: 0.3, minY: 0, maxY: 1 };
    const f = fitToHitbox(bbox, hitbox);
    expect(f.uniform).toBe(true);
    expect(f.scaleX).toBe(f.scaleY);
    const r = fitted(bbox, f);
    expect(r.minY).toBeCloseTo(hitbox.bottomY, 9);
    expect(r.maxY - r.minY).toBeCloseTo(56, 9);
    expect((r.minX + r.maxX) / 2).toBeCloseTo(hitbox.centerX, 9);
    const w = r.maxX - r.minX;
    expect(w).toBeGreaterThanOrEqual(36 * 0.85);
    expect(w).toBeLessThanOrEqual(36 * 1.15);
  });

  it('usa escala no uniforme acotada a ±15 % con modelos desproporcionados', () => {
    // Modelo muy ancho y descentrado, con pies bajo el origen.
    const bbox = { minX: 2, maxX: 5, minY: -0.5, maxY: 0.5 };
    const f = fitToHitbox(bbox, hitbox);
    expect(f.uniform).toBe(false);
    const r = fitted(bbox, f);
    expect(r.minY).toBeCloseTo(hitbox.bottomY, 9);
    expect(r.maxY - r.minY).toBeCloseTo(56, 9);
    expect((r.minX + r.maxX) / 2).toBeCloseTo(hitbox.centerX, 9);
    // Limitado al extremo más cercano a la escala uniforme: +15 % del ancho.
    expect(r.maxX - r.minX).toBeCloseTo(36 * 1.15, 9);
  });

  it('rechaza cajas degeneradas', () => {
    expect(() => fitToHitbox({ minX: 0, maxX: 0, minY: 0, maxY: 1 }, hitbox)).toThrow(RangeError);
    expect(() =>
      fitToHitbox({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, { ...hitbox, height: 0 }),
    ).toThrow(RangeError);
  });
});
