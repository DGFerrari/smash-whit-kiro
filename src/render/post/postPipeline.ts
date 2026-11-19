/**
 * Postprocesado (design.md «Postprocesado», R7.3–R7.7).
 *
 * Envuelve `EffectComposer` y reconstruye los pases solo cuando cambia la calidad.
 * - DOF barato: la capa `FAR_LAYER` se dibuja en un RT de baja resolución, se desenfoca con un
 *   blur gaussiano separable y se compone detrás del plano de combate (sin buffer de profundidad).
 * - Bloom: `UnrealBloomPass` a resolución reducida con umbral alto (solo emisivos/VFX).
 * - Destellos de lente: `Lensflare` en luces intensas + reserva de sprites de impacto (0,4 s).
 * - Salida: `OutputPass` (usa `renderer.toneMapping` y `outputColorSpace` del renderizador).
 *
 * Los objetos de fondo lejano deben marcarse con `obj.layers.set(FAR_LAYER)`. El pipeline
 * habilita `FAR_LAYER` en la cámara para que se vean también sin DOF.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { Lensflare, LensflareElement } from "three/examples/jsm/objects/Lensflare.js";

import {
  buildPassList,
  needsComposer,
  passListKey,
  type BloomPassDesc,
  type DofPassDesc,
  type LensflarePassDesc,
  type PassDesc,
  type PostQualityInput,
} from "./passList";

export * from "./passList";

/** Capa Three.js de las capas `far` del escenario (desenfocadas con DOF). */
export const FAR_LAYER = 1;

/** Vida de un destello de impacto (R7.5). */
export const IMPACT_FLARE_LIFE_S = 0.4;
const IMPACT_POOL_SIZE = 8;

// ---------------------------------------------------------------------------
// Texturas procedurales (sin imágenes externas)
// ---------------------------------------------------------------------------

type Profile = (r: number, x: number, y: number) => number;

function makeRadialTexture(size: number, profile: Profile): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i - half) / half;
      const y = (j - half) / half;
      const r = Math.min(1, Math.hypot(x, y));
      const a = Math.max(0, Math.min(1, profile(r, x, y)));
      const o = (j * size + i) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

interface FlareTextures {
  core: THREE.DataTexture;
  halo: THREE.DataTexture;
  ghost: THREE.DataTexture;
  star: THREE.DataTexture;
}

let sharedTextures: FlareTextures | null = null;

/** Texturas compartidas, creadas una vez (no se liberan con cada pipeline). */
function flareTextures(): FlareTextures {
  sharedTextures ??= {
    core: makeRadialTexture(64, (r) => Math.pow(1 - r, 3)),
    halo: makeRadialTexture(64, (r) => 0.35 * Math.exp(-Math.pow((r - 0.75) / 0.12, 2))),
    ghost: makeRadialTexture(32, (r) => 0.5 * (1 - Math.pow(r, 6)) * (0.4 + 0.6 * r)),
    star: makeRadialTexture(64, (r, x, y) => {
      const glow = Math.pow(1 - r, 4);
      const streak = Math.exp(-Math.abs(y) * 40) * (1 - Math.abs(x)) + Math.exp(-Math.abs(x) * 40) * (1 - Math.abs(y)) * 0.6;
      return glow + streak;
    }),
  };
  return sharedTextures;
}

// ---------------------------------------------------------------------------
// Destellos de lente
// ---------------------------------------------------------------------------

export interface LensflareOptions {
  /** Elementos «ghost» a lo largo del eje de la lente (por defecto `true`). */
  ghosts?: boolean;
  /** Tamaño del núcleo en píxeles (por defecto 220). */
  size?: number;
}

