/**
 * Sistema_Escenarios (R10): cielo, capas lejanas, props animados, primer plano
 * y luces intensas de cada escenario. Sustituye al antiguo `Background3D`.
 *
 * - Todo lo que está detrás del plano de combate (z < FAR_Z) va a la capa
 *   `FAR_LAYER`, que es la que desenfoca la profundidad de campo (R7.4).
 * - Las animaciones se derivan SOLO del tiempo de render (R10.6) a través de
 *   `PropController`, que también decide cuántas se animan por nivel (R10.5)
 *   y aplica Movimiento_Reducido (R10.9).
 * - Si algo falla al construir un prop, se omite ese prop y el escenario sigue
 *   (R10.8); las plataformas las dibuja el renderer aparte.
 */
import * as THREE from "three";
import type { Camera } from "../camera.ts";
import type { StageId } from "../../engine/game/stages.ts";
import type { Level } from "../quality/visualPrefs.ts";
import { FAR_LAYER } from "../post/postPipeline.ts";
import { PropController, edgeFade, hash01, type AnimatedPropDef, type PropHandle, type PropPose } from "./animatedProps.ts";
import { SKY_PLANE_Z, getStageVisual, paintLayer, type StageVisualDef } from "./stageDefs.ts";

/** Objetos con z por debajo de esto se consideran "fondo lejano". */
const FAR_Z = -1000;

// ---------------------------------------------------------------------------
// Recursos compartidos (creados una vez)
// ---------------------------------------------------------------------------

let glowTex: THREE.Texture | null = null;
let beamTex: THREE.Texture | null = null;
let birdTex: THREE.Texture | null = null;

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (ctx) draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function getGlowTex(): THREE.Texture {
  if (!glowTex) {
    glowTex = canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,0.5)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    });
  }
  return glowTex;
}

function getBeamTex(): THREE.Texture {
  if (!beamTex) {
    beamTex = canvasTexture(32, 128, (ctx) => {
      const v = ctx.createLinearGradient(0, 0, 0, 128);
      v.addColorStop(0, "rgba(255,255,255,0.9)");
      v.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, 32, 128);
      const hz = ctx.createLinearGradient(0, 0, 32, 0);
      hz.addColorStop(0, "rgba(0,0,0,1)");
      hz.addColorStop(0.5, "rgba(0,0,0,0)");
      hz.addColorStop(1, "rgba(0,0,0,1)");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = hz;
      ctx.fillRect(0, 0, 32, 128);
    });
  }
  return beamTex;
}

function getBirdTex(): THREE.Texture {
  if (!birdTex) {
    birdTex = canvasTexture(64, 32, (ctx) => {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(4, 8);
      ctx.quadraticCurveTo(20, 6, 32, 22);
      ctx.quadraticCurveTo(44, 6, 60, 8);
      ctx.stroke();
    });
  }
  return birdTex;
}

const QUAD = new THREE.PlaneGeometry(1, 1);

function additive(color: THREE.ColorRepresentation, map: THREE.Texture | null, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
}

