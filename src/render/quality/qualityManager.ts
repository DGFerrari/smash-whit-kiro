/**
 * Gestor_Calidad: preset por defecto según hardware, cambios de preset/controles,
 * Movimiento_Reducido y calidad efectiva (`ResolvedQuality`).
 *
 * R6.2, R6.3, R6.5–R6.7, R6.12, R6.13, R7.7, R9.2–R9.6.
 *
 * La lógica es pura; los efectos (lectura de hardware, `matchMedia`, atributo
 * `data-reduced-motion` en `<html>`, aviso no bloqueante, almacenamiento) se inyectan
 * con valores por defecto seguros. Nunca toca `src/engine/` ni el Estado_Simulación.
 */

import {
  createDebouncedPrefsSaver,
  defaultVisualPrefs,
  derivePresetLabel,
  getDefaultStorage,
  isLevel,
  isRenderScale,
  loadVisualPrefs,
  presetControls,
  saveVisualPrefs,
  type ControlKey,
  type DebouncedSaverOptions,
  type GraphicControls,
  type PresetId,
  type PresetLabel,
  type VisualPreferences,
} from "./visualPrefs";

export { derivePresetLabel, PRESETS } from "./visualPrefs";

// ---------------------------------------------------------------------------
// Detección de hardware (pura + lectores por defecto)
// ---------------------------------------------------------------------------

export interface HardwareInfo {
  /** Cadena del renderizador WebGL; `null` si no se pudo leer. */
  gpuRenderer: string | null;
  /** `navigator.hardwareConcurrency ?? 0`. */
  logicalCores: number;
}

/** Cadenas que no identifican una GPU real (genéricas o rasterizado por software). */
const GENERIC_GPU_PATTERNS: readonly RegExp[] = [
  /^\s*$/,
  /^unknown/i,
  /^webgl/i,
  /^webkit webgl$/i,
  /^mozilla$/i,
  /^generic/i,
  /swiftshader/i,
  /llvmpipe/i,
  /softpipe/i,
  /software/i,
  /microsoft basic render/i,
];

export function isGpuIdentified(gpuRenderer: string | null): boolean {
  if (gpuRenderer === null) return false;
  return !GENERIC_GPU_PATTERNS.some((re) => re.test(gpuRenderer));
}

/**
 * R6.2: `medio` salvo GPU no identificable o < 4 núcleos lógicos ⇒ `bajo`.
 * Nunca devuelve `alto`.
 */
export function detectDefaultPreset(hw: HardwareInfo): "bajo" | "medio" {
  const cores = Number.isFinite(hw.logicalCores) ? hw.logicalCores : 0;
  if (!isGpuIdentified(hw.gpuRenderer) || cores < 4) return "bajo";
  return "medio";
}

/** Contexto mínimo para leer el renderizador (WebGL1 o WebGL2). */
export interface GlLike {
  getExtension(name: string): unknown;
  getParameter(p: number): unknown;
  readonly RENDERER: number;
}

/** Lee `UNMASKED_RENDERER_WEBGL` o, en su defecto, `gl.RENDERER`. */
export function readGpuRenderer(gl: GlLike | null): string | null {
  if (!gl) return null;
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info") as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null;
    const raw = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return typeof raw === "string" && raw.trim() !== "" ? raw : null;
  } catch {
    return null;
  }
}

/** Lector por defecto: crea un contexto WebGL temporal y lo libera. */
export function detectHardwareInfo(): HardwareInfo {
  let gpuRenderer: string | null = null;
  try {
    const doc = (globalThis as { document?: Document }).document;
    const canvas = doc?.createElement("canvas");
    const gl = (canvas?.getContext("webgl2") ?? canvas?.getContext("webgl")) as
      | (GlLike & { getExtension(n: string): unknown })
      | null
      | undefined;
    gpuRenderer = readGpuRenderer(gl ?? null);
    const lose = gl?.getExtension("WEBGL_lose_context") as { loseContext(): void } | null;
    lose?.loseContext();
  } catch {
    gpuRenderer = null;
  }
  let logicalCores = 0;
  try {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    logicalCores = nav?.hardwareConcurrency ?? 0;
  } catch {
    logicalCores = 0;
  }
  return { gpuRenderer, logicalCores };
}

