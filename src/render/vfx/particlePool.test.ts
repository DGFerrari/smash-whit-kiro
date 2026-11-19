import { describe, expect, it } from 'vitest';
import { capacityForLevel, createParticlePool, PHYSICAL_CAPACITY } from './particlePool';

/** Marca cada partícula con su orden de creación en `x`. */
const spawnSeq = (pool: ReturnType<typeof createParticlePool>, n: number, from: number) =>
  pool.spawn(n, (i, out) => {
    out.x = from + i;
    out.lifeMs = 1000;
  });

const aliveXs = (pool: ReturnType<typeof createParticlePool>): number[] => {
  const xs: number[] = [];
  pool.forEachAlive((s) => xs.push(pool.px[s]));
  return xs;
};

describe('particlePool', () => {
  it('capacidad física 1000 y mapeo de niveles', () => {
    const pool = createParticlePool();
    expect(pool.physicalCapacity).toBe(PHYSICAL_CAPACITY);
    expect(PHYSICAL_CAPACITY).toBe(1000);
    expect(capacityForLevel('desactivado')).toBe(0);
    expect(capacityForLevel('bajo')).toBe(200);
    expect(capacityForLevel('medio')).toBe(500);
    expect(capacityForLevel('alto')).toBe(1000);
  });

  it('spawn expulsa las más antiguas al superar la capacidad', () => {
    const pool = createParticlePool({ capacity: 200 });
    spawnSeq(pool, 150, 0);
    spawnSeq(pool, 100, 150);
    expect(pool.activeCount()).toBe(200);
    const xs = aliveXs(pool);
    expect(xs[0]).toBe(50);
    expect(xs[199]).toBe(249);
  });

  it('spawn mayor que la capacidad conserva las más nuevas', () => {
    const pool = createParticlePool({ capacity: 200 });
    spawnSeq(pool, 450, 0);
    expect(pool.activeCount()).toBe(200);
    expect(aliveXs(pool)[0]).toBe(250);
  });

  it('setCapacity recorta las más antiguas y valida valores', () => {
    const pool = createParticlePool();
    spawnSeq(pool, 1000, 0);
    pool.setCapacity(500);
    expect(pool.activeCount()).toBe(500);
    expect(aliveXs(pool)[0]).toBe(500);
    pool.setCapacity(0);
    expect(pool.activeCount()).toBe(0);
    spawnSeq(pool, 10, 0);
    expect(pool.activeCount()).toBe(0);
    expect(() => pool.setCapacity(300)).toThrow(RangeError);
  });

  it('update integra posición y elimina caducadas manteniendo el orden', () => {
    const pool = createParticlePool();
    pool.spawn(1, (_i, o) => {
      o.vx = 100;
      o.lifeMs = 100;
    });
    spawnSeq(pool, 3, 10);
    pool.update(50);
    expect(pool.activeCount()).toBe(4);
    let first = -1;
    pool.forEachAlive((s, k) => {
      if (k === 0) first = s;
    });
    expect(pool.px[first]).toBeCloseTo(5);
    expect(pool.life01(first)).toBeCloseTo(0.5);
    pool.update(60);
    expect(pool.activeCount()).toBe(3);
    expect(aliveXs(pool)).toEqual([10, 11, 12]);
  });

  it('funciona al dar la vuelta al buffer circular', () => {
    const pool = createParticlePool();
    for (let r = 0; r < 5; r++) {
      spawnSeq(pool, 700, r * 700);
      expect(pool.activeCount()).toBeLessThanOrEqual(1000);
    }
    const xs = aliveXs(pool);
    expect(xs).toHaveLength(1000);
    expect(xs[0]).toBe(2500);
    expect(xs[999]).toBe(3499);
  });
});