/** Crea un `Lensflare` con texturas procedurales, lo añade a `light` y lo devuelve. */
export function createLensflareFor(
  light: THREE.Object3D,
  color: THREE.ColorRepresentation,
  opts: LensflareOptions = {},
): Lensflare {
  const t = flareTextures();
  const c = new THREE.Color(color);
  const size = opts.size ?? 220;
  const flare = new Lensflare();
  flare.addElement(new LensflareElement(t.core, size, 0, c));
  flare.addElement(new LensflareElement(t.halo, size * 1.6, 0, c));
  if (opts.ghosts ?? true) {
    flare.addElement(new LensflareElement(t.ghost, size * 0.25, 0.6, c));
    flare.addElement(new LensflareElement(t.ghost, size * 0.35, 0.7, c));
    flare.addElement(new LensflareElement(t.ghost, size * 0.55, 0.9, c));
    flare.addElement(new LensflareElement(t.ghost, size * 0.3, 1.0, c));
  }
  light.add(flare);
  return flare;
}

interface ImpactSlot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  age: number;
  alive: boolean;
}

/** Reserva fija de sprites aditivos para destellos de impacto (0,4 s). */
export class ImpactFlarePool {
  readonly group = new THREE.Group();
  private readonly slots: ImpactSlot[] = [];
  private next = 0;
  enabled = true;

  constructor(size = IMPACT_POOL_SIZE, private readonly baseScale = 2.2) {
    this.group.name = "impactFlares";
    const tex = flareTextures().star;
    for (let i = 0; i < size; i++) {
      const material = new THREE.SpriteMaterial({
        map: tex,
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 1000;
      this.group.add(sprite);
      this.slots.push({ sprite, material, age: 0, alive: false });
    }
  }

  spawn(x: number, y: number, z: number, color: THREE.ColorRepresentation): void {
    if (!this.enabled || this.slots.length === 0) return;
    const s = this.slots[this.next];
    this.next = (this.next + 1) % this.slots.length;
    s.alive = true;
    s.age = 0;
    s.sprite.position.set(x, y, z);
    s.material.color.set(color);
    s.material.rotation = Math.random() * Math.PI;
    this.apply(s);
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age >= IMPACT_FLARE_LIFE_S) {
        s.alive = false;
        s.sprite.visible = false;
        continue;
      }
      this.apply(s);
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.alive = false;
      s.sprite.visible = false;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const s of this.slots) s.material.dispose();
    this.slots.length = 0;
  }

  private apply(s: ImpactSlot): void {
    const t = s.age / IMPACT_FLARE_LIFE_S;
    const grow = 1 - Math.pow(1 - t, 3);
    const k = this.baseScale * (0.5 + 0.9 * grow);
    s.sprite.scale.set(k * 1.6, k, 1);
    s.material.opacity = (1 - t) * (1 - t);
    s.sprite.visible = true;
  }
}

// ---------------------------------------------------------------------------
// Pases personalizados
// ---------------------------------------------------------------------------

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 direction;
uniform vec2 texelSize;
uniform float radius;
varying vec2 vUv;
void main() {
  vec2 step = direction * texelSize * radius;
  vec4 c = texture2D(tDiffuse, vUv) * 0.227027;
  c += texture2D(tDiffuse, vUv + step * 1.0) * 0.1945946;
  c += texture2D(tDiffuse, vUv - step * 1.0) * 0.1945946;
  c += texture2D(tDiffuse, vUv + step * 2.0) * 0.1216216;
  c += texture2D(tDiffuse, vUv - step * 2.0) * 0.1216216;
  c += texture2D(tDiffuse, vUv + step * 3.0) * 0.054054;
  c += texture2D(tDiffuse, vUv - step * 3.0) * 0.054054;
  c += texture2D(tDiffuse, vUv + step * 4.0) * 0.016216;
  c += texture2D(tDiffuse, vUv - step * 4.0) * 0.016216;
  gl_FragColor = c;
}`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`;

/**
 * Sustituye a `RenderPass` cuando hay DOF: capa lejana a RT reducido + blur → fondo;
 * después el resto de capas a resolución completa encima (sin desenfoque).
 */
