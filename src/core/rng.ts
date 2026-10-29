/**
 * Generador de números pseudoaleatorios DETERMINISTA con semilla (mulberry32).
 *
 * Clave para los replays: si grabamos la semilla de una partida, re-ejecutar la
 * simulación con la misma semilla y los mismos inputs produce EXACTAMENTE el
 * mismo resultado (incluidos los efectos "aleatorios" como el zigzag del rayo
 * de muerte). Nunca uses Math.random() en código que afecte a la simulación o a
 * algo que el replay deba reproducir: usa esta clase.
 */
export class Rng {
  private state: number;

  constructor(readonly seed: number) {
    // Forzamos a entero sin signo de 32 bits.
    this.state = seed >>> 0;
  }

  /** Siguiente flotante en [0, 1). */
  next(): number {
    // mulberry32.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Flotante en [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/** Crea una semilla aleatoria (solo al INICIAR una grabación, no en replay). */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
