/**
 * Preferencias_Visuales: modelo, validación y persistencia (R6.1, R6.4, R6.8–R6.10, R6.13).
 *
 * Módulo puro salvo por el acceso a `Storage`, que siempre se inyecta y se protege con
 * `try/catch`. No lee ni escribe en `src/engine/`.
 */

export type Level = "desactivado" | "bajo" | "medio" | "alto";
/** Orden total de niveles (índice menor = menos coste). */
export const LEVELS: readonly Level[] = ["desactivado", "bajo", "medio", "alto"];

export type RenderScale = 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | 100;
export const RENDER_SCALES: readonly RenderScale[] = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

export interface GraphicControls {
  particles: Level;
  flashes: Level;
  lensFlares: Level;
  bloom: Level;
  dof: Level;
  shadows: Level;
  cameraShake: Level;
  speedLines: Level;
  bgAnimations: Level;
  renderScale: RenderScale;
}
export type ControlKey = keyof GraphicControls;
export type LevelControlKey = Exclude<ControlKey, "renderScale">;

export const LEVEL_CONTROL_KEYS: readonly LevelControlKey[] = [
  "particles",
  "flashes",
  "lensFlares",
  "bloom",
  "dof",
  "shadows",
  "cameraShake",
  "speedLines",
  "bgAnimations",
];
export const CONTROL_KEYS: readonly ControlKey[] = [...LEVEL_CONTROL_KEYS, "renderScale"];

export type PresetId = "bajo" | "medio" | "alto";
export type PresetLabel = PresetId | "personalizado";

export const PRESET_IDS: readonly PresetId[] = ["bajo", "medio", "alto"];
export const PRESET_LABELS: readonly PresetLabel[] = [...PRESET_IDS, "personalizado"];
export const DEFAULT_PRESET: PresetId = "medio";

export interface VisualPreferences {
  version: 1;
  /** Preset mostrado. */
  preset: PresetLabel;
  /** Último preset seleccionado explícitamente. */
  lastPreset: PresetId;
  controls: GraphicControls;
  reducedMotion: boolean;
}

export const VISUAL_PREFS_KEY = "kirobrawl.visualPrefs.v1";
export const SAVE_DEBOUNCE_MS = 250;

/** Tabla de presets (design.md). Cada columna es ≤ que la siguiente (R6.1). */
export const PRESETS: Readonly<Record<PresetId, Readonly<GraphicControls>>> = Object.freeze({
  bajo: Object.freeze({
    particles: "bajo",
    flashes: "bajo",
    lensFlares: "desactivado",
    bloom: "desactivado",
    dof: "desactivado",
    shadows: "desactivado",
    cameraShake: "medio",
    speedLines: "bajo",
    bgAnimations: "bajo",
    renderScale: 70,
  }),
  medio: Object.freeze({
    particles: "medio",
    flashes: "medio",
    lensFlares: "bajo",
    bloom: "bajo",
    dof: "desactivado",
    shadows: "bajo",
    cameraShake: "medio",
    speedLines: "medio",
    bgAnimations: "medio",
    renderScale: 85,
  }),
  alto: Object.freeze({
    particles: "alto",
    flashes: "alto",
    lensFlares: "alto",
    bloom: "alto",
    dof: "medio",
    shadows: "alto",
    cameraShake: "alto",
    speedLines: "alto",
    bgAnimations: "alto",
    renderScale: 100,
  }),
});

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

export function isLevel(v: unknown): v is Level {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v);
}

export function isRenderScale(v: unknown): v is RenderScale {
  return typeof v === "number" && (RENDER_SCALES as readonly number[]).includes(v);
}

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === "string" && (PRESET_IDS as readonly string[]).includes(v);
}

export function isPresetLabel(v: unknown): v is PresetLabel {
  return typeof v === "string" && (PRESET_LABELS as readonly string[]).includes(v);
}

/** Copia mutable de los controles de un preset. */
export function presetControls(id: PresetId): GraphicControls {
  return { ...PRESETS[id] };
}

export function controlsEqual(a: GraphicControls, b: GraphicControls): boolean {
  return CONTROL_KEYS.every((k) => a[k] === b[k]);
}

/**
 * Regla de `personalizado` (design.md):
 * 1. coincide con `PRESETS[lastPreset]` → `lastPreset`;
 * 2. coincide con algún preset en orden bajo, medio, alto → ese preset;
 * 3. si no → "personalizado".
 */
export function derivePresetLabel(controls: GraphicControls, lastPreset: PresetId): PresetLabel {
  if (controlsEqual(controls, PRESETS[lastPreset])) return lastPreset;
  for (const p of PRESET_IDS) {
    if (controlsEqual(controls, PRESETS[p])) return p;
  }
  return "personalizado";
}

/** Preferencias por defecto para un preset dado (por defecto `medio`). */
export function defaultVisualPrefs(
  preset: PresetId = DEFAULT_PRESET,
  reducedMotion = false,
): VisualPreferences {
  return {
    version: 1,
    preset,
    lastPreset: preset,
    controls: presetControls(preset),
    reducedMotion,
  };
}

