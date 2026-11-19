import { describe, expect, it } from 'vitest';
import { BLAST_ZONE } from '../../engine/config';
import {
  KB_MAX_HEAVY_FULL,
  createEventDetector,
  knockbackFactor,
  koEdge,
  type FighterLike,
} from './eventDetector';

interface MutFighter {
  index: number;
  lives: number;
  alive: boolean;
  isDead: boolean;
  lastHitBy: number;
  player: {
    pos: { x: number; y: number };
    vel: { x: number; y: number };
    width: number;
    height: number;
    damage: number;
    hitFlash: number;
    stunned: boolean;
    charging: boolean;
    chargeRatio: number;
    furyActive: boolean;
    attack: { def: { kind: string } } | null;
    stats: { deaths: number };
  };
}

const mk = (index: number): MutFighter => ({
  index,
  lives: 3,
  alive: true,
  isDead: false,
  lastHitBy: -1,
  player: {
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    width: 40,
    height: 60,
    damage: 0,
    hitFlash: 0,
    stunned: false,
    charging: false,
    chargeRatio: 0,
    furyActive: false,
    attack: null,
    stats: { deaths: 0 },
  },
});

const asLike = (fs: MutFighter[]): FighterLike[] => fs;

describe('eventDetector', () => {
  it('no emite nada en la primera llamada ni sin cambios', () => {
    const d = createEventDetector();
    const fs = [mk(0), mk(1)];
    expect(d.detect(asLike(fs))).toEqual([]);
    expect(d.detect(asLike(fs))).toEqual([]);
  });

  it('golpe ligero: un único hit por jugador y tick', () => {
    const d = createEventDetector();
    const fs = [mk(0), mk(1)];
    d.detect(asLike(fs));
    fs[0].player.attack = { def: { kind: 'light' } };
    fs[1].player.damage = 6;
    fs[1].player.hitFlash = 8;
    fs[1].lastHitBy = 0;
    const ev = d.detect(asLike(fs));
    const hits = ev.filter((e) => e.type === 'hit' || e.type === 'heavyHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ type: 'hit', player: 1, attacker: 0, damageDelta: 6 });
  });

  it('golpe fuerte: knockback y dirección desde la velocidad', () => {
    const d = createEventDetector();
    const fs = [mk(0), mk(1)];
    d.detect(asLike(fs));
    fs[0].player.attack = { def: { kind: 'heavy' } };
    fs[1].player.damage = 15;
    fs[1].player.hitFlash = 8;
    fs[1].player.vel = { x: 300, y: -400 };
    fs[1].lastHitBy = 0;
    const ev = d.detect(asLike(fs));
    const h = ev.find((e) => e.type === 'heavyHit');
    expect(h).toBeDefined();
    if (h?.type !== 'heavyHit') return;
    expect(h.knockback).toBeCloseTo(500);
    expect(h.dirX).toBeCloseTo(0.6);
    expect(h.dirY).toBeCloseTo(-0.8);
    expect(h.knockbackFactor).toBeCloseTo(500 / KB_MAX_HEAVY_FULL);
  });

  it('sin atacante conocido usa el umbral de daño', () => {
    const d = createEventDetector();
    const fs = [mk(0)];
    d.detect(asLike(fs));
    fs[0].player.damage = 16;
    expect(d.detect(asLike(fs))[0].type).toBe('heavyHit');
    fs[0].player.damage = 20;
    expect(d.detect(asLike(fs))[0].type).toBe('hit');
  });

  it('flancos de stun, fury y charge', () => {
    const d = createEventDetector();
    const fs = [mk(0)];
    d.detect(asLike(fs));
    fs[0].player.stunned = true;
    fs[0].player.furyActive = true;
    fs[0].player.charging = true;
    fs[0].player.chargeRatio = 0.5;
    expect(d.detect(asLike(fs))).toEqual([
      { type: 'stun', player: 0, active: true },
      { type: 'charge', player: 0, active: true, ratio: 0.5 },
      { type: 'fury', player: 0, active: true },
    ]);
    fs[0].player.stunned = false;
    fs[0].player.furyActive = false;
    fs[0].player.charging = false;
    expect(d.detect(asLike(fs))).toEqual([
      { type: 'stun', player: 0, active: false },
      { type: 'charge', player: 0, active: false, ratio: 0 },
      { type: 'fury', player: 0, active: false },
    ]);
    expect(d.detect(asLike(fs))).toEqual([]);
  });

  it('KO con borde de salida por mayor exceso', () => {
    const d = createEventDetector();
    const fs = [mk(0)];
    d.detect(asLike(fs));
    fs[0].player.pos = { x: BLAST_ZONE.right + 50, y: BLAST_ZONE.top + 10 };
    fs[0].player.stats.deaths = 1;
    fs[0].lives = 2;
    const ev = d.detect(asLike(fs));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'ko', player: 0, edge: 'right' });
  });

  it('koEdge elige cada borde', () => {
    const z = { left: -100, right: 100, top: -100, bottom: 100 };
    expect(koEdge({ x: -200, y: 0, w: 10, h: 10 }, z)).toBe('left');
    expect(koEdge({ x: 150, y: 0, w: 10, h: 10 }, z)).toBe('right');
    expect(koEdge({ x: 0, y: -300, w: 10, h: 10 }, z)).toBe('top');
    expect(koEdge({ x: 0, y: 160, w: 10, h: 10 }, z)).toBe('bottom');
  });

  it('no muta las entradas y copia el estado previo', () => {
    const d = createEventDetector();
    const fs = [mk(0)];
    const before = JSON.stringify(fs);
    d.detect(asLike(fs));
    expect(JSON.stringify(fs)).toBe(before);
    // Mutar el objeto tras detectar no altera el estado previo copiado.
    fs[0].player.damage = 7;
    expect(d.detect(asLike(fs)).filter((e) => e.type === 'hit')).toHaveLength(1);
  });

  it('knockbackFactor está acotado en [0, 1]', () => {
    expect(knockbackFactor(-5)).toBe(0);
    expect(knockbackFactor(KB_MAX_HEAVY_FULL * 3)).toBe(1);
  });
});