export type MatchMediaFn = (query: string) => { matches: boolean };

/** R9.2/R9.3: `true` solo si el navegador indica `prefers-reduced-motion: reduce`. */
export function prefersReducedMotion(matchMedia: MatchMediaFn | null | undefined): boolean {
  if (!matchMedia) return false;
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

function defaultMatchMedia(): MatchMediaFn | null {
  const w = globalThis as { matchMedia?: MatchMediaFn };
  return typeof w.matchMedia === "function" ? (q) => w.matchMedia!(q) : null;
}

// ---------------------------------------------------------------------------
// Calidad efectiva
// ---------------------------------------------------------------------------

export interface ResolvedQuality {
  /** Controles efectivos (con los recortes de Movimiento_Reducido). */
  readonly controls: Readonly<GraphicControls>;
  readonly reducedMotion: boolean;
  /** Preset mostrado en opciones. */
  readonly preset: PresetLabel;
  /** Destello de lente en impactos pesados (R7.5, desactivado con Movimiento_Reducido, R7.7). */
  readonly impactLensFlares: boolean;
  /** Limitador de destellos a pantalla completa ≤ 3/s activo (R9.7). */
  readonly flashLimiter: boolean;
}

/**
 * Pura. Con Movimiento_Reducido: `cameraShake` y `speedLines` a `desactivado` (R9.6),
 * sin destellos de lente de impacto (R7.7) y con limitador de destellos. Los valores
 * guardados del usuario no se alteran.
 */
export function resolveQuality(prefs: VisualPreferences): ResolvedQuality {
  const rm = prefs.reducedMotion;
  const controls: GraphicControls = { ...prefs.controls };
  if (rm) {
    controls.cameraShake = "desactivado";
    controls.speedLines = "desactivado";
  }
  return Object.freeze({
    controls: Object.freeze(controls),
    reducedMotion: rm,
    preset: prefs.preset,
    impactLensFlares: !rm && controls.lensFlares !== "desactivado",
    flashLimiter: rm,
  });
}

// ---------------------------------------------------------------------------
// Efectos de DOM por defecto
// ---------------------------------------------------------------------------

export const REDUCED_MOTION_ATTR = "data-reduced-motion";
export const STORAGE_WARNING_TEXT =
  "No se pueden guardar los ajustes en este navegador; se aplicarán solo durante esta sesión.";

/** Añade/quita `data-reduced-motion` en `<html>`. */
export function applyReducedMotionAttr(on: boolean): void {
  try {
    const root = (globalThis as { document?: Document }).document?.documentElement;
    if (!root) return;
    if (on) root.setAttribute(REDUCED_MOTION_ATTR, "");
    else root.removeAttribute(REDUCED_MOTION_ATTR);
  } catch {
    /* sin DOM: nada que hacer */
  }
}

/** Aviso no bloqueante (`role="status"`), se retira solo a los 6 s. */
export function showStorageWarning(message: string): void {
  try {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc?.body) return;
    const el = doc.createElement("div");
    el.className = "kb-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.textContent = message;
    doc.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  } catch {
    /* sin DOM */
  }
}

// ---------------------------------------------------------------------------
// Gestor
// ---------------------------------------------------------------------------

export interface QualityManager {
  /** Calidad efectiva actual (controles + Movimiento_Reducido). */
  get(): ResolvedQuality;
  /** Preferencias del usuario tal cual (sin recortes), para el menú de opciones. */
  getPreferences(): VisualPreferences;
  selectPreset(id: PresetId): void;
  setControl<K extends ControlKey>(k: K, v: GraphicControls[K]): void;
  setReducedMotion(on: boolean): void;
  /** Notificación síncrona tras cada cambio. Devuelve la función para darse de baja. */
  subscribe(cb: (q: ResolvedQuality) => void): () => void;
  /** Escribe ya cualquier guardado pendiente (p. ej. en `pagehide`). */
  flush(): void;
}

