/**
 * Sistema_VFX (R8, R9): efectos de combate estilo cómic/arcade.
 *
 * Lee el World SOLO en lectura: el detector de eventos compara el estado de
 * los combatientes entre frames de render y de ahí salen los efectos. Todo
 * vive en pools retenidos (sin crear mallas/materiales por frame):
 *  - Destello de impacto en estrella + onda de choque con borde dentado.
 *  - Líneas de velocidad en la dirección del knockback (golpes fuertes).
 *  - Vibración de cámara proporcional al knockback.
 *  - Estela de partículas mientras el jugador está aturdido.
 *  - Partículas que convergen mientras carga un fuerte.
 *  - Aura de llamas mientras la furia está activa.
 *  - Estallido de KO en el borde de salida, orientado hacia dentro.
 *
 * La aleatoriedad sale de `createVisualRng` (independiente del RNG del motor).
 */
import * as THREE from "three";
import type { World } from "../../engine/game/world.ts";
import type { Level } from "../quality/visualPrefs.ts";
import type { ResolvedQuality } from "../quality/qualityManager.ts";
import { createVisualRng } from "../visualRng.ts";
import { createEventDetector, type VisualEvent, type KoEdge } from "./eventDetector.ts";
import { createParticlePool, capacityForLevel, type ParticlePool } from "./particlePool.ts";
import { createParticleMesh, type ParticleMesh } from "./particleMesh.ts";
import { createFlashLimiter, type FlashLimiter } from "./flashLimiter.ts";

// ---------------------------------------------------------------------------
// Funciones puras de intensidad (testables)
// ---------------------------------------------------------------------------

/** Factor multiplicador por nivel de un control (0 = desactivado). */
export function levelFactor(level: Level): number {
  switch (level) {
    case "desactivado":
      return 0;
    case "bajo":
      return 0.5;
    case "medio":
      return 0.8;
    default:
      return 1;
  }
}

export interface ImpactIntensity {
  /** Escala del destello/onda (ligero 0,6; fuerte 1,0–1,6). */
  scale: number;
  /** Duración de la vibración de cámara (ms); 0 = sin vibración. */
  shakeMs: number;
  /** Amplitud de la vibración (unidades de escena). */
  shakeAmp: number;
  /** Nº de líneas de velocidad; 0 = ninguna. */
  speedLines: number;
}

/** Intensidad de un impacto según tipo y factor de knockback k ∈ [0,1]. */
export function impactIntensity(heavy: boolean, k: number): ImpactIntensity {
  const kk = Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0));
  if (!heavy) return { scale: 0.6, shakeMs: 0, shakeAmp: 0, speedLines: 0 };
  return {
    scale: 1 + 0.6 * kk,
    shakeMs: 100 + 300 * kk,
    shakeAmp: 4 + 14 * kk,
    speedLines: Math.round(8 + 24 * kk),
  };
}

/** Partículas de carga emitidas por frame (monótona en la proporción). */
export function chargeEmission(ratio: number, particleFactor: number): number {
  const r = Math.min(1, Math.max(0, ratio));
  return Math.floor((1 + 5 * r) * particleFactor + r * r * 2 * particleFactor);
}

