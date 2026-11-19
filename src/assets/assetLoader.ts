/**
 * AssetLoader: carga de assets con progreso real por bytes.
 *
 * - `fetch` + lectura troceada del `ReadableStream` de la respuesta; el tamaño
 *   total sale de `Content-Length` o, si falta, del `sizeHint` del manifiesto.
 * - Caché_Assets en memoria (por id) compartida entre cargas del mismo loader:
 *   un asset cacheado no genera petición de red y cuenta como procesado desde
 *   el inicio (R15.12).
 * - Motivos de fallo: `network`, `notFound`, `parse`, `timeout`. Un asset
 *   fallido cuenta como procesado (R15.9).
 * - Tiempo límite global (60 s por defecto): los pendientes pasan a
 *   `timeout`, se abortan sus peticiones y se ignoran las llegadas tardías (R15.10).
 * - `onProgress` se emite como máximo cada 100 ms (R15.6) y una vez al terminar.
 * - `done` nunca rechaza.
 *
 * Las URLs del manifiesto son relativas y se resuelven contra
 * `import.meta.env.BASE_URL` (R14.4).
 *
 * Requisitos: 12.2, 14.4, 15.1, 15.2, 15.6, 15.9, 15.10, 15.12.
 */

import { ProgressTracker, type LoadProgress } from "./progress";

export type AssetKind = "font" | "image" | "svg" | "gltf" | "vrm" | "texture" | "json";
export interface AssetRequest {
  id: string;
  url: string; // relativa a import.meta.env.BASE_URL
  kind: AssetKind;
  sizeHint?: number;
}
export type AssetFailureReason = "network" | "notFound" | "parse" | "timeout";
export type AssetOutcome =
  | { status: "loaded"; data: ArrayBuffer; fromCache: boolean }
  | { status: "failed"; reason: AssetFailureReason };

export interface LoadHandle {
  progress(): LoadProgress;
  /** Emitido como máximo cada 100 ms y una vez al terminar. Devuelve la función de baja. */
  onProgress(cb: (p: LoadProgress) => void): () => void;
  /** Nunca rechaza. */
  done: Promise<Map<string, AssetOutcome>>;
}
export interface AssetLoader {
  load(group: AssetRequest[], opts?: { timeoutMs?: number }): LoadHandle;
  cached(id: string): ArrayBuffer | undefined;
}

export const DEFAULT_LOAD_TIMEOUT_MS = 60_000;
export const PROGRESS_INTERVAL_MS = 100;

/** Subconjunto de `Response` que usa el loader (facilita los dobles de prueba). */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<FetchResponseLike>;