class FarLayerDofPass extends Pass {
  private readonly rtA: THREE.WebGLRenderTarget;
  private readonly rtB: THREE.WebGLRenderTarget;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly blurQuad: FullScreenQuad;
  private readonly copyQuad: FullScreenQuad;
  private readonly clearColor = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly desc: DofPassDesc,
  ) {
    super();
    this.needsSwap = false;
    const opts = { type: THREE.HalfFloatType, depthBuffer: true } as const;
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        direction: { value: new THREE.Vector2(1, 0) },
        texelSize: { value: new THREE.Vector2(1, 1) },
        radius: { value: desc.radius },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: QUAD_VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurQuad = new FullScreenQuad(this.blurMat);
    this.copyQuad = new FullScreenQuad(this.copyMat);
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.desc.resolutionScale));
    const h = Math.max(1, Math.round(height * this.desc.resolutionScale));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    (this.blurMat.uniforms.texelSize.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const { scene, camera } = this;
    const mask = camera.layers.mask;
    const oldAutoClear = renderer.autoClear;
    renderer.getClearColor(this.clearColor);
    const oldClearAlpha = renderer.getClearAlpha();

    // Las luces se filtran por capas: deben iluminar también la capa lejana.
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) o.layers.enable(FAR_LAYER);
    });

    // 1. Capa lejana (con el fondo de la escena) a baja resolución.
    camera.layers.set(FAR_LAYER);
    renderer.autoClear = true;
    renderer.setRenderTarget(this.rtA);
    renderer.render(scene, camera);
    renderer.autoClear = false;

    // 2. Blur separable ping-pong A→B→A.
    const u = this.blurMat.uniforms;
    for (let i = 0; i < this.desc.iterations; i++) {
      u.tDiffuse.value = this.rtA.texture;
      (u.direction.value as THREE.Vector2).set(1, 0);
      renderer.setRenderTarget(this.rtB);
      this.blurQuad.render(renderer);
      u.tDiffuse.value = this.rtB.texture;
      (u.direction.value as THREE.Vector2).set(0, 1);
      renderer.setRenderTarget(this.rtA);
      this.blurQuad.render(renderer);
    }

    // 3. Fondo desenfocado + plano de combate/primer plano nítidos.
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.copyMat.uniforms.tDiffuse.value = this.rtA.texture;
    this.copyQuad.render(renderer);
    renderer.clearDepth();
    camera.layers.mask = mask & ~(1 << FAR_LAYER);
    const bg = scene.background;
    scene.background = null;
    renderer.render(scene, camera);
    scene.background = bg;

    camera.layers.mask = mask;
    renderer.autoClear = oldAutoClear;
    renderer.setClearColor(this.clearColor, oldClearAlpha);
  }

  override dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.blurMat.dispose();
    this.copyMat.dispose();
    this.blurQuad.dispose();
    this.copyQuad.dispose();
  }
}

/** `UnrealBloomPass` a una fracción de la resolución de salida. */
class ScaledBloomPass extends UnrealBloomPass {
  constructor(private readonly scale: number, desc: BloomPassDesc) {
    super(new THREE.Vector2(256, 256), desc.strength, desc.radius, desc.threshold);
  }

  override setSize(width: number, height: number): void {
    // `scale` puede no estar asignado aún si la clase base llama a setSize en su constructor.
    const s = this.scale ?? 1;
    super.setSize(Math.max(2, Math.round(width * s)), Math.max(2, Math.round(height * s)));
  }
}

// ---------------------------------------------------------------------------
// PostPipeline
// ---------------------------------------------------------------------------

interface TrackedFlare {
  light: THREE.Object3D;
  color: THREE.ColorRepresentation;
  flare: Lensflare | null;
  ghosts: boolean;
}

