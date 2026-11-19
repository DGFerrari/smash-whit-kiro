/**
 * Lista de pases de postprocesado (design.md «Postprocesado», Property 7, R7.3–R7.7).
 *
 * Módulo puro: sin Three.js ni DOM. `PostPipeline` traduce estos descriptores a pases reales.
 * Un control en `desactivado` elimina su pase (R7.6). Si no queda ningún pase que necesite
 * `EffectComposer` (bloom o DOF), el llamador renderiza directamente con `renderer.render`.
 */

import type { GraphicControls, Level } from "../quality/visualPrefs";

/** Subconjunto de `ResolvedQuality` que usa el pipeline (`ResolvedQuality` es asignable). */
export interface PostQualityInput {
  readonly controls: Readonly<Pick<GraphicControls, "bloom" | "dof" | "lensFlares">>;
  /** Destellos de impacto (R7.5/R7.7). Si falta, se deriva de `lensFlares`. */
  readonly impactLensFlares?: boolean;
}

export type ActiveLevel = Exclude<Level, "desactivado">;

/** DOF barato: capa `far` en RT de baja resolución + blur gaussiano separable. */
export interface DofPassDesc {
  readonly kind: "dof";
  readonly level: ActiveLevel;
  /** Fracción de la resolución de salida del RT de fondo (1/4 bajo, 1/2 medio/alto). */
  readonly resolutionScale: number;
  /** Iteraciones H+V del blur separable. */
  readonly iterations: number;
  /** Separación entre muestras del kernel, en texels del RT reducido. */
  readonly radius: number;
}

/** Bloom (`UnrealBloomPass`) con umbral alto: solo brillan emisivos y VFX. */
export interface BloomPassDesc {
  readonly kind: "bloom";
  readonly level: ActiveLevel;
  /** Escala aplicada a la resolución que recibe `UnrealBloomPass` (que ya divide entre 2). */
  readonly resolutionScale: number;
  readonly strength: number;
  readonly radius: number;
  readonly threshold: number;
}

/** Destellos de lente: no es un pase del composer; controla `Lensflare` y destellos de impacto. */
export interface LensflarePassDesc {
  readonly kind: "lensflare";
  readonly level: ActiveLevel;
  /** Elementos «ghost» extra (en `bajo` solo núcleo + halo). */
  readonly ghosts: boolean;
  /** Destellos temporales en impactos pesados. */
  readonly impact: boolean;
}

/** `OutputPass`: tone mapping ACES + sRGB al final del composer. */
export interface OutputPassDesc {
  readonly kind: "output";
}

export type PassDesc = DofPassDesc | BloomPassDesc | LensflarePassDesc | OutputPassDesc;
export type PassKind = PassDesc["kind"];

export const BLOOM_THRESHOLD = 0.85;

export const BLOOM_BY_LEVEL: Readonly<Record<ActiveLevel, Omit<BloomPassDesc, "kind" | "level">>> =
  Object.freeze({
    bajo: Object.freeze({ resolutionScale: 0.5, strength: 0.6, radius: 0.35, threshold: BLOOM_THRESHOLD }),
    medio: Object.freeze({ resolutionScale: 0.5, strength: 0.8, radius: 0.45, threshold: BLOOM_THRESHOLD }),
    alto: Object.freeze({ resolutionScale: 1, strength: 1.0, radius: 0.55, threshold: BLOOM_THRESHOLD }),
  });

export const DOF_BY_LEVEL: Readonly<Record<ActiveLevel, Omit<DofPassDesc, "kind" | "level">>> =
  Object.freeze({
    bajo: Object.freeze({ resolutionScale: 0.25, iterations: 1, radius: 1.0 }),
    medio: Object.freeze({ resolutionScale: 0.5, iterations: 1, radius: 1.5 }),
    alto: Object.freeze({ resolutionScale: 0.5, iterations: 2, radius: 1.5 }),
  });

function active(l: Level): l is ActiveLevel {
  return l !== "desactivado";
}

/**
 * Orden: DOF (sustituye al render de escena) → bloom → lens flares → output.
 * `output` solo se añade si hay algún pase de composer (bloom o DOF).
 */
export function buildPassList(q: PostQualityInput): PassDesc[] {
  const { bloom, dof, lensFlares } = q.controls;
  const out: PassDesc[] = [];
  if (active(dof)) out.push({ kind: "dof", level: dof, ...DOF_BY_LEVEL[dof] });
  if (active(bloom)) out.push({ kind: "bloom", level: bloom, ...BLOOM_BY_LEVEL[bloom] });
  if (active(lensFlares)) {
    out.push({
      kind: "lensflare",
      level: lensFlares,
      ghosts: lensFlares !== "bajo",
      impact: q.impactLensFlares ?? true,
    });
  }
  if (needsComposer(out)) out.push({ kind: "output" });
  return out;
}

/** `true` si la lista requiere `EffectComposer`; si no, se usa `renderer.render` directo. */
export function needsComposer(passes: readonly PassDesc[]): boolean {
  return passes.some((p) => p.kind === "bloom" || p.kind === "dof");
}

/** Clave estable para detectar cambios y reconstruir solo cuando hace falta. */
export function passListKey(passes: readonly PassDesc[]): string {
  return JSON.stringify(passes);
}