export interface QualityManagerOptions {
  /** `undefined` ⇒ `localStorage`; `null` ⇒ sin almacenamiento. */
  storage?: Storage | null;
  /** Información de hardware o un lector perezoso (solo se usa sin preferencias guardadas). */
  hardware?: HardwareInfo | (() => HardwareInfo);
  /** `undefined` ⇒ `window.matchMedia`; `null` ⇒ no soportado. */
  matchMedia?: MatchMediaFn | null;
  /** Efecto de Movimiento_Reducido en `<html>`. */
  onReducedMotionAttr?: (on: boolean) => void;
  /** Aviso no bloqueante (se invoca como máximo una vez por gestor/sesión). */
  onStorageWarning?: (message: string) => void;
  /** Opciones del guardado con *debounce* (temporizadores inyectables). */
  saver?: Omit<DebouncedSaverOptions, "onResult">;
}

export function createQualityManager(opts: QualityManagerOptions = {}): QualityManager {
  const storage = opts.storage === undefined ? getDefaultStorage() : opts.storage;
  const setAttr = opts.onReducedMotionAttr ?? applyReducedMotionAttr;
  const warnFn = opts.onStorageWarning ?? showStorageWarning;

  let warned = false;
  const reportSave = (ok: boolean): void => {
    if (ok || warned) return;
    warned = true;
    warnFn(STORAGE_WARNING_TEXT);
  };

  const saver = createDebouncedPrefsSaver(storage, { ...opts.saver, onResult: reportSave });

  // Estado inicial (R6.2, R6.10, R9.2–R9.4).
  const loaded = loadVisualPrefs(storage);
  let prefs: VisualPreferences;
  if (loaded.prefs) {
    prefs = loaded.prefs;
  } else {
    const hwOpt = opts.hardware;
    const hw = typeof hwOpt === "function" ? hwOpt() : hwOpt ?? detectHardwareInfo();
    const mm = opts.matchMedia === undefined ? defaultMatchMedia() : opts.matchMedia;
    prefs = defaultVisualPrefs(detectDefaultPreset(hw), prefersReducedMotion(mm));
    // Sobrescribe datos ausentes o inválidos con un estado válido.
    if (loaded.storageOk) reportSave(saveVisualPrefs(storage, prefs));
  }
  if (!loaded.storageOk) reportSave(false);

  let resolved = resolveQuality(prefs);
  setAttr(prefs.reducedMotion);

  const subs = new Set<(q: ResolvedQuality) => void>();

  const commit = (next: VisualPreferences): void => {
    const rmChanged = next.reducedMotion !== prefs.reducedMotion;
    prefs = next;
    resolved = resolveQuality(prefs);
    if (rmChanged) setAttr(prefs.reducedMotion);
    saver.schedule(prefs);
    for (const cb of [...subs]) cb(resolved);
  };

  return {
    get: () => resolved,
    getPreferences: () => ({ ...prefs, controls: { ...prefs.controls } }),

    selectPreset(id) {
      commit({ ...prefs, preset: id, lastPreset: id, controls: presetControls(id) });
    },

    setControl(k, v) {
      const valid = k === "renderScale" ? isRenderScale(v) : isLevel(v);
      if (!valid || prefs.controls[k] === v) return;
      const controls = { ...prefs.controls, [k]: v } as GraphicControls;
      commit({ ...prefs, controls, preset: derivePresetLabel(controls, prefs.lastPreset) });
    },

    setReducedMotion(on) {
      if (prefs.reducedMotion === on) return;
      commit({ ...prefs, reducedMotion: on });
    },

    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },

    flush() {
      saver.flush();
    },
  };
}

let sharedManager: QualityManager | null = null;

/**
 * Gestor_Calidad compartido por toda la app (opciones, renderizador, VFX).
 * Se crea al primer uso con los efectos por defecto (localStorage, hardware real,
 * `matchMedia` y atributo en `<html>`).
 */
export function getQualityManager(): QualityManager {
  sharedManager ??= createQualityManager();
  return sharedManager;
}