// ---------------------------------------------------------------------------
// Validación y serialización
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseControls(raw: unknown): GraphicControls | null {
  if (!isPlainObject(raw)) return null;
  for (const k of LEVEL_CONTROL_KEYS) {
    if (!isLevel(raw[k])) return null;
  }
  if (!isRenderScale(raw.renderScale)) return null;
  const out = {} as Record<ControlKey, unknown>;
  for (const k of CONTROL_KEYS) out[k] = raw[k];
  return out as unknown as GraphicControls;
}

/**
 * Valida estrictamente unas preferencias. Acepta la cadena JSON guardada o un objeto ya
 * decodificado. Devuelve `null` si son inválidas (R6.10). Si el `preset` guardado no es
 * coherente con `derivePresetLabel(controls, lastPreset)`, se recalcula en lugar de descartar.
 */
export function parseVisualPrefs(raw: unknown): VisualPreferences | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isPlainObject(data)) return null;
  if (data.version !== 1) return null;
  if (!isPresetLabel(data.preset)) return null;
  if (!isPresetId(data.lastPreset)) return null;
  if (typeof data.reducedMotion !== "boolean") return null;
  const controls = parseControls(data.controls);
  if (!controls) return null;

  const lastPreset = data.lastPreset;
  return {
    version: 1,
    preset: derivePresetLabel(controls, lastPreset),
    lastPreset,
    controls,
    reducedMotion: data.reducedMotion,
  };
}

/** Serializa con un orden de campos estable. */
export function serializeVisualPrefs(p: VisualPreferences): string {
  const controls = {} as Record<ControlKey, unknown>;
  for (const k of CONTROL_KEYS) controls[k] = p.controls[k];
  return JSON.stringify({
    version: 1,
    preset: p.preset,
    lastPreset: p.lastPreset,
    controls,
    reducedMotion: p.reducedMotion,
  });
}

// ---------------------------------------------------------------------------
// Persistencia (Storage inyectable y protegido)
// ---------------------------------------------------------------------------

/** Devuelve `window.localStorage` si existe y es accesible; si no, `null`. */
export function getDefaultStorage(): Storage | null {
  try {
    const g = globalThis as { localStorage?: Storage };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Lee las preferencias guardadas. `prefs = null` si no hay o son inválidas;
 * `storageOk = false` si el almacenamiento no existe o la lectura lanza.
 */
export function loadVisualPrefs(storage: Storage | null): {
  prefs: VisualPreferences | null;
  storageOk: boolean;
} {
  if (!storage) return { prefs: null, storageOk: false };
  let raw: string | null;
  try {
    raw = storage.getItem(VISUAL_PREFS_KEY);
  } catch {
    return { prefs: null, storageOk: false };
  }
  if (raw === null) return { prefs: null, storageOk: true };
  return { prefs: parseVisualPrefs(raw), storageOk: true };
}

/** Escritura inmediata. Devuelve `false` si no hay almacenamiento o `setItem` lanza (R6.13). */
export function saveVisualPrefs(storage: Storage | null, p: VisualPreferences): boolean {
  if (!storage) return false;
  try {
    storage.setItem(VISUAL_PREFS_KEY, serializeVisualPrefs(p));
    return true;
  } catch {
    return false;
  }
}

export interface DebouncedPrefsSaver {
  /** Programa la escritura; las llamadas en < `delayMs` se agrupan en una sola (R6.8). */
  schedule(p: VisualPreferences): void;
  /** Escribe ya lo pendiente. Devuelve el resultado de la escritura o `true` si no había nada. */
  flush(): boolean;
  /** Descarta lo pendiente sin escribir. */
  cancel(): void;
}

export interface DebouncedSaverOptions {
  delayMs?: number;
  /** Se invoca tras cada escritura con su resultado (para el aviso no bloqueante de R6.13). */
  onResult?: (ok: boolean) => void;
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

/** Guardado agrupado con *debounce* de 250 ms por defecto (< 1 s, R6.8). */
export function createDebouncedPrefsSaver(
  storage: Storage | null,
  opts: DebouncedSaverOptions = {},
): DebouncedPrefsSaver {
  const delayMs = opts.delayMs ?? SAVE_DEBOUNCE_MS;
  const setT = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT =
    opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let pending: VisualPreferences | null = null;
  let handle: unknown = null;

  const flush = (): boolean => {
    if (handle !== null) {
      clearT(handle);
      handle = null;
    }
    if (!pending) return true;
    const p = pending;
    pending = null;
    const ok = saveVisualPrefs(storage, p);
    opts.onResult?.(ok);
    return ok;
  };

  return {
    schedule(p) {
      pending = p;
      if (handle !== null) clearT(handle);
      handle = setT(() => {
        handle = null;
        flush();
      }, delayMs);
    },
    flush,
    cancel() {
      if (handle !== null) clearT(handle);
      handle = null;
      pending = null;
    },
  };
}