export class PostPipeline {
  private composer: EffectComposer | null = null;
  private passes: PassDesc[] = [];
  private key = "";
  private width: number;
  private height: number;
  private pixelRatio: number;
  private readonly flares: TrackedFlare[] = [];
  private lensDesc: LensflarePassDesc | null = null;
  private readonly impact = new ImpactFlarePool();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    this.width = size.x;
    this.height = size.y;
    this.pixelRatio = renderer.getPixelRatio();
    camera.layers.enable(FAR_LAYER);
    this.impact.enabled = false;
    scene.add(this.impact.group);
  }

  /** Lista de pases vigente (descriptores puros). */
  get passList(): readonly PassDesc[] {
    return this.passes;
  }

  /** `true` si `render()` usa `EffectComposer`. */
  get usesComposer(): boolean {
    return this.composer !== null;
  }

  /** Aplica la calidad; solo reconstruye si cambia la lista de pases. */
  apply(quality: PostQualityInput): void {
    const passes = buildPassList(quality);
    const key = passListKey(passes);
    if (key === this.key) return;
    this.key = key;
    this.passes = passes;
    this.rebuildComposer();
    this.lensDesc = (passes.find((p) => p.kind === "lensflare") as LensflarePassDesc) ?? null;
    this.impact.enabled = this.lensDesc?.impact ?? false;
    if (!this.impact.enabled) this.impact.clear();
    for (const f of this.flares) this.syncFlare(f);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
    }
  }

  render(deltaTime?: number): void {
    if (this.composer) this.composer.render(deltaTime);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Registra un destello de lente en una luz intensa del escenario (según `lensFlares`). */
  attachLensflare(light: THREE.Object3D, color: THREE.ColorRepresentation): void {
    const f: TrackedFlare = { light, color, flare: null, ghosts: false };
    this.flares.push(f);
    this.syncFlare(f);
  }

  /** Quita todos los destellos de luces (p. ej. al cambiar de escenario). */
  clearLensflares(): void {
    for (const f of this.flares) this.removeFlare(f);
    this.flares.length = 0;
  }

  /** Destello de impacto de 0,4 s; no hace nada si `impactLensFlares` está desactivado. */
  spawnImpactFlare(x: number, y: number, z: number, color: THREE.ColorRepresentation): void {
    this.impact.spawn(x, y, z, color);
  }

  /** Avanza los destellos de impacto (`dt` en segundos). */
  update(dt: number): void {
    this.impact.update(dt);
  }

  dispose(): void {
    this.disposeComposer();
    this.clearLensflares();
    this.impact.dispose();
    this.key = "";
    this.passes = [];
  }

  // -------------------------------------------------------------------------

  private syncFlare(f: TrackedFlare): void {
    const d = this.lensDesc;
    if (!d) {
      this.removeFlare(f);
      return;
    }
    if (f.flare && f.ghosts === d.ghosts) return;
    this.removeFlare(f);
    f.flare = createLensflareFor(f.light, f.color, { ghosts: d.ghosts });
    f.ghosts = d.ghosts;
  }

  private removeFlare(f: TrackedFlare): void {
    if (!f.flare) return;
    f.flare.removeFromParent();
    f.flare.dispose();
    f.flare = null;
  }

  private disposeComposer(): void {
    if (!this.composer) return;
    for (const p of this.composer.passes) p.dispose();
    this.composer.dispose();
    this.composer = null;
  }

  private rebuildComposer(): void {
    this.disposeComposer();
    if (!needsComposer(this.passes)) return;
    const composer = new EffectComposer(this.renderer);
    for (const d of this.passes) {
      if (d.kind === "dof") composer.addPass(new FarLayerDofPass(this.scene, this.camera, d));
      else if (d.kind === "bloom") composer.addPass(new ScaledBloomPass(d.resolutionScale, d));
      else if (d.kind === "output") composer.addPass(new OutputPass());
    }
    if (!this.passes.some((p) => p.kind === "dof")) {
      composer.insertPass(new RenderPass(this.scene, this.camera), 0);
    }
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
    this.composer = composer;
  }
}
