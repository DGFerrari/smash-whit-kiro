import * as THREE from "three";

/**
 * Materiales estilizados de personajes (R7.1, R7.2, R11.5).
 *
 * - `classifyMaterial`: decide el tipo físico (metal, cuero, tela, pelo, piel)
 *   por `materialMap` explícito o por el nombre del material.
 * - `applyStylizedMaterial`: aplica los parámetros del tipo e inyecta con
 *   `onBeforeCompile` un término de borde fresnel (`uRimColor`, `uRimPower`,
 *   `uRimStrength`) y el tinte de golpe (`uHitTint` = color + cantidad).
 *
 * Los uniforms se comparten por personaje (`createStylizedUniforms`): cambiar
 * `uHitTint.value.w` en un frame tiñe todos sus materiales sin recompilar.
 * `customProgramCacheKey` es constante, así que todos los materiales
 * estilizados del mismo tipo de shader reutilizan el mismo programa.
 */

/** Tipos de material. `skin` amplía los cuatro del diseño (piel/cara). */
export type MaterialType = "metal" | "leather" | "cloth" | "hair" | "skin";

export const MATERIAL_TYPES: readonly MaterialType[] = ["metal", "leather", "cloth", "hair", "skin"];

/** Parámetros físicos por tipo (solo se aplican los que el material admite). */
export interface MaterialParams {
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenRoughness?: number;
  anisotropy?: number;
  anisotropyRotation?: number;
}

export const MATERIAL_PARAMS: Readonly<Record<MaterialType, Readonly<MaterialParams>>> = {
  metal: { metalness: 0.9, roughness: 0.25, clearcoat: 0.3, clearcoatRoughness: 0.2 },
  leather: { metalness: 0, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.6 },
  cloth: { metalness: 0, roughness: 0.9, sheen: 1, sheenRoughness: 0.8 },
  hair: { metalness: 0, roughness: 0.4, anisotropy: 0.8, anisotropyRotation: 0 },
  skin: { metalness: 0, roughness: 0.6, sheen: 0.25, sheenRoughness: 0.5 },
};

/** Patrones por nombre, evaluados en este orden; lo que no encaja es tela. */
const NAME_RULES: ReadonlyArray<readonly [RegExp, MaterialType]> = [
  [/hair|fur|bang|ponytail|braid|pelo|cabello/i, "hair"],
  [/metal|armou?r|steel|iron|plate|blade|gauntlet|chrome|gold|silver|acero|hierro/i, "metal"],
  [/leather|belt|strap|boot|glove|holster|cuero|cintur/i, "leather"],
  [/skin|face|cara|piel|eye|mouth|body_?skin/i, "skin"],
];

/**
 * Tipo del material `name`: primero `materialMap[name]` exacto, luego el
 * mapa sin distinguir mayúsculas y por último las reglas por nombre.
 */
export function classifyMaterial(
  name: string,
  materialMap: Readonly<Record<string, MaterialType>> = {},
): MaterialType {
  const direct = materialMap[name];
  if (direct) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(materialMap)) {
    if (key.toLowerCase() === lower) return materialMap[key];
  }
  for (const [re, type] of NAME_RULES) if (re.test(name)) return type;
  return "cloth";
}

// ---------------------------------------------------------------------------
// Uniforms compartidos
// ---------------------------------------------------------------------------

export interface StylizedUniforms {
  uRimColor: THREE.IUniform<THREE.Color>;
  uRimPower: THREE.IUniform<number>;
  uRimStrength: THREE.IUniform<number>;
  /** rgb = color del tinte, w = cantidad 0..1. */
  uHitTint: THREE.IUniform<THREE.Vector4>;
  // Firma de índice para poder fusionarse con `shader.uniforms`.
  [name: string]: THREE.IUniform;
}

export interface StylizedUniformOptions {
  rimColor?: THREE.ColorRepresentation;
  rimPower?: number;
  rimStrength?: number;
}

export const DEFAULT_RIM_COLOR = "#bfe3ff";
export const DEFAULT_RIM_POWER = 3;
export const DEFAULT_RIM_STRENGTH = 0.6;