// ---------------------------------------------------------------------------
// Cielo (shader)
// ---------------------------------------------------------------------------

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform float uHorizonY;
uniform float uStars;
uniform vec3 uSunColor;
uniform vec3 uSun; // x, y, radio
uniform float uTime;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float h = clamp((vWorld.y - uHorizonY) / 4200.0, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.35, h));
  col = mix(col, uTop, smoothstep(0.3, 1.0, h));
  // Estrellas (más arriba, con parpadeo suave).
  if (uStars > 0.0) {
    vec2 cell = floor(vWorld.xy / 22.0);
    float s = hash(cell);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + s * 3.0) + s * 40.0);
    float star = step(1.0 - 0.012 * uStars, s) * smoothstep(0.15, 0.6, h) * tw;
    col += vec3(star) * 1.4;
  }
  // Astro con halo.
  if (uSun.z > 0.0) {
    float d = distance(vWorld.xy, uSun.xy) / uSun.z;
    col += uSunColor * (smoothstep(1.0, 0.92, d) * 1.6 + exp(-d * d * 0.35) * 0.55);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BuiltProp {
  obj: THREE.Object3D;
  handle: PropHandle;
  dispose(): void;
}

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpC = new THREE.Color();
const ZAX = new THREE.Vector3(0, 0, 1);

function fract(v: number): number {
  return v - Math.floor(v);
}

/** InstancedMesh de quads (aditivos) que se mueven según la pose. */
function instancedQuads(
  def: AnimatedPropDef,
  map: THREE.Texture | null,
  layout: (i: number, u: number, pose: PropPose, out: { x: number; y: number; w: number; h: number; rot: number; fade: number }) => void,
): BuiltProp {
  const n = Math.max(1, def.count ?? 10);
  const mat = additive(0xffffff, map);
  const mesh = new THREE.InstancedMesh(QUAD, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const base = new THREE.Color(def.color);
  const acc = new THREE.Color(def.accent ?? def.color);
  for (let i = 0; i < n; i++) mesh.setColorAt(i, base);
  const o = { x: 0, y: 0, w: 1, h: 1, rot: 0, fade: 1 };
  let visible = true;
  return {
    obj: mesh,
    handle: {
      setVisible(v) {
        visible = v;
        mesh.visible = v;
      },
      apply(pose) {
        if (!visible) return;
        for (let i = 0; i < n; i++) {
          const u = fract(pose.scroll + hash01(def.seed, i));
          o.rot = 0;
          o.fade = 1;
          layout(i, u, pose, o);
          tmpP.set(o.x, o.y, 0);
          tmpQ.setFromAxisAngle(ZAX, o.rot);
          tmpS.set(o.w, o.h, 1);
          tmpM.compose(tmpP, tmpQ, tmpS);
          mesh.setMatrixAt(i, tmpM);
          const c = i % 3 === 2 ? acc : base;
          mesh.setColorAt(i, tmpC.copy(c).multiplyScalar(o.fade * pose.intensity));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      },
    },
    dispose() {
      mat.dispose();
      mesh.dispose();
    },
  };
}

/** Grupo de mallas con una función de actualización libre. */
function meshGroup(build: (g: THREE.Group) => (pose: PropPose) => void, dispose: () => void): BuiltProp {
  const g = new THREE.Group();
  const apply = build(g);
  return {
    obj: g,
    handle: {
      setVisible(v) {
        g.visible = v;
      },
      apply,
    },
    dispose,
  };
}

/** Plano con shader de desplazamiento (cascada, aurora, olas). */
function scrollShader(def: AnimatedPropDef, frag: string): BuiltProp {
  const mat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: frag,
    uniforms: {
      uScroll: { value: 0 },
      uAmp: { value: 1 },
      uColor: { value: new THREE.Color(def.color) },
      uAccent: { value: new THREE.Color(def.accent ?? def.color) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(QUAD, mat);
  mesh.scale.set(def.area.w, def.area.h, 1);
  mesh.frustumCulled = false;
  return {
    obj: mesh,
    handle: {
      setVisible(v) {
        mesh.visible = v;
      },
      apply(pose) {
        mat.uniforms.uScroll.value = pose.scroll;
        mat.uniforms.uAmp.value = pose.amp;
      },
    },
    dispose() {
      mat.dispose();
    },
  };
}

const WATERFALL_FRAG = /* glsl */ `
uniform float uScroll; uniform vec3 uColor; varying vec2 vUv;
void main(){
  float x = abs(vUv.x - 0.5) * 2.0;
  float body = smoothstep(1.0, 0.6, x);
  float streak = 0.5 + 0.5 * sin((vUv.y + uScroll) * 40.0 + sin(vUv.x * 25.0) * 3.0);
  float foam = smoothstep(0.12, 0.0, vUv.y) * 1.5;
  float a = body * (0.25 + 0.45 * streak) + foam * body;
  gl_FragColor = vec4(uColor * a * 1.2, a);
}`;

const AURORA_FRAG = /* glsl */ `
uniform float uScroll; uniform float uAmp; uniform vec3 uColor; uniform vec3 uAccent; varying vec2 vUv;
void main(){
  float t = uScroll * 6.2831853;
  float wave = sin(vUv.x * 9.0 + t) * 0.12 * (uAmp / 60.0) + sin(vUv.x * 23.0 - t * 2.0) * 0.04;
  float band = exp(-pow((vUv.y - 0.5 - wave) * 7.0, 2.0));
  float curtain = 0.6 + 0.4 * sin(vUv.x * 60.0 + t * 3.0);
  vec3 col = mix(uColor, uAccent, vUv.y);
  float a = band * curtain * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x) * 0.75;
  gl_FragColor = vec4(col * a * 1.3, a);
}`;

const WAVES_FRAG = /* glsl */ `
uniform float uScroll; uniform vec3 uColor; varying vec2 vUv;
void main(){
  float t = uScroll * 6.2831853;
  float w = sin(vUv.x * 80.0 + t) * 0.5 + sin(vUv.x * 33.0 - t * 2.0) * 0.5;
  float line = smoothstep(0.08, 0.0, abs(fract(vUv.y * 6.0 + w * 0.08) - 0.5));
  float a = line * vUv.y * 0.6;
  gl_FragColor = vec4(uColor * a * 1.4, a);
}`;

function buildProp(def: AnimatedPropDef): BuiltProp {
  const A = def.area;
  const left = A.x - A.w / 2;
  const top = A.y + A.h / 2;

  switch (def.visual) {
    // ---------- Partículas y viajeros (instanced) -----------------------
    case "hoverTraffic":
      return instancedQuads(def, getGlowTex(), (i, u, pose, o) => {
        const lane = i % 4;
        const dir = lane % 2 === 0 ? 1 : -1;
        o.x = dir > 0 ? left + u * A.w : left + (1 - u) * A.w;
        o.y = A.y - A.h / 2 + (lane / 3) * A.h + pose.y;
        o.w = 70;
        o.h = 18;
        o.fade = edgeFade(u);
      });
    case "rain":
      return instancedQuads(def, getBeamTex(), (i, u, _pose, o) => {
        o.x = left + hash01(def.seed + 1, i) * A.w + u * 120;
        o.y = top - u * A.h;
        o.w = 2;
        o.h = 60;
        o.rot = 0.18;
        o.fade = 0.35;
      });
    case "pollen":
    case "dust":
      return instancedQuads(def, getGlowTex(), (i, u, pose, o) => {
        o.x = left + hash01(def.seed + 3, i) * A.w + Math.sin(u * 6.283 * 2 + i) * pose.amp;
        o.y = A.y - A.h / 2 + u * A.h; // suben lentamente
        o.w = o.h = 6 + hash01(def.seed + 5, i) * 8;
        o.fade = edgeFade(u) * 0.8;
      });
    case "lanterns":
      return instancedQuads(def, getGlowTex(), (i, u, pose, o) => {
        o.x = left + hash01(def.seed + 7, i) * A.w + Math.sin(u * 6.283 + i) * pose.amp;
        o.y = A.y - A.h / 2 + u * A.h;
        o.w = 26;
        o.h = 34;
        o.fade = edgeFade(u);
      });
    case "birds":
      return instancedQuads(def, getBirdTex(), (i, u, pose, o) => {
        o.x = left + u * A.w + (i % 3) * 40;
        o.y = A.y + Math.floor(i / 3) * 30 - (i % 3) * 14 + pose.y;
        const flap = 0.6 + 0.4 * Math.sin(u * 200 + i);
        o.w = 34;
        o.h = 14 * flap;
        o.fade = edgeFade(u) * 0.9;
      });
    case "grass":
      return instancedQuads(def, getBeamTex(), (i, _u, pose, o) => {
        const k = hash01(def.seed, i);
        o.x = left + (i / Math.max(1, (def.count ?? 1) - 1)) * A.w + (k - 0.5) * 40;
        o.h = 30 + k * 40;
        o.w = 6;
        o.y = A.y + o.h / 2;
        o.rot = pose.rot * (0.6 + k * 0.8) + Math.PI;
        o.fade = 0.35;
      });

    // ---------- Mallas sueltas ------------------------------------------
    case "billboards": {
      const n = def.count ?? 4;
      const mats: THREE.MeshBasicMaterial[] = [];
      return meshGroup(
        (g) => {
          for (let i = 0; i < n; i++) {
            const m = additive(i % 2 ? def.accent ?? def.color : def.color, null, 0.85);
            mats.push(m);
            const p = new THREE.Mesh(QUAD, m);
            p.position.set(left + (i + 0.5) * (A.w / n) + (hash01(def.seed, i) - 0.5) * 200, A.y + (hash01(def.seed + 1, i) - 0.5) * A.h, 0);
            p.scale.set(120 + hash01(def.seed + 2, i) * 120, 50 + hash01(def.seed + 3, i) * 60, 1);
            g.add(p);
          }
          return (pose) => mats.forEach((m, i) => (m.opacity = 0.85 * (i % 2 ? 1 : pose.intensity)));
        },
        () => mats.forEach((m) => m.dispose()),
      );
    }
    case "hologram": {
      const geo = new THREE.IcosahedronGeometry(90, 1);
      const mat = new THREE.MeshBasicMaterial({ color: def.color, wireframe: true, transparent: true, opacity: 0.7, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.TorusGeometry(140, 2, 6, 48);
      return meshGroup(
        (g) => {
          const ico = new THREE.Mesh(geo, mat);
          const r = new THREE.Mesh(ring, mat);
          r.rotation.x = Math.PI / 2.4;
          g.add(ico, r);
          g.position.set(A.x, A.y, 0);
          return (pose) => {
            ico.rotation.set(pose.rot * 0.5, pose.rot, 0);
            r.rotation.z = -pose.rot;
            g.position.y = A.y + pose.y;
          };
        },
        () => {
          geo.dispose();
          ring.dispose();
          mat.dispose();
        },
      );
    }
    case "searchlights":
    case "spotlights":
    case "sunRays":
    case "lightShafts": {
      const n = def.count ?? 3;
      const mats: THREE.MeshBasicMaterial[] = [];
      const isRays = def.visual === "sunRays";
      return meshGroup(
        (g) => {
          const pivots: THREE.Group[] = [];
          for (let i = 0; i < n; i++) {
            const m = additive(def.color, getBeamTex(), def.visual === "searchlights" ? 0.22 : 0.3);
            mats.push(m);
            const pivot = new THREE.Group();
            const beam = new THREE.Mesh(QUAD, m);
            const len = isRays ? 2400 : def.visual === "lightShafts" ? A.h : 1800;
            const wid = isRays ? 160 : def.visual === "lightShafts" ? 220 : 160;
            beam.scale.set(wid, len, 1);
            // La textura es brillante arriba: el haz sale del pivote.
            beam.position.y = -len / 2;
            pivot.add(beam);
            if (isRays) {
              pivot.position.set(A.x, A.y, 0);
              pivot.rotation.z = (i / n) * Math.PI * 2;
            } else if (def.visual === "lightShafts") {
              pivot.position.set(left + (i + 0.5) * (A.w / n), top, 0);
              pivot.rotation.z = 0.25;
            } else if (def.visual === "spotlights") {
              pivot.position.set(left + (i + 0.5) * (A.w / n), A.y, 0);
            } else {
              pivot.position.set(left + (i + 0.5) * (A.w / n), A.y, 0);
              pivot.rotation.z = Math.PI; // apuntan hacia arriba
            }
            pivots.push(pivot);
            g.add(pivot);
          }
          return (pose) => {
            pivots.forEach((p, i) => {
              if (def.visual === "searchlights") p.rotation.z = Math.PI + pose.rot * (i % 2 ? -1 : 1) + (i - 1) * 0.3;
              else if (isRays) p.rotation.z = (i / n) * Math.PI * 2 + pose.scroll * 0.6;
            });
            mats.forEach((m, i) => {
              const base = def.visual === "searchlights" ? 0.22 : 0.3;
              m.opacity = base * (isRays || def.visual !== "searchlights" ? (i % 2 ? pose.intensity : 1 - (1 - pose.intensity) * 0.5) : 1);
            });
          };
        },
        () => mats.forEach((m) => m.dispose()),
      );
    }
    case "dirigible":
    case "drone": {
      const isBlimp = def.visual === "dirigible";
      const geo = isBlimp ? new THREE.SphereGeometry(1, 16, 10) : new THREE.OctahedronGeometry(1, 0);
      const body = new THREE.MeshBasicMaterial({ color: def.color, fog: false });
      const glow = additive(def.accent ?? def.color, getGlowTex(), 0.9);
      return meshGroup(
        (g) => {
          const b = new THREE.Mesh(geo, body);
          b.scale.set(isBlimp ? 420 : 26, isBlimp ? 110 : 18, isBlimp ? 110 : 26);
          const l = new THREE.Mesh(QUAD, glow);
          l.scale.set(isBlimp ? 380 : 90, isBlimp ? 40 : 90, 1);
          l.position.z = isBlimp ? 112 : 1;
          g.add(b, l);
          return (pose) => {
            g.position.x = left + pose.scroll * A.w;
            g.position.y = A.y + pose.y;
            g.visible = pose.opacity > 0.02 || !isBlimp;
            glow.opacity = 0.9 * pose.opacity;
            if (!isBlimp) b.rotation.y = pose.scroll * 40;
          };
        },
        () => {
          geo.dispose();
          body.dispose();
          glow.dispose();
        },
      );
    }
    case "clouds": {
      const n = def.count ?? 6;
      const mats: THREE.MeshBasicMaterial[] = [];
      return meshGroup(
        (g) => {
          const items: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; off: number; y: number }[] = [];
          for (let i = 0; i < n; i++) {
            const mat = new THREE.MeshBasicMaterial({ color: def.color, map: getGlowTex(), transparent: true, opacity: 0.7, depthWrite: false, fog: false });
            mats.push(mat);
            const m = new THREE.Mesh(QUAD, mat);
            m.scale.set(700 + hash01(def.seed, i) * 600, 160 + hash01(def.seed + 1, i) * 120, 1);
            g.add(m);
            items.push({ m, mat, off: hash01(def.seed + 2, i), y: A.y + (hash01(def.seed + 3, i) - 0.5) * A.h });
          }
          return (pose) => {
            for (const it of items) {
              const u = fract(pose.scroll + it.off);
              it.m.position.set(left + u * A.w, it.y + pose.y, 0);
              it.mat.opacity = 0.7 * edgeFade(u);
            }
          };
        },
        () => mats.forEach((m) => m.dispose()),
      );
    }
    case "crystals":
    case "driftIslands":
    case "dataPanels": {
      const n = def.count ?? 5;
      const isCrystal = def.visual === "crystals";
      const isIsland = def.visual === "driftIslands";
      const geo = isCrystal ? new THREE.OctahedronGeometry(1, 0) : isIsland ? new THREE.DodecahedronGeometry(1, 0) : QUAD;
      const mat = isCrystal
        ? new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 1.2, roughness: 0.15, metalness: 0.3, flatShading: true, transparent: true, opacity: 0.9 })
        : isIsland
          ? new THREE.MeshBasicMaterial({ color: def.color, fog: false })
          : additive(def.color, null, 0.35);
      const rimMat = additive(def.accent ?? def.color, getGlowTex(), 0.8);
      return meshGroup(
        (g) => {
          const items: { o: THREE.Object3D; y: number; ph: number }[] = [];
          for (let i = 0; i < n; i++) {
            const o = new THREE.Group();
            const m = new THREE.Mesh(geo, mat);
            const s = isCrystal ? 30 + hash01(def.seed, i) * 40 : isIsland ? 140 + hash01(def.seed, i) * 140 : 0;
            if (isCrystal) m.scale.set(s * 0.6, s * 1.4, s * 0.6);
            else if (isIsland) m.scale.set(s, s * 0.45, s * 0.7);
            else m.scale.set(180 + hash01(def.seed, i) * 100, 100 + hash01(def.seed + 1, i) * 50, 1);
            o.add(m);
            if (isIsland || isCrystal) {
              const r = new THREE.Mesh(QUAD, rimMat);
              r.scale.set(isIsland ? s * 2.2 : s * 2, isIsland ? 40 : s * 2.4, 1);
              r.position.set(0, isIsland ? s * 0.4 : 0, isIsland ? 0 : -5);
              o.add(r);
            }
            o.position.set(left + (i + 0.5) * (A.w / n) + (hash01(def.seed + 4, i) - 0.5) * 200, A.y + (hash01(def.seed + 5, i) - 0.5) * A.h, (hash01(def.seed + 6, i) - 0.5) * 200);
            g.add(o);
            items.push({ o, y: o.position.y, ph: hash01(def.seed + 7, i) * Math.PI * 2 });
          }
          return (pose) => {
            for (const it of items) {
              const k = Math.sin(pose.scroll * Math.PI * 2 + it.ph);
              it.o.position.y = it.y + k * pose.amp;
              if (isCrystal) it.o.rotation.y = pose.scroll * Math.PI * 2 + it.ph;
            }
          };
        },
        () => {
          if (geo !== QUAD) geo.dispose();
          mat.dispose();
          rimMat.dispose();
        },
      );
    }
    case "scanLine": {
      const mat = additive(def.color, getBeamTex(), 0.5);
      return meshGroup(
        (g) => {
          const m = new THREE.Mesh(QUAD, mat);
          m.scale.set(A.w, 60, 1);
          g.add(m);
          return (pose) => {
            m.position.set(A.x, top - pose.scroll * A.h, 0);
            mat.opacity = 0.5 * pose.opacity;
          };
        },
        () => mat.dispose(),
      );
    }
    case "scoreboard": {
      const tex = canvasTexture(512, 128, (ctx) => {
        ctx.fillStyle = "rgba(10,30,70,0.6)";
        ctx.fillRect(0, 0, 512, 128);
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, 504, 120);
        ctx.fillStyle = def.color;
        ctx.font = "italic 900 64px 'Russo One', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("KIROBRAWL", 256, 68);
      });
      const mat = additive(0xffffff, tex, 0.9);
      return meshGroup(
        (g) => {
          const m = new THREE.Mesh(QUAD, mat);
          m.scale.set(640, 160, 1);
          m.position.set(A.x, A.y, 0);
          g.add(m);
          return (pose) => (mat.opacity = 0.9 * pose.intensity);
        },
        () => {
          tex.dispose();
          mat.dispose();
        },
      );
    }
    case "waterfall":
      return scrollShader(def, WATERFALL_FRAG);
    case "aurora":
      return scrollShader(def, AURORA_FRAG);
    case "seaWaves":
      return scrollShader(def, WAVES_FRAG);
  }
}

function positionProp(p: BuiltProp, def: AnimatedPropDef): void {
  // Las mallas de los builders usan coords de escena absolutas en x/y; la z
  // del prop se aplica aquí. Los scrollShader se centran en el área.
  if (def.visual === "waterfall" || def.visual === "aurora" || def.visual === "seaWaves") {
    p.obj.position.set(def.area.x, def.area.y, def.z);
  } else {
    p.obj.position.z = def.z;
  }
  p.obj.renderOrder = def.z < FAR_Z ? -8 : def.z > 0 ? 30 : -2;
}

function setLayerDeep(obj: THREE.Object3D, layer: number): void {
  obj.traverse((o) => o.layers.set(layer));
}

// ---------------------------------------------------------------------------
// StageScene
// ---------------------------------------------------------------------------

export class StageScene {
  readonly group = new THREE.Group();
  private def: StageVisualDef | null = null;
  private stageId: StageId | null = null;
  private sky: THREE.Mesh | null = null;
  private skyMat: THREE.ShaderMaterial | null = null;
  private layers: { mesh: THREE.Mesh; parallax: number; tex: THREE.Texture; mat: THREE.Material }[] = [];
  private props: BuiltProp[] = [];
  private controller: PropController | null = null;
  private lightAnchors: THREE.Object3D[] = [];
  private level: Level = "medio";

  constructor() {
    this.group.name = "stage-scene";
  }

  get current(): StageVisualDef | null {
    return this.def;
  }

  /** Anclas de las luces intensas (para los destellos de lente). */
  get intenseLights(): readonly { obj: THREE.Object3D; color: string }[] {
    return this.lightAnchors.map((obj, i) => ({ obj, color: this.def!.intenseLights[i].color }));
  }

  /** Construye el escenario si cambió. Devuelve `true` si se reconstruyó. */
  setStage(id: StageId, level: Level, reducedMotion: boolean): boolean {
    if (this.stageId === id) return false;
    this.clear();
    this.stageId = id;
    const def = getStageVisual(id);
    this.def = def;
    this.level = level;

    // Cielo.
    try {
      const s = def.sky;
      this.skyMat = new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uTop: { value: new THREE.Color(s.top) },
          uMid: { value: new THREE.Color(s.mid) },
          uHorizon: { value: new THREE.Color(s.horizon) },
          uHorizonY: { value: s.horizonY },
          uStars: { value: s.stars },
          uSunColor: { value: new THREE.Color(s.sun?.color ?? "#000000") },
          uSun: { value: new THREE.Vector3(s.sun?.x ?? 0, s.sun?.y ?? 0, s.sun?.radius ?? 0) },
          uTime: { value: 0 },
        },
        depthWrite: false,
        toneMapped: false,
      });
      this.sky = new THREE.Mesh(QUAD, this.skyMat);
      this.sky.scale.set(60000, 30000, 1);
      this.sky.position.z = SKY_PLANE_Z;
      this.sky.renderOrder = -20;
      this.sky.frustumCulled = false;
      setLayerDeep(this.sky, FAR_LAYER);
      this.group.add(this.sky);
    } catch (err) {
      console.error("[stage] cielo no disponible", err);
    }

    // Capas lejanas pintadas.
    for (const l of def.layers) {
      try {
        const tex = canvasTexture(1024, 512, (ctx) => paintLayer(ctx, 1024, 512, l.style, l.seed));
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
        const mesh = new THREE.Mesh(QUAD, mat);
        const dist = Math.abs(l.z) + 800;
        mesh.scale.set(dist * 2.6, dist * 1.3, 1);
        mesh.position.z = l.z;
        mesh.renderOrder = -15;
        setLayerDeep(mesh, FAR_LAYER);
        this.group.add(mesh);
        this.layers.push({ mesh, parallax: l.parallax, tex, mat });
      } catch (err) {
        console.error(`[stage] capa ${l.style} omitida`, err);
      }
    }

    // Props animados.
    const defs: AnimatedPropDef[] = [];
    const handles: PropHandle[] = [];
    for (const pd of def.props) {
      try {
        const p = buildProp(pd);
        positionProp(p, pd);
        if (pd.z < FAR_Z) setLayerDeep(p.obj, FAR_LAYER);
        this.group.add(p.obj);
        this.props.push(p);
        defs.push(pd);
        handles.push(p.handle);
      } catch (err) {
        console.error(`[stage] prop ${pd.id} omitido`, err);
      }
    }
    this.controller = new PropController(defs, handles, level, reducedMotion);

    // Anclas de luces intensas.
    for (const li of def.intenseLights) {
      const o = new THREE.Object3D();
      o.position.set(li.x, li.y, li.z);
      this.group.add(o);
      this.lightAnchors.push(o);
    }
    return true;
  }

  /** Nivel de animaciones de fondo (sin reconstruir nada, R10.7). */
  setLevel(level: Level): void {
    this.level = level;
    this.controller?.setLevel(level);
  }

  update(camera: Camera, tSeconds: number, reducedMotion: boolean): void {
    const fx = camera.focusX;
    const fy = -camera.focusY;
    if (this.sky) this.sky.position.set(fx, fy, SKY_PLANE_Z);
    if (this.skyMat) this.skyMat.uniforms.uTime.value = reducedMotion ? 0 : tSeconds;
    for (const l of this.layers) {
      l.mesh.position.x = fx * l.parallax;
      l.mesh.position.y = fy * l.parallax + 120;
    }
    // Con nivel "desactivado" no se anima nada (los props quedan en t = 0).
    if (this.level !== "desactivado") this.controller?.update(tSeconds, reducedMotion);
  }

  private clear(): void {
    for (const p of this.props) {
      p.obj.removeFromParent();
      p.dispose();
    }
    this.props = [];
    for (const l of this.layers) {
      l.mesh.removeFromParent();
      l.tex.dispose();
      l.mat.dispose();
    }
    this.layers = [];
    this.sky?.removeFromParent();
    this.skyMat?.dispose();
    this.sky = null;
    this.skyMat = null;
    for (const a of this.lightAnchors) a.removeFromParent();
    this.lightAnchors = [];
    this.controller = null;
    this.def = null;
  }

  dispose(): void {
    this.clear();
    this.stageId = null;
  }
}
