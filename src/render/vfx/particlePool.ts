/**
 * Pool de partículas del Sistema_VFX (R8.8–R8.10).
 *
 * Puro (sin Three.js): almacenamiento en typed arrays con capacidad física
 * fija de 1000, organizado como buffer circular ordenado por instante de
 * creación. `spawn` escribe en la cabeza y, si no cabe, expulsa primero las
 * más antiguas. `setCapacity` limita las activas a {0, 200, 500, 1000} y
 * recorta al instante las más antiguas sobrantes. Sin asignaciones por frame.
 */
import type { Level } from "../quality/visualPrefs.ts";

export const PHYSICAL_CAPACITY = 1000;

export const ALLOWED_CAPACITIES = [0, 200, 500, 1000] as const;
export type ParticleCapacity = (typeof ALLOWED_CAPACITIES)[number];

const CAPACITY_BY_LEVEL: Record<Level, ParticleCapacity> = {
  desactivado: 0,
  bajo: 200,
  medio: 500,
  alto: 1000,
};

/** Capacidad del pool para el nivel del control `particles`. */
export function capacityForLevel(level: Level): ParticleCapacity {
  return CAPACITY_BY_LEVEL[level];
}

export interface ParticleInit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Vida total en ms (> 0). */
  lifeMs: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Inicializador de cada partícula. Recibe un objeto `out` reutilizable (ya
 * con valores por defecto) que puede rellenar y/o devolver; devolver otro
 * objeto también vale.
 */
export type ParticleInitFn = (i: number, out: ParticleInit) => ParticleInit | void;

export interface ParticlePoolOptions {
  /** Aceleración vertical constante (unidades/s²). Por defecto 0. */
  gravity?: number;
  /** Amortiguación lineal por segundo [0..1). Por defecto 0. */
  drag?: number;
  /** Capacidad inicial. Por defecto 1000. */
  capacity?: ParticleCapacity;
}

export interface ParticlePool {
  readonly physicalCapacity: number;
  /** Capacidad lógica actual (máx. activas). */
  readonly capacity: ParticleCapacity;
  setCapacity(max: number): void;
  spawn(n: number, init: ParticleInitFn): void;
  activeCount(): number;
  /** Integra posición/velocidad/vida y elimina las caducadas. */
  update(dtMs: number): void;
  /** Recorre las vivas de la más antigua a la más nueva. */
  forEachAlive(cb: (slot: number, ordinal: number) => void): void;
  /** Vida restante normalizada [0..1] de un slot (1 = recién creada). */
  life01(slot: number): number;
  clear(): void;
  // Datos por slot (solo lectura para adaptadores).
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
}

export function isAllowedCapacity(v: number): v is ParticleCapacity {
  return (ALLOWED_CAPACITIES as readonly number[]).includes(v);
}

export function createParticlePool(opts: ParticlePoolOptions = {}): ParticlePool {
  const N = PHYSICAL_CAPACITY;
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const pz = new Float32Array(N);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  const vz = new Float32Array(N);
  const life = new Float32Array(N);
  const maxLife = new Float32Array(N);
  const size = new Float32Array(N);
  const r = new Float32Array(N);
  const g = new Float32Array(N);
  const b = new Float32Array(N);

  const gravity = opts.gravity ?? 0;
  const drag = opts.drag ?? 0;
  let cap: ParticleCapacity = opts.capacity ?? 1000;

  // Ring: `tail` = más antigua, `count` = ocupadas contiguas desde tail.
  // Tras `update` no hay huecos muertos (se compacta), así count = activas.
  let tail = 0;
  let count = 0;

  const scratch: ParticleInit = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifeMs: 1000, size: 1, r: 1, g: 1, b: 1,
  };

  const dropOldest = (k: number): void => {
    const d = Math.min(k, count);
    tail = (tail + d) % N;
    count -= d;
  };

  const copySlot = (from: number, to: number): void => {
    px[to] = px[from]; py[to] = py[from]; pz[to] = pz[from];
    vx[to] = vx[from]; vy[to] = vy[from]; vz[to] = vz[from];
    life[to] = life[from]; maxLife[to] = maxLife[from]; size[to] = size[from];
    r[to] = r[from]; g[to] = g[from]; b[to] = b[from];
  };

  const pool: ParticlePool = {
    physicalCapacity: N,
    get capacity() {
      return cap;
    },
    px, py, pz, vx, vy, vz, life, maxLife, size, r, g, b,

    setCapacity(max: number): void {
      if (!isAllowedCapacity(max)) {
        throw new RangeError(`Capacidad de partículas no válida: ${max}`);
      }
      cap = max;
      if (count > cap) dropOldest(count - cap);
    },

    spawn(n: number, init: ParticleInitFn): void {
      if (cap === 0 || n <= 0) return;
      n = Math.floor(n);
      // Si n supera la capacidad, solo sobreviven las `cap` más nuevas.
      const start = n > cap ? n - cap : 0;
      const incoming = n - start;
      if (count + incoming > cap) dropOldest(count + incoming - cap);
      for (let i = start; i < n; i++) {
        scratch.x = 0; scratch.y = 0; scratch.z = 0;
        scratch.vx = 0; scratch.vy = 0; scratch.vz = 0;
        scratch.lifeMs = 1000; scratch.size = 1;
        scratch.r = 1; scratch.g = 1; scratch.b = 1;
        const p = init(i, scratch) || scratch;
        const s = (tail + count) % N;
        px[s] = p.x; py[s] = p.y; pz[s] = p.z;
        vx[s] = p.vx; vy[s] = p.vy; vz[s] = p.vz;
        const l = p.lifeMs > 0 ? p.lifeMs : 0;
        life[s] = l; maxLife[s] = l;
        size[s] = p.size;
        r[s] = p.r; g[s] = p.g; b[s] = p.b;
        count++;
      }
    },

    activeCount(): number {
      return count;
    },

    update(dtMs: number): void {
      if (count === 0) return;
      const dt = dtMs / 1000;
      const damp = drag > 0 ? Math.max(0, 1 - drag * dt) : 1;
      // Integra y compacta de forma estable (conserva el orden de creación).
      let write = 0;
      for (let k = 0; k < count; k++) {
        const s = (tail + k) % N;
        const l = life[s] - dtMs;
        if (l <= 0) continue;
        life[s] = l;
        vy[s] += gravity * dt;
        vx[s] *= damp; vy[s] *= damp; vz[s] *= damp;
        px[s] += vx[s] * dt;
        py[s] += vy[s] * dt;
        pz[s] += vz[s] * dt;
        const w = (tail + write) % N;
        if (w !== s) copySlot(s, w);
        write++;
      }
      count = write;
    },

    forEachAlive(cb): void {
      for (let k = 0; k < count; k++) {
        const s = (tail + k) % N;
        if (life[s] > 0) cb(s, k);
      }
    },

    life01(slot: number): number {
      const m = maxLife[slot];
      return m > 0 ? life[slot] / m : 0;
    },

    clear(): void {
      tail = 0;
      count = 0;
    },
  };
  return pool;
}