/** Crea el objeto de uniforms que comparten todos los materiales de un personaje. */
export function createStylizedUniforms(opts: StylizedUniformOptions = {}): StylizedUniforms {
  return {
    uRimColor: { value: new THREE.Color(opts.rimColor ?? DEFAULT_RIM_COLOR) },
    uRimPower: { value: opts.rimPower ?? DEFAULT_RIM_POWER },
    uRimStrength: { value: opts.rimStrength ?? DEFAULT_RIM_STRENGTH },
    uHitTint: { value: new THREE.Vector4(1, 1, 1, 0) },
  };
}

/** Fija el tinte de golpe (barato: solo escribe en los uniforms). */
export function setHitTint(
  uniforms: StylizedUniforms,
  amount: number,
  color?: THREE.ColorRepresentation,
): void {
  const v = uniforms.uHitTint.value;
  if (color !== undefined) {
    const c = new THREE.Color(color);
    v.x = c.r;
    v.y = c.g;
    v.z = c.b;
  }
  v.w = Math.min(1, Math.max(0, amount));
}

// ---------------------------------------------------------------------------
// Inyección de shader
// ---------------------------------------------------------------------------

/** Clave de caché constante: mismo programa para todos los materiales estilizados. */
export const STYLIZED_CACHE_KEY = "kb-stylized-rim-v1";

const DECL = /* glsl */ `
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
uniform vec4 uHitTint;
`;

const APPLY_RIM = /* glsl */ `
{
  vec3 kbView = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
  float kbFres = pow( 1.0 - clamp( dot( normalize( normal ), kbView ), 0.0, 1.0 ), uRimPower );
  outgoingLight += uRimColor * ( kbFres * uRimStrength );
  outgoingLight = mix( outgoingLight, uHitTint.rgb, clamp( uHitTint.w, 0.0, 1.0 ) );
}
`;

const APPLY_TINT_ONLY = /* glsl */ `
outgoingLight = mix( outgoingLight, uHitTint.rgb, clamp( uHitTint.w, 0.0, 1.0 ) );
`;

/**
 * Inserta las declaraciones y el término rim/tinte en un fragment shader de
 * Three.js. Los materiales sin normal (p. ej. `MeshBasicMaterial`) solo
 * reciben el tinte. Pura: devuelve el shader modificado.
 */
export function injectStylizedChunk(fragmentShader: string): string {
  if (fragmentShader.includes("uniform vec4 uHitTint;")) return fragmentShader;
  const hasNormal =
    fragmentShader.includes("#include <normal_fragment_begin>") &&
    fragmentShader.includes("vViewPosition");
  const apply = hasNormal ? APPLY_RIM : APPLY_TINT_ONLY;
  return fragmentShader
    .replace("#include <common>", `#include <common>\n${DECL}`)
    .replace("#include <opaque_fragment>", `${apply}\n#include <opaque_fragment>`);
}

type AnyMaterial = THREE.Material & Record<string, unknown>;

/** Aplica los parámetros de `type` que el material admita (no inyecta shader). */
export function applyMaterialParams(mat: THREE.Material, type: MaterialType): void {
  const p = MATERIAL_PARAMS[type];
  const m = mat as AnyMaterial;
  const set = (key: string, value: number | undefined): void => {
    if (value !== undefined && typeof m[key] === "number") m[key] = value;
  };
  set("metalness", p.metalness);
  set("roughness", p.roughness);
  set("clearcoat", p.clearcoat);
  set("clearcoatRoughness", p.clearcoatRoughness);
  set("sheen", p.sheen);
  set("sheenRoughness", p.sheenRoughness);
  set("anisotropy", p.anisotropy);
  set("anisotropyRotation", p.anisotropyRotation);
  if (p.sheen !== undefined && m.sheenColor instanceof THREE.Color && m.color instanceof THREE.Color) {
    m.sheenColor.copy(m.color).lerp(new THREE.Color(1, 1, 1), 0.3);
  }
}

export interface ApplyStylizedOptions {
  /** Uniforms compartidos del personaje (obligatorio para el tinte por frame). */
  uniforms: StylizedUniforms;
  /** Aplicar parámetros físicos del tipo (por defecto `true`). */
  applyParams?: boolean;
}