/** Dirección hacia el interior del escenario desde un borde de KO (mundo, Y abajo). */
export function inwardDir(edge: KoEdge): { x: number; y: number } {
  switch (edge) {
    case "left":
      return { x: 1, y: 0 };
    case "right":
      return { x: -1, y: 0 };
    case "top":
      return { x: 0, y: 1 };
    default:
      return { x: 0, y: -1 };
  }
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const BILLBOARD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Estrella de cómic con núcleo blanco y borde de color. */
const BURST_FRAG = /* glsl */ `
uniform float uProgress;
uniform vec3 uColor;
uniform float uSpikes;
uniform float uRot;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float a = atan(vUv.y, vUv.x) + uRot;
  float spikes = pow(abs(cos(a * uSpikes * 0.5)), 6.0);
  float grow = 0.35 + 0.65 * sqrt(uProgress);
  float edge = mix(0.32, 1.0, spikes) * grow;
  float shape = smoothstep(edge, edge - 0.08, r);
  float core = smoothstep(0.45 * grow, 0.0, r);
  float fade = 1.0 - uProgress;
  vec3 col = mix(uColor, vec3(1.0), core) * uIntensity;
  float alpha = shape * fade;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

/** Onda de choque: anillo con borde dentado que se expande y adelgaza. */
const RING_FRAG = /* glsl */ `
uniform float uProgress;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uSeed;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float a = atan(vUv.y, vUv.x);
  float p = 1.0 - pow(1.0 - uProgress, 3.0);
  float jag = 0.035 * sin(a * 14.0 + uSeed) + 0.02 * sin(a * 31.0 - uSeed * 2.0);
  float radius = 0.15 + 0.85 * p + jag * (1.0 - p);
  float width = mix(0.16, 0.025, p);
  float d = abs(r - radius);
  float ring = smoothstep(width, 0.0, d);
  float inner = smoothstep(width * 0.35, 0.0, d);
  vec3 col = mix(uColor, vec3(1.0), inner) * uIntensity;
  float alpha = ring * (1.0 - p);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

/** Aura de furia: llamas que suben con ruido de senos, más intensas en el borde. */
const AURA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vec2(vUv.x * 1.25, vUv.y);
  float r = length(p);
  float flame = sin(p.x * 9.0 + uTime * 6.0) * 0.08
              + sin(p.x * 17.0 - uTime * 9.0) * 0.05
              + sin(p.y * 6.0 - uTime * 11.0) * 0.06;
  float lift = clamp(vUv.y * 0.5 + 0.5, 0.0, 1.0);
  float radius = 0.72 + flame + lift * 0.12;
  float body = smoothstep(radius, radius - 0.28, r);
  float hollow = smoothstep(0.25, 0.6, r);
  float glow = body * hollow;
  vec3 col = mix(uColor, vec3(1.0, 0.95, 0.8), smoothstep(0.55, 0.75, r) * 0.6) * 1.6;
  float alpha = glow * uAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

function billboardMaterial(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: BILLBOARD_VERT,
    fragmentShader: frag,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------------------
// Pools retenidos
// ---------------------------------------------------------------------------

interface TimedFx {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t: number;
  life: number;
  active: boolean;
}

interface SpeedLine {
  x: number;
  y: number;
  dx: number;
  dy: number;
  len: number;
  speed: number;
  t: number;
  life: number;
  r: number;
  g: number;
  b: number;
}

interface FighterFx {
  aura: THREE.Mesh;
  auraMat: THREE.ShaderMaterial;
  auraAlpha: number;
  fury: boolean;
  stunned: boolean;
  /** ms de estela restante tras terminar el aturdimiento (desvanecido). */
  trailFade: number;
  /** ¿Tenía la carga al máximo el frame anterior? (destello único). */
  fullCharge: boolean;
  lastX: number;
  lastY: number;
}

const BURST_POOL = 16;
const RING_POOL = 16;
const MAX_LINES = 64;

const LIGHT_COLOR = new THREE.Color(0.45, 0.95, 1.0);
const HEAVY_COLOR = new THREE.Color(1.0, 0.62, 0.15);
const WHITE = new THREE.Color(1, 1, 1);

export class VfxSystem {
  readonly group = new THREE.Group();

  private readonly detector = createEventDetector();
  private readonly rng = createVisualRng(0x6b1b);
  private readonly pool: ParticlePool;
  private readonly particles: ParticleMesh;
  private readonly limiter: FlashLimiter = createFlashLimiter();

  private readonly quad = new THREE.PlaneGeometry(1, 1);
  private readonly bursts: TimedFx[] = [];
  private readonly rings: TimedFx[] = [];
  private readonly lines: SpeedLine[] = [];
  private readonly lineMesh: THREE.InstancedMesh;
  private readonly fighters: FighterFx[] = [];

  private quality: ResolvedQuality | null = null;
  private world: World | null = null;

  // Vibración de cámara.
  private shakeT = 0;
  private shakeLife = 0;
  private shakeAmp = 0;
  private readonly shakeOffset = new THREE.Vector3();

  /** Destello a pantalla completa (0..1) que dibuja el HUD; decae solo. */
  screenFlash = 0;
  screenFlashColor = "#ffffff";

  /** Hook opcional: destello de lente en golpes fuertes (lo da el postprocesado). */
  onHeavyImpact: ((x: number, y: number, z: number, color: THREE.Color) => void) | null = null;

  // Temporales reutilizables.
  private readonly m4 = new THREE.Matrix4();
  private readonly v3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly camQ = new THREE.Quaternion();
  private readonly col = new THREE.Color();

  constructor() {
    this.group.name = "vfx";
    this.pool = createParticlePool({ gravity: -260, drag: 1.4, capacity: 500 });
    this.particles = createParticleMesh(this.pool);
    this.particles.mesh.renderOrder = 20;
    this.group.add(this.particles.mesh);

    for (let i = 0; i < BURST_POOL; i++) {
      const mat = billboardMaterial(BURST_FRAG, {
        uProgress: { value: 0 },
        uColor: { value: new THREE.Color() },
        uSpikes: { value: 8 },
        uRot: { value: 0 },
        uIntensity: { value: 1.6 },
      });
      this.bursts.push(this.makeFx(mat, 22));
    }
    for (let i = 0; i < RING_POOL; i++) {
      const mat = billboardMaterial(RING_FRAG, {
        uProgress: { value: 0 },
        uColor: { value: new THREE.Color() },
        uIntensity: { value: 1.4 },
        uSeed: { value: 0 },
      });
      this.rings.push(this.makeFx(mat, 21));
    }

    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.lineMesh = new THREE.InstancedMesh(this.quad, lineMat, MAX_LINES);
    this.lineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_LINES; i++) this.lineMesh.setColorAt(i, this.col.setRGB(0, 0, 0));
    this.lineMesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.lineMesh.frustumCulled = false;
    this.lineMesh.count = 0;
    this.lineMesh.renderOrder = 22;
    this.group.add(this.lineMesh);
  }

  private makeFx(mat: THREE.ShaderMaterial, order: number): TimedFx {
    const mesh = new THREE.Mesh(this.quad, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    this.group.add(mesh);
    return { mesh, mat, t: 0, life: 1, active: false };
  }

  /** Aplica la calidad resuelta (capacidad del pool, recortes de Movimiento_Reducido). */
  applyQuality(q: ResolvedQuality): void {
    this.quality = q;
    this.pool.setCapacity(capacityForLevel(q.controls.particles));
    if (q.controls.speedLines === "desactivado") this.lines.length = 0;
    if (q.controls.cameraShake === "desactivado") this.shakeLife = 0;
  }

  /** Avanza los efectos. `dtMs` real de render; `camera` para orientar billboards. */
  update(world: World, alpha: number, dtMs: number, camera: THREE.Camera): void {
    const dt = Math.min(100, Math.max(0, dtMs));
    if (world !== this.world) {
      this.world = world;
      this.detector.reset();
      this.reset();
    }
    const q = this.quality;
    const particleF = q ? levelFactor(q.controls.particles) : 0.8;

    // 1) Eventos nuevos → efectos (primer frame tras el tick).
    const events = this.detector.detect(world.fighters);
    for (const e of events) this.handleEvent(world, e);

    // 2) Efectos continuos por combatiente.
    for (const f of world.fighters) {
      const fx = this.getFighterFx(f.index);
      const p = f.player;
      const visible = f.alive && !f.isDead;
      const cx = lerp(p.prevPos.x, p.pos.x, alpha) + p.width / 2;
      const cy = -(lerp(p.prevPos.y, p.pos.y, alpha) + p.height / 2);

      // Carga al máximo: fuera partículas, el luchador "brilla" (aura + destello
      // único al completarse; el tinte del modelo lo pone el renderer).
      const fullCharge = visible && p.charging && p.chargeRatio >= 1;
      if (fullCharge && !fx.fullCharge) {
        const c = this.col.copy(HEAVY_COLOR).lerp(WHITE, 0.4);
        this.spawnBurst(cx, cy, p.height * 1.6, c, 8, 160);
        this.spawnRing(cx, cy, p.height * 2.2, c, 320);
      }
      fx.fullCharge = fullCharge;

      // Aura de furia o de carga completa (fade in/out 250 ms).
      const target = visible && (p.furyActive || fullCharge) ? 1 : 0;
      const step = dt / 250;
      fx.auraAlpha = target > fx.auraAlpha ? Math.min(target, fx.auraAlpha + step) : Math.max(target, fx.auraAlpha - step);
      fx.aura.visible = fx.auraAlpha > 0.001;
      if (fx.aura.visible) {
        fx.aura.position.set(cx, cy + p.height * 0.08, -2);
        fx.aura.scale.set(p.width * 2.6, p.height * 1.9, 1);
        fx.aura.quaternion.copy(this.camQ);
        const now = performance.now() / 1000;
        const auraColor = fx.auraMat.uniforms.uColor.value as THREE.Color;
        if (fullCharge && !p.furyActive) {
          // Latido rápido en el color del golpe fuerte.
          fx.auraMat.uniforms.uAlpha.value = fx.auraAlpha * (0.75 + 0.25 * Math.sin(now * 18));
          auraColor.copy(HEAVY_COLOR).lerp(WHITE, 0.25);
        } else {
          fx.auraMat.uniforms.uAlpha.value = fx.auraAlpha;
          auraColor.set(f.color).lerp(HEAVY_COLOR, 0.35);
        }
        fx.auraMat.uniforms.uTime.value = now;
      }

      if (!visible) {
        fx.stunned = false;
        fx.trailFade = 0;
        continue;
      }

      // Estela mientras está aturdido (y 250 ms de desvanecido al terminar).
      if (p.stunned) fx.trailFade = 250;
      else fx.trailFade = Math.max(0, fx.trailFade - dt);
      if (fx.trailFade > 0 && particleF > 0) {
        const moved = Math.hypot(cx - fx.lastX, cy - fx.lastY);
        const n = Math.min(6, Math.ceil((moved / 10) * particleF));
        const fade = fx.trailFade / 250;
        const c = this.col.set(f.color);
        const lx = fx.lastX;
        const ly = fx.lastY;
        this.pool.spawn(n, (i, o) => {
          const t = n > 1 ? i / (n - 1) : 1;
          o.x = lx + (cx - lx) * t + (this.rng() - 0.5) * p.width * 0.4;
          o.y = ly + (cy - ly) * t + (this.rng() - 0.5) * p.height * 0.4;
          o.z = -1;
          o.vx = (this.rng() - 0.5) * 30;
          o.vy = (this.rng() - 0.5) * 30 + 120;
          o.lifeMs = 260 + this.rng() * 200;
          o.size = (10 + this.rng() * 10) * fade;
          o.r = c.r * 1.4;
          o.g = c.g * 1.4;
          o.b = c.b * 1.4;
        });
      }
      fx.lastX = cx;
      fx.lastY = cy;

      // Partículas de carga que convergen hacia el luchador.
      if (p.charging && !fullCharge && particleF > 0) {
        const n = chargeEmission(p.chargeRatio, particleF);
        const ratio = p.chargeRatio;
        const hot = this.col.copy(HEAVY_COLOR).lerp(WHITE, ratio * 0.5);
        this.pool.spawn(n, (_i, o) => {
          const a = this.rng() * Math.PI * 2;
          const d = 50 + this.rng() * 40;
          o.x = cx + Math.cos(a) * d;
          o.y = cy + Math.sin(a) * d;
          o.z = 4;
          o.vx = -Math.cos(a) * d * 3.2;
          o.vy = -Math.sin(a) * d * 3.2 + 260; // compensa la gravedad del pool
          o.lifeMs = 280;
          o.size = 5 + ratio * 9;
          const b = 1.2 + ratio * 1.6;
          o.r = hot.r * b;
          o.g = hot.g * b;
          o.b = hot.b * b;
        });
      }
    }

    // 3) Integración de pools.
    this.pool.update(dt);
    camera.getWorldQuaternion(this.camQ);
    this.particles.sync(this.pool, camera);
    this.updateTimed(this.bursts, dt);
    this.updateTimed(this.rings, dt);
    this.updateLines(dt);

    // 4) Vibración y destello de pantalla.
    this.shakeT += dt;
    this.screenFlash = Math.max(0, this.screenFlash - dt / 180);
  }

  /** Desplazamiento de vibración de cámara de este frame (escena). */
  shake(): THREE.Vector3 {
    const o = this.shakeOffset.set(0, 0, 0);
    if (this.shakeLife <= 0 || this.shakeT >= this.shakeLife) return o;
    const k = 1 - this.shakeT / this.shakeLife;
    const amp = this.shakeAmp * k * k;
    const t = this.shakeT / 1000;
    o.set(Math.sin(t * 91.0 + 1.3) * amp, Math.sin(t * 73.0 + 0.7) * amp * 0.8, 0);
    return o;
  }

  reset(): void {
    this.pool.clear();
    for (const b of this.bursts) this.deactivate(b);
    for (const r of this.rings) this.deactivate(r);
    this.lines.length = 0;
    this.lineMesh.count = 0;
    this.shakeLife = 0;
    this.screenFlash = 0;
    this.limiter.reset();
    for (const f of this.fighters) {
      f.auraAlpha = 0;
      f.aura.visible = false;
      f.trailFade = 0;
    }
  }

  dispose(): void {
    this.particles.dispose();
    this.quad.dispose();
    for (const b of [...this.bursts, ...this.rings]) b.mat.dispose();
    for (const f of this.fighters) f.auraMat.dispose();
    (this.lineMesh.material as THREE.Material).dispose();
    this.lineMesh.dispose();
  }

  // -------------------------------------------------------------------------

  private handleEvent(world: World, e: VisualEvent): void {
    const q = this.quality;
    const flashF = q ? levelFactor(q.controls.flashes) : 0.8;
    const particleF = q ? levelFactor(q.controls.particles) : 0.8;
    const lineF = q ? levelFactor(q.controls.speedLines) : 0.8;
    const shakeF = q ? levelFactor(q.controls.cameraShake) : 0.8;
    const reduced = q?.reducedMotion ?? false;
    const now = performance.now();

    if (e.type === "hit" || e.type === "heavyHit") {
      const heavy = e.type === "heavyHit";
      const k = heavy ? e.knockbackFactor : 0;
      const I = impactIntensity(heavy, k);
      const sx = e.x;
      const sy = -e.y;
      const attacker = world.fighters.find((f) => f.index === e.attacker);
      const accent = this.col.set(attacker?.color ?? "#ffffff");
      const base = heavy ? HEAVY_COLOR : LIGHT_COLOR;
      const size = 90 * I.scale;

      // Destello en estrella (aunque los destellos estén al mínimo, el par
      // destello/onda siempre se genera, R8.1; el control escala su tamaño).
      const fs = Math.max(0.45, flashF);
      this.spawnBurst(sx, sy, size * fs, base, heavy ? 10 : 7, heavy ? 150 : 110);
      this.spawnRing(sx, sy, size * 1.5 * fs, accent.clone().lerp(base, 0.5), heavy ? 400 : 280);

      // Chispas.
      const sparks = Math.round((heavy ? 22 : 9) * particleF);
      const dirX = heavy ? e.dirX : 0;
      const dirY = heavy ? -e.dirY : 0;
      this.pool.spawn(sparks, (_i, o) => {
        const a = this.rng() * Math.PI * 2;
        const sp = (heavy ? 380 : 220) * (0.4 + this.rng());
        o.x = sx;
        o.y = sy;
        o.z = 6;
        o.vx = Math.cos(a) * sp + dirX * 260;
        o.vy = Math.sin(a) * sp + dirY * 260 + 80;
        o.lifeMs = 220 + this.rng() * 260;
        o.size = 5 + this.rng() * (heavy ? 9 : 5);
        o.r = base.r * 2;
        o.g = base.g * 2;
        o.b = base.b * 2;
      });

      if (heavy) {
        if (lineF > 0) this.spawnSpeedLines(sx, sy, e.dirX, -e.dirY, Math.round(I.speedLines * lineF), base);
        if (shakeF > 0 && !reduced) {
          this.shakeT = 0;
          this.shakeLife = Math.max(this.shakeLife - this.shakeT, I.shakeMs);
          this.shakeAmp = Math.max(this.shakeAmp * 0.5, I.shakeAmp * shakeF);
        }
        if (q?.impactLensFlares !== false) this.onHeavyImpact?.(sx, sy, 12, base);
        // Destello de pantalla en golpes muy fuertes (cubre la pantalla ⇒ limitado).
        if (k > 0.6 && flashF > 0 && this.limiter.tryFlash(now, 1, reduced)) {
          this.screenFlash = Math.max(this.screenFlash, 0.25 * flashF * k);
          this.screenFlashColor = "#fff4d6";
        }
      }
      return;
    }

    if (e.type === "ko") {
      const f = world.fighters.find((ff) => ff.index === e.player);
      const color = new THREE.Color(f?.color ?? "#ffffff");
      const inward = inwardDir(e.edge);
      const sx = e.x;
      const sy = -e.y;
      this.spawnBurst(sx, sy, 260, color, 12, 400);
      this.spawnRing(sx, sy, 420, color, 700);
      this.spawnRing(sx, sy, 260, new THREE.Color(1, 1, 1), 500);
      if (lineF > 0) this.spawnSpeedLines(sx, sy, inward.x, -inward.y, Math.round(28 * lineF), color, 1.8);
      const n = Math.round(60 * particleF);
      this.pool.spawn(n, (_i, o) => {
        const spread = (this.rng() - 0.5) * 1.6;
        const sp = 400 + this.rng() * 700;
        const ax = inward.x + (inward.x === 0 ? spread : spread * 0.3);
        const ay = -inward.y + (inward.y === 0 ? spread : spread * 0.3);
        o.x = sx;
        o.y = sy;
        o.z = 8;
        o.vx = ax * sp;
        o.vy = ay * sp;
        o.lifeMs = 500 + this.rng() * 700;
        o.size = 8 + this.rng() * 14;
        o.r = color.r * 2.2;
        o.g = color.g * 2.2;
        o.b = color.b * 2.2;
      });
      if (shakeF > 0 && !reduced) {
        this.shakeT = 0;
        this.shakeLife = 450;
        this.shakeAmp = 16 * shakeF;
      }
      if (flashF > 0 && this.limiter.tryFlash(now, 1, reduced)) {
        this.screenFlash = 0.45 * flashF;
        this.screenFlashColor = f?.color ?? "#ffffff";
      }
      return;
    }

    if (e.type === "fury" && e.active) {
      const f = world.fighters.find((ff) => ff.index === e.player);
      if (!f) return;
      const p = f.player;
      const sx = p.pos.x + p.width / 2;
      const sy = -(p.pos.y + p.height / 2);
      this.spawnRing(sx, sy, 260, HEAVY_COLOR, 500);
    }
  }

  private spawnBurst(x: number, y: number, size: number, color: THREE.Color, spikes: number, lifeMs: number): void {
    const fx = this.take(this.bursts);
    fx.mesh.position.set(x, y, 10);
    fx.mesh.scale.set(size, size, 1);
    (fx.mat.uniforms.uColor.value as THREE.Color).copy(color);
    fx.mat.uniforms.uSpikes.value = spikes;
    fx.mat.uniforms.uRot.value = this.rng() * Math.PI;
    fx.life = lifeMs;
  }

  private spawnRing(x: number, y: number, size: number, color: THREE.Color, lifeMs: number): void {
    const fx = this.take(this.rings);
    fx.mesh.position.set(x, y, 9);
    fx.mesh.scale.set(size, size, 1);
    (fx.mat.uniforms.uColor.value as THREE.Color).copy(color);
    fx.mat.uniforms.uSeed.value = this.rng() * 10;
    fx.life = lifeMs;
  }

  /** Toma un slot libre o, si no hay, el más avanzado (más viejo). */
  private take(list: TimedFx[]): TimedFx {
    let pick = list[0];
    for (const fx of list) {
      if (!fx.active) {
        pick = fx;
        break;
      }
      if (fx.t / fx.life > pick.t / pick.life) pick = fx;
    }
    pick.active = true;
    pick.t = 0;
    pick.mesh.visible = true;
    pick.mat.uniforms.uProgress.value = 0;
    return pick;
  }

  private deactivate(fx: TimedFx): void {
    fx.active = false;
    fx.mesh.visible = false;
  }

  private updateTimed(list: TimedFx[], dt: number): void {
    for (const fx of list) {
      if (!fx.active) continue;
      fx.t += dt;
      const p = fx.t / fx.life;
      if (p >= 1) {
        this.deactivate(fx);
        continue;
      }
      fx.mat.uniforms.uProgress.value = p;
      fx.mesh.quaternion.copy(this.camQ);
    }
  }

  private spawnSpeedLines(
    x: number,
    y: number,
    dx: number,
    dy: number,
    n: number,
    color: THREE.Color,
    lenMul = 1,
  ): void {
    const len0 = Math.hypot(dx, dy);
    const ux = len0 > 0 ? dx / len0 : 1;
    const uy = len0 > 0 ? dy / len0 : 0;
    for (let i = 0; i < n; i++) {
      if (this.lines.length >= MAX_LINES) this.lines.shift();
      const spread = (this.rng() - 0.5) * 0.7;
      const cs = Math.cos(spread);
      const sn = Math.sin(spread);
      const lx = ux * cs - uy * sn;
      const ly = ux * sn + uy * cs;
      const off = (this.rng() - 0.5) * 140;
      this.lines.push({
        x: x - ly * off - lx * (this.rng() * 60),
        y: y + lx * off - ly * (this.rng() * 60),
        dx: lx,
        dy: ly,
        len: (80 + this.rng() * 160) * lenMul,
        speed: 900 + this.rng() * 900,
        t: 0,
        life: 220 + this.rng() * 160,
        r: color.r * 1.8,
        g: color.g * 1.8,
        b: color.b * 1.8,
      });
    }
  }

  private updateLines(dt: number): void {
    let n = 0;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.t += dt;
      if (l.t >= l.life) this.lines.splice(i, 1);
    }
    for (const l of this.lines) {
      const p = l.t / l.life;
      const travel = (l.speed * l.t) / 1000;
      const cx = l.x + l.dx * (travel + l.len / 2);
      const cy = l.y + l.dy * (travel + l.len / 2);
      const thick = 4 * (1 - p) + 1;
      this.v3.set(cx, cy, 11);
      this.q.setFromAxisAngle(Z_AXIS, Math.atan2(l.dy, l.dx));
      this.s3.set(l.len * (1 - p * 0.5), thick, 1);
      this.m4.compose(this.v3, this.q, this.s3);
      this.lineMesh.setMatrixAt(n, this.m4);
      const f = 1 - p;
      this.lineMesh.setColorAt(n, this.col.setRGB(l.r * f, l.g * f, l.b * f));
      n++;
    }
    this.lineMesh.count = n;
    this.lineMesh.instanceMatrix.needsUpdate = true;
    this.lineMesh.instanceColor!.needsUpdate = true;
  }

  private getFighterFx(index: number): FighterFx {
    const existing = this.fighters[index];
    if (existing) return existing;
    const auraMat = billboardMaterial(AURA_FRAG, {
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uColor: { value: new THREE.Color() },
    });
    const aura = new THREE.Mesh(this.quad, auraMat);
    aura.visible = false;
    aura.frustumCulled = false;
    aura.renderOrder = 5;
    this.group.add(aura);
    const fx: FighterFx = {
      aura,
      auraMat,
      auraAlpha: 0,
      fury: false,
      stunned: false,
      trailFade: 0,
      fullCharge: false,
      lastX: 0,
      lastY: 0,
    };
    this.fighters[index] = fx;
    return fx;
  }
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
