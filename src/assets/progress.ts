/**
 * Progreso de carga de assets (módulo puro, sin DOM ni red).
 *
 * - `computeLoadProgress` agrega el estado de cada asset en un `LoadProgress`.
 * - `ProgressTracker` es el acumulador que usa el AssetLoader: recibe eventos
 *   (bytes, completado, fallido, caché, timeout) y mantiene la monotonía del
 *   porcentaje entre instantáneas.
 * - `formatBytesText` / `formatRemainingText` generan los textos de la
 *   Pantalla_Carga.
 *
 * Requisitos: 15.3, 15.4, 15.5, 15.7, 15.8, 15.9, 15.10.
 */

export interface AssetProgress {
  id: string;
  bytesTotal: number | null;
  bytesLoaded: number;
  done: boolean;
}

export interface LoadProgress {
  bytesLoaded: number; // suma de processedBytes de cada asset
  bytesTotal: number | null; // null si algún asset no tiene tamaño conocido
  assetsDone: number; // cargados + fallidos (incl. caché)
  assetsTotal: number;
  percent: number; // entero 0..100
}

/** Bytes procesados de un asset: un asset terminado con tamaño conocido cuenta su total (R15.9). */
function processedBytes(a: AssetProgress): number {
  const loaded = Math.max(0, a.bytesLoaded);
  if (a.bytesTotal === null) return loaded;
  const total = Math.max(0, a.bytesTotal);
  return a.done ? total : Math.min(loaded, total);
}

/**
 * Calcula el `LoadProgress` de un grupo de assets.
 * `previousPercent` es el último porcentaje mostrado (garantiza monotonía, R15.7).
 */
export function computeLoadProgress(
  assets: readonly AssetProgress[],
  previousPercent = 0,
): LoadProgress {
  const assetsTotal = assets.length;
  let assetsDone = 0;
  let bytesLoaded = 0;
  let bytesTotal: number | null = 0;

  for (const a of assets) {
    if (a.done) assetsDone++;
    bytesLoaded += processedBytes(a);
    if (bytesTotal !== null) {
      bytesTotal = a.bytesTotal === null ? null : bytesTotal + Math.max(0, a.bytesTotal);
    }
  }

  let percent: number;
  if (assetsTotal === 0) {
    percent = 100;
  } else {
    const raw =
      bytesTotal !== null && bytesTotal > 0
        ? Math.floor((100 * bytesLoaded) / bytesTotal) // R15.3
        : Math.floor((100 * assetsDone) / assetsTotal); // R15.4
    const capped = assetsDone < assetsTotal ? Math.min(raw, 99) : 100; // R15.8
    const prev = Number.isFinite(previousPercent) ? Math.floor(previousPercent) : 0;
    percent = Math.max(clamp(prev, 0, 100), clamp(capped, 0, 100)); // R15.7
    // El tope de 99 prevalece sobre el anterior: 100 solo con todo procesado.
    if (assetsDone < assetsTotal) percent = Math.min(percent, 99);
  }

  return { bytesLoaded, bytesTotal, assetsDone, assetsTotal, percent };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Entrada inicial del tracker: id y tamaño conocido (Content-Length o sizeHint) si lo hay. */
export interface TrackedAsset {
  id: string;
  bytesTotal?: number | null;
}

/**
 * Acumulador de progreso de un grupo de carga. Los eventos sobre assets ya
 * terminados o ids desconocidos se ignoran (llegadas tardías tras timeout).
 */
export class ProgressTracker {
  private readonly assets = new Map<string, AssetProgress>();
  private lastPercent = 0;

  constructor(entries: readonly TrackedAsset[]) {
    for (const e of entries) {
      const total = e.bytesTotal ?? null;
      this.assets.set(e.id, {
        id: e.id,
        bytesTotal: total !== null && Number.isFinite(total) && total >= 0 ? total : null,
        bytesLoaded: 0,
        done: false,
      });
    }
  }

  private pending(id: string): AssetProgress | undefined {
    const a = this.assets.get(id);
    return a && !a.done ? a : undefined;
  }

  /** Fija el tamaño total cuando se conoce tarde (p. ej. `Content-Length`). */
  setTotal(id: string, bytesTotal: number | null): void {
    const a = this.pending(id);
    if (!a) return;
    a.bytesTotal =
      bytesTotal !== null && Number.isFinite(bytesTotal) && bytesTotal >= 0 ? bytesTotal : null;
  }

  /** Suma bytes recibidos de un asset en curso. */
  addBytes(id: string, bytes: number): void {
    const a = this.pending(id);
    if (!a || !Number.isFinite(bytes) || bytes <= 0) return;
    a.bytesLoaded += bytes;
  }

  /** Asset cargado correctamente. */
  complete(id: string): void {
    const a = this.pending(id);
    if (a) a.done = true;
  }

  /** Asset fallido: cuenta como procesado (R15.9). */
  fail(id: string): void {
    this.complete(id);
  }

  /** Asset servido desde la Caché_Assets: procesado desde el inicio (R15.12). */
  markCached(id: string, bytesTotal?: number): void {
    const a = this.pending(id);
    if (!a) return;
    if (bytesTotal !== undefined && Number.isFinite(bytesTotal) && bytesTotal >= 0) {
      a.bytesTotal = bytesTotal;
    }
    a.done = true;
  }

  /** Tiempo límite vencido: todos los pendientes pasan a fallidos (R15.10). Devuelve sus ids. */
  timeout(): string[] {
    const ids: string[] = [];
    for (const a of this.assets.values()) {
      if (!a.done) {
        a.done = true;
        ids.push(a.id);
      }
    }
    return ids;
  }

  isDone(): boolean {
    for (const a of this.assets.values()) if (!a.done) return false;
    return true;
  }

  /** Copia del estado por asset. */
  entries(): AssetProgress[] {
    return [...this.assets.values()].map((a) => ({ ...a }));
  }

  /** Instantánea del progreso; actualiza el último porcentaje para la monotonía. */
  snapshot(): LoadProgress {
    const p = computeLoadProgress([...this.assets.values()], this.lastPercent);
    this.lastPercent = p.percent;
    return p;
  }
}

const BYTES_PER_MB = 1_000_000;
const mbFormat = new Intl.NumberFormat("es", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** `"12,4 MB / 30,0 MB"`; `null` si algún tamaño es desconocido (R15.5). */
export function formatBytesText(p: LoadProgress): string | null {
  if (p.bytesTotal === null) return null;
  const loaded = Math.min(p.bytesLoaded, p.bytesTotal);
  return `${mbFormat.format(loaded / BYTES_PER_MB)} MB / ${mbFormat.format(p.bytesTotal / BYTES_PER_MB)} MB`;
}

/** Número de assets restantes. */
export function remainingAssets(p: LoadProgress): number {
  return Math.max(0, p.assetsTotal - p.assetsDone);
}

/** `"N recursos restantes"` (singular para 1). */
export function formatRemainingText(p: LoadProgress): string {
  const n = remainingAssets(p);
  return n === 1 ? "1 recurso restante" : `${n} recursos restantes`;
}