/**
 * Estiliza `mat` en el sitio: parámetros del tipo + chunk rim/tinte. Es
 * idempotente para el mismo objeto de uniforms y encadena un
 * `onBeforeCompile` previo si existía. Devuelve el mismo material.
 */
export function applyStylizedMaterial<M extends THREE.Material>(
  mat: M,
  type: MaterialType,
  opts: ApplyStylizedOptions,
): M {
  if (opts.applyParams !== false) applyMaterialParams(mat, type);
  mat.userData.kbMaterialType = type;
  if (mat.userData.kbUniforms === opts.uniforms) return mat;

  const uniforms = opts.uniforms;
  const base = THREE.Material.prototype.onBeforeCompile;
  const prev = mat.userData.kbUniforms ? mat.userData.kbPrevOnBeforeCompile : mat.onBeforeCompile;
  const chained = typeof prev === "function" && prev !== base ? prev : null;
  const prevKey = chained ? String(mat.userData.kbPrevCacheKey ?? "") : "";
  if (!mat.userData.kbUniforms) {
    mat.userData.kbPrevOnBeforeCompile = mat.onBeforeCompile;
    mat.userData.kbPrevCacheKey = chained ? mat.customProgramCacheKey() : "";
  }

  mat.userData.kbUniforms = uniforms;
  mat.onBeforeCompile = (shader, renderer) => {
    if (chained) chained.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = injectStylizedChunk(shader.fragmentShader);
  };
  const key = prevKey ? `${STYLIZED_CACHE_KEY}|${prevKey}` : STYLIZED_CACHE_KEY;
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}

/** Crea un material PBR del tipo indicado, ya estilizado. */
export function createStylizedMaterial(
  type: MaterialType,
  color: THREE.ColorRepresentation,
  uniforms: StylizedUniforms,
): THREE.MeshStandardMaterial {
  const mat =
    type === "skin"
      ? new THREE.MeshStandardMaterial({ color })
      : new THREE.MeshPhysicalMaterial({ color });
  mat.name = `kb-${type}`;
  return applyStylizedMaterial(mat, type, { uniforms });
}

/**
 * Estiliza todos los materiales de un modelo cargado. Los materiales ya
 * estilizados con otros uniforms (modelo compartido en caché) se clonan para
 * que el tinte de un personaje no afecte a otro.
 */
export function stylizeModel(
  root: THREE.Object3D,
  materialMap: Readonly<Record<string, MaterialType>>,
  uniforms: StylizedUniforms,
): void {
  const done = new Map<THREE.Material, THREE.Material>();
  const fix = (m: THREE.Material): THREE.Material => {
    const cached = done.get(m);
    if (cached) return cached;
    const target = m.userData.kbUniforms && m.userData.kbUniforms !== uniforms ? m.clone() : m;
    if (target !== m) {
      // El clon hereda las funciones parcheadas: se reinicia para reinyectar.
      target.userData = { ...m.userData, kbUniforms: undefined };
      target.onBeforeCompile = m.userData.kbPrevOnBeforeCompile ?? THREE.Material.prototype.onBeforeCompile;
    }
    applyStylizedMaterial(target, classifyMaterial(m.name, materialMap), { uniforms });
    done.set(m, target);
    return target;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material);
  });
}

// ---------------------------------------------------------------------------
// Toon
// ---------------------------------------------------------------------------

let toonGradient: THREE.DataTexture | null = null;

/** Rampa de 3 bandas compartida para `MeshToonMaterial` (sombra, medio, luz). */
export function getToonGradient(): THREE.DataTexture {
  if (!toonGradient) {
    const tex = new THREE.DataTexture(new Uint8Array([70, 160, 255]), 3, 1, THREE.RedFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    toonGradient = tex;
  }
  return toonGradient;
}

/** Material toon de 3 bandas con rim y tinte de golpe. */
export function createToonMaterial(
  type: MaterialType,
  color: THREE.ColorRepresentation,
  uniforms: StylizedUniforms,
  params: THREE.MeshToonMaterialParameters = {},
): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: getToonGradient(), ...params });
  mat.name = `kb-toon-${type}`;
  return applyStylizedMaterial(mat, type, { uniforms });
}