export interface LoaderTimers {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface AssetLoaderDeps {
  fetch?: FetchLike;
  timers?: LoaderTimers;
  /** Base de resolución de URLs; por defecto `import.meta.env.BASE_URL`. */
  baseUrl?: string;
}

// Envoltorios perezosos: respetan temporizadores falsos instalados tras crear el loader.
const defaultTimers: LoaderTimers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

function defaultBaseUrl(): string {
  try {
    return import.meta.env?.BASE_URL ?? "/";
  } catch {
    return "/";
  }
}

/** Une la base con una ruta relativa del manifiesto (`"fonts/x.woff2"` → `"/base/fonts/x.woff2"`). */
export function resolveAssetUrl(url: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return base + url.replace(/^\/+/, "");
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\s*\d+\s*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function concat(chunks: Uint8Array[], total: number): ArrayBuffer {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

/** Validación mínima por tipo; `false` ⇒ fallo `parse`. */
function validate(kind: AssetKind, data: ArrayBuffer): boolean {
  if (kind === "json") {
    try {
      JSON.parse(new TextDecoder().decode(data));
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

class TimeoutSignal extends Error {}

export function createAssetLoader(deps: AssetLoaderDeps = {}): AssetLoader {
  const doFetch = deps.fetch ?? defaultFetch;
  const timers = deps.timers ?? defaultTimers;
  const baseUrl = deps.baseUrl ?? defaultBaseUrl();
  const cache = new Map<string, ArrayBuffer>();

  function load(group: AssetRequest[], opts: { timeoutMs?: number } = {}): LoadHandle {
    // Ids duplicados: prevalece la primera entrada.
    const requests: AssetRequest[] = [];
    const seen = new Set<string>();
    for (const r of group) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        requests.push(r);
      }
    }

    const tracker = new ProgressTracker(
      requests.map((r) => ({ id: r.id, bytesTotal: r.sizeHint ?? null })),
    );
    const outcomes = new Map<string, AssetOutcome>();
    const listeners = new Set<(p: LoadProgress) => void>();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let finished = false;
    let last: LoadProgress | null = null;

    let resolveDone!: (m: Map<string, AssetOutcome>) => void;
    const done = new Promise<Map<string, AssetOutcome>>((res) => (resolveDone = res));

    const emit = (force: boolean): void => {
      const p = tracker.snapshot();
      const changed =
        !last ||
        p.percent !== last.percent ||
        p.bytesLoaded !== last.bytesLoaded ||
        p.assetsDone !== last.assetsDone ||
        p.bytesTotal !== last.bytesTotal;
      last = p;
      if (!changed && !force) return;
      for (const cb of [...listeners]) {
        try {
          cb(p);
        } catch {
          // Un suscriptor que lanza no rompe la carga.
        }
      }
    };

    const settle = (id: string, outcome: AssetOutcome): void => {
      if (finished || outcomes.has(id)) return;
      outcomes.set(id, outcome);
      if (outcome.status === "loaded") tracker.complete(id);
      else tracker.fail(id);
      if (tracker.isDone()) finish();
    };

    let intervalHandle: unknown = null;
    let timeoutHandle: unknown = null;

    function finish(): void {
      if (finished) return;
      finished = true;
      if (intervalHandle !== null) timers.clearInterval(intervalHandle);
      if (timeoutHandle !== null) timers.clearTimeout(timeoutHandle);
      emit(true);
      const ordered = new Map<string, AssetOutcome>();
      for (const r of requests) {
        ordered.set(r.id, outcomes.get(r.id) ?? { status: "failed", reason: "timeout" });
      }
      resolveDone(ordered);
    }

    async function fetchOne(req: AssetRequest): Promise<void> {
      const signal = controller?.signal as AbortSignal;
      let res: FetchResponseLike;
      try {
        res = await doFetch(resolveAssetUrl(req.url, baseUrl), { signal });
      } catch {
        settle(req.id, { status: "failed", reason: "network" });
        return;
      }
      if (finished) return;
      if (res.status === 404 || res.status === 410) {
        settle(req.id, { status: "failed", reason: "notFound" });
        return;
      }
      if (!res.ok) {
        settle(req.id, { status: "failed", reason: "network" });
        return;
      }

      const contentLength = parseContentLength(res.headers.get("content-length"));
      if (contentLength !== null) tracker.setTotal(req.id, contentLength);

      let data: ArrayBuffer;
      try {
        if (res.body) {
          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let total = 0;
          for (;;) {
            if (finished) {
              void reader.cancel().catch(() => undefined);
              throw new TimeoutSignal();
            }
            const { done: eof, value } = await reader.read();
            if (eof) break;
            if (value && value.byteLength > 0) {
              chunks.push(value);
              total += value.byteLength;
              tracker.addBytes(req.id, value.byteLength);
            }
          }
          data = concat(chunks, total);
        } else {
          data = await res.arrayBuffer();
          tracker.addBytes(req.id, data.byteLength);
        }
      } catch {
        settle(req.id, { status: "failed", reason: "network" });
        return;
      }
      if (finished) return;

      if (!validate(req.kind, data)) {
        settle(req.id, { status: "failed", reason: "parse" });
        return;
      }
      cache.set(req.id, data);
      settle(req.id, { status: "loaded", data, fromCache: false });
    }

    // Assets en caché: procesados de forma síncrona, antes de la primera instantánea.
    const toFetch: AssetRequest[] = [];
    for (const r of requests) {
      const hit = cache.get(r.id);
      if (hit) {
        tracker.markCached(r.id, hit.byteLength);
        outcomes.set(r.id, { status: "loaded", data: hit, fromCache: true });
      } else {
        toFetch.push(r);
      }
    }

    if (tracker.isDone()) {
      finish();
    } else {
      intervalHandle = timers.setInterval(() => emit(false), PROGRESS_INTERVAL_MS);
      const timeoutMs = opts.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
      timeoutHandle = timers.setTimeout(() => {
        if (finished) return;
        for (const id of tracker.timeout()) {
          if (!outcomes.has(id)) outcomes.set(id, { status: "failed", reason: "timeout" });
        }
        controller?.abort();
        finish();
      }, timeoutMs);
      for (const r of toFetch) {
        void fetchOne(r).catch(() => settle(r.id, { status: "failed", reason: "network" }));
      }
    }

    return {
      progress: () => tracker.snapshot(),
      onProgress(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      done,
    };
  }

  return {
    load,
    cached: (id) => cache.get(id),
  };
}
