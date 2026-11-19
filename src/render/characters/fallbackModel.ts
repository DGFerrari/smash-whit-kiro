/**
 * Modelo_Respaldo procedimental (R11.6, R12.1, R12.4).
 *
 * Personajes estilizados tipo anime construidos con primitivas (cápsulas,
 * esferas, conos) y sombreado toon de 3 bandas + rim (materials.ts). Cada uno
 * tiene silueta propia:
 *   - El Primo (luchador): torso enorme, brazos gigantes, máscara con llamas y cinturón de campeón.
 *   - (lancer, sin asignar): pelo en punta hacia atrás, hombreras, capa y lanza.
 *   - Vesper (brawler): melena con coleta, bufanda y guanteletes.
 *   - Sol (mage): pelo de punta, gafas, capucha caída y orbe flotante.
 *   - Ivy (ranger): capucha puntiaguda, trenza y arco.
 *   - Saco (sack): saco de arena con costuras.
 *
 * Unidades: altura ≈ 1, pies en y = 0, mirando a +Z. El renderer lo escala a
 * la caja de colisión y gira el yaw según `facing`. La animación es
 * procedimental (`update`) a partir del estado de animación elegido por
 * `selectAnimState`; nunca toca la simulación.
 */
import * as THREE from "three";
import type { CharacterId } from "../../engine/game/characters.ts";
import type { AnimState } from "./animator.ts";
import type { AttackDir, AttackLimb } from "../../engine/combat/attacks.ts";
import { getCharacterVisual, type FallbackSilhouette } from "./characterDefs.ts";
import {
  createStylizedUniforms,
  createToonMaterial,
  setHitTint,
  type MaterialType,
  type StylizedUniforms,
} from "./materials.ts";

// ---------------------------------------------------------------------------
// Paleta por silueta
// ---------------------------------------------------------------------------

interface Palette {
  main: string;
  accent: string;
  hair: string;
  skin: string;
  dark: string;
  metal: string;
  eye: string;
}

const HAIR: Record<FallbackSilhouette, string> = {
  lancer: "#e6ecfa",
  luchador: "#1c2030",
  brawler: "#3a1222",
  mage: "#ffd23f",
  ranger: "#2f5a28",
  idol: "#ff9ae6",
  tank: "#5a3a22",
  ninja: "#14162a",
  chef: "#2a1a10",
  pilot: "#ff5a2a",
  slime: "#40e8ff",
  robot: "#c8d0e0",
  sack: "#b88a5a",
};

const EYE: Record<FallbackSilhouette, string> = {
  lancer: "#66d9ff",
  luchador: "#2a1d14",
  brawler: "#ff4060",
  mage: "#ffb020",
  ranger: "#7dff9a",
  idol: "#c86bff",
  tank: "#ffcf4a",
  ninja: "#ff2d4a",
  chef: "#5a3a22",
  pilot: "#3ff0ff",
  slime: "#0c2440",
  robot: "#ff3d5a",
  sack: "#1a1a1a",
};

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

export interface FallbackRig {
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  /** Extras animables (capa, coleta, orbe…). */
  extras: THREE.Object3D[];
  /** Altura de la cadera en reposo (por defecto `HIPS_H`). */
  hipsHeight?: number;
}

/** Ángulos/posiciones animables (todos se suavizan entre poses). */
const JOINTS = [
  "hipsY",
  "hipsRX",
  "hipsRZ",
  "torsoX",
  "torsoY",
  "torsoZ",
  "headX",
  "headY",
  "armLX",
  "armLZ",
  "armRX",
  "armRZ",
  "foreLX",
  "foreRX",
  "legLX",
  "legLZ",
  "legRX",
  "legRZ",
  "shinLX",
  "shinRX",
  "spin",
] as const;
type Joint = (typeof JOINTS)[number];
export type Pose = Record<Joint, number>;

function neutralPose(): Pose {
  const p = {} as Pose;
  for (const j of JOINTS) p[j] = 0;
  p.armLZ = 0.15;
  p.armRZ = -0.15;
  return p;
}

const HIPS_H = 0.47;

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------

class Builder {
  readonly uniforms: StylizedUniforms;
  private readonly mats = new Map<string, THREE.Material>();
  readonly geos: THREE.BufferGeometry[] = [];

  constructor(rim: string) {
    this.uniforms = createStylizedUniforms({ rimColor: rim, rimPower: 2.4, rimStrength: 0.85 });
  }

  mat(type: MaterialType, color: string, emissive?: string): THREE.Material {
    const key = `${type}|${color}|${emissive ?? ""}`;
    let m = this.mats.get(key);
    if (!m) {
      m = createToonMaterial(type, color, this.uniforms, emissive ? { emissive, emissiveIntensity: 1.4 } : {});
      this.mats.set(key, m);
    }
    return m;
  }

  private geo<G extends THREE.BufferGeometry>(g: G): G {
    this.geos.push(g);
    return g;
  }

  /** Cápsula vertical que cuelga desde el origen hacia -Y. */
  limb(parent: THREE.Object3D, r: number, len: number, mat: THREE.Material, r2 = r): THREE.Mesh {
    const g = this.geo(new THREE.CylinderGeometry(r2, r, len, 8, 1));
    const m = new THREE.Mesh(g, mat);
    m.position.y = -len / 2;
    parent.add(m);
    const cap = new THREE.Mesh(this.sphereGeo(Math.max(r, r2)), mat);
    cap.position.y = -len;
    parent.add(cap);
    return m;
  }

  private readonly sphereCache = new Map<number, THREE.SphereGeometry>();
  sphereGeo(r: number): THREE.SphereGeometry {
    const k = Math.round(r * 1000);
    let g = this.sphereCache.get(k);
    if (!g) {
      g = this.geo(new THREE.SphereGeometry(r, 12, 9));
      this.sphereCache.set(k, g);
    }
    return g;
  }

  sphere(parent: THREE.Object3D, r: number, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh {
    const m = new THREE.Mesh(this.sphereGeo(r), mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  }

  cone(parent: THREE.Object3D, r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.ConeGeometry(r, h, 6)), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  cyl(parent: THREE.Object3D, r1: number, r2: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(r1, r2, h, 10)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  torus(parent: THREE.Object3D, r: number, tube: number, mat: THREE.Material, arc = Math.PI * 2): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.TorusGeometry(r, tube, 6, 16, arc)), mat);
    parent.add(m);
    return m;
  }

  /** Estrella de 5 puntas extruida (mirando a +Z). */
  star(parent: THREE.Object3D, r: number, depth: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const m = new THREE.Mesh(this.geo(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false })), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  materials(): THREE.Material[] {
    return [...this.mats.values()];
  }
}

function group(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Cuerpo humanoide común (proporciones anime estilizadas). */
function buildHumanoid(b: Builder, root: THREE.Group, pal: Palette, slim: boolean): FallbackRig {
  const cloth = b.mat("cloth", pal.main);
  const dark = b.mat("leather", pal.dark);
  const skin = b.mat("skin", pal.skin);
  const accent = b.mat("cloth", pal.accent);

  const hips = group(root, 0, HIPS_H, 0);
  // Pelvis + cinturón.
  b.sphere(hips, 0.085, dark, 0, 0, 0, 1.15, 0.7, 0.85);
  b.cyl(hips, 0.09, 0.095, 0.035, b.mat("leather", pal.accent), 0, 0.03, 0);

  const torso = group(hips, 0, 0.04, 0);
  // Torso en V (pecho más ancho que cintura).
  const chest = b.cyl(torso, slim ? 0.105 : 0.12, 0.075, 0.24, cloth, 0, 0.13, 0);
  chest.scale.z = 0.72;
  b.box(torso, 0.05, 0.16, 0.02, accent, 0, 0.14, 0.075);
  // Cuello.
  b.cyl(torso, 0.03, 0.035, 0.05, skin, 0, 0.27, 0);

  const head = group(torso, 0, 0.3, 0);
  // Cabeza ligeramente grande (estilo anime) con mentón afilado.
  b.sphere(head, 0.088, skin, 0, 0.07, 0, 0.92, 1.05, 0.95);
  b.cone(head, 0.06, 0.06, skin, 0, 0.005, 0.012, Math.PI, 0, 0);
  // Ojos grandes con brillo emisivo.
  const eyeMat = b.mat("skin", pal.eye, pal.eye);
  const white = b.mat("skin", "#ffffff");
  for (const sx of [-1, 1]) {
    b.sphere(head, 0.02, white, sx * 0.033, 0.07, 0.074, 0.9, 1.25, 0.4);
    b.sphere(head, 0.013, eyeMat, sx * 0.033, 0.066, 0.081, 0.9, 1.3, 0.4);
  }

  const shoulderY = 0.235;
  const armR = group(torso, -(slim ? 0.125 : 0.14), shoulderY, 0);
  const armL = group(torso, slim ? 0.125 : 0.14, shoulderY, 0);
  b.limb(armR, 0.032, 0.14, cloth, 0.028);
  b.limb(armL, 0.032, 0.14, cloth, 0.028);
  const foreR = group(armR, 0, -0.14, 0);
  const foreL = group(armL, 0, -0.14, 0);
  b.limb(foreR, 0.027, 0.13, skin, 0.022);
  b.limb(foreL, 0.027, 0.13, skin, 0.022);
  b.sphere(foreR, 0.032, dark, 0, -0.15, 0);
  b.sphere(foreL, 0.032, dark, 0, -0.15, 0);

  const legR = group(hips, -0.055, -0.02, 0);
  const legL = group(hips, 0.055, -0.02, 0);
  b.limb(legR, 0.045, 0.21, dark, 0.035);
  b.limb(legL, 0.045, 0.21, dark, 0.035);
  const shinR = group(legR, 0, -0.21, 0);
  const shinL = group(legL, 0, -0.21, 0);
  b.limb(shinR, 0.036, 0.2, cloth, 0.03);
  b.limb(shinL, 0.036, 0.2, cloth, 0.03);
  // Botas.
  for (const s of [shinR, shinL]) {
    const boot = b.sphere(s, 0.04, dark, 0, -0.215, 0.02, 1, 0.75, 1.6);
    boot.userData.boot = true;
  }

  return { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, extras: [] };
}

function buildLancer(b: Builder, rig: FallbackRig, pal: Palette): void {
  const hair = b.mat("hair", pal.hair);
  const metal = b.mat("metal", pal.metal);
  const accent = b.mat("metal", pal.accent);
  // Pelo en punta barrido hacia atrás.
  b.sphere(rig.head, 0.095, hair, 0, 0.1, -0.012, 1, 0.85, 1);
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 1.8;
    b.cone(rig.head, 0.03, 0.15, hair, Math.sin(a) * 0.07, 0.14 + Math.cos(a) * 0.02, -0.06, -1.9, 0, -a * 0.7);
  }
  b.cone(rig.head, 0.025, 0.09, hair, 0.04, 0.1, 0.08, 0.6, 0, -0.5);
  // Hombreras.
  for (const arm of [rig.armL, rig.armR]) b.sphere(arm, 0.055, metal, 0, 0.01, 0, 1.1, 0.7, 1);
  // Capa.
  const cape = group(rig.torso, 0, 0.25, -0.07);
  const capeMesh = b.box(cape, 0.22, 0.42, 0.012, b.mat("cloth", pal.accent), 0, -0.2, 0);
  capeMesh.scale.x = 1;
  rig.extras.push(cape);
  // Lanza en la mano derecha.
  const spear = group(rig.foreR, 0, -0.15, 0);
  b.cyl(spear, 0.012, 0.012, 0.95, metal, 0, 0, 0).rotation.x = Math.PI / 2;
  b.cone(spear, 0.03, 0.12, accent, 0, 0, 0.53, Math.PI / 2, 0, 0);
  b.torus(spear, 0.03, 0.008, accent).position.set(0, 0, 0.45);
}

function buildBrawler(b: Builder, rig: FallbackRig, pal: Palette): void {
  const hair = b.mat("hair", pal.hair);
  const metal = b.mat("metal", pal.metal);
  b.sphere(rig.head, 0.097, hair, 0, 0.095, -0.015, 1.02, 0.9, 1.02);
  // Flequillo.
  for (const x of [-0.05, 0, 0.05]) b.cone(rig.head, 0.03, 0.09, hair, x, 0.11, 0.07, 2.6, 0, x * 4);
  // Melena y coleta (cadena animable).
  b.sphere(rig.head, 0.08, hair, 0, 0.03, -0.06, 1, 1.4, 0.8);
  const tail = group(rig.head, 0, 0.12, -0.08);
  let parent: THREE.Object3D = tail;
  for (let i = 0; i < 4; i++) {
    const seg = group(parent, 0, i === 0 ? 0 : -0.07, i === 0 ? 0 : -0.02);
    b.sphere(seg, 0.04 - i * 0.006, hair, 0, -0.035, 0, 0.9, 1.4, 0.9);
    parent = seg;
    rig.extras.push(seg);
  }
  // Bufanda.
  const scarf = b.torus(rig.torso, 0.06, 0.022, b.mat("cloth", pal.accent));
  scarf.position.y = 0.26;
  scarf.rotation.x = Math.PI / 2;
  const tails = group(rig.torso, 0.03, 0.25, -0.05);
  b.box(tails, 0.04, 0.22, 0.01, b.mat("cloth", pal.accent), 0, -0.11, 0);
  rig.extras.push(tails);
  // Guanteletes grandes.
  for (const f of [rig.foreL, rig.foreR]) {
    b.sphere(f, 0.055, metal, 0, -0.15, 0, 1, 1, 1.1);
    b.cyl(f, 0.035, 0.04, 0.07, b.mat("leather", pal.accent), 0, -0.1, 0);
  }
}

function buildMage(b: Builder, rig: FallbackRig, pal: Palette): void {
  const hair = b.mat("hair", pal.hair);
  b.sphere(rig.head, 0.094, hair, 0, 0.1, -0.01, 1, 0.85, 1);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.cone(rig.head, 0.03, 0.12, hair, Math.cos(a) * 0.06, 0.17, Math.sin(a) * 0.05 - 0.01, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
  }
  // Gafas en la frente.
  const goggles = b.mat("metal", pal.metal);
  const lens = b.mat("skin", pal.accent, pal.accent);
  for (const sx of [-1, 1]) {
    const t = b.torus(rig.head, 0.025, 0.008, goggles);
    t.position.set(sx * 0.035, 0.135, 0.07);
    t.rotation.x = -0.4;
    b.sphere(rig.head, 0.022, lens, sx * 0.035, 0.135, 0.07, 1, 1, 0.4);
  }
  // Capucha caída.
  b.sphere(rig.torso, 0.09, b.mat("cloth", pal.dark), 0, 0.26, -0.07, 1.1, 0.7, 0.8);
  // Faldón de túnica.
  const robe = b.cyl(rig.hips, 0.1, 0.16, 0.2, b.mat("cloth", pal.main), 0, -0.08, 0);
  robe.scale.z = 0.8;
  // Orbe flotante emisivo.
  const orb = group(rig.torso, 0.22, 0.15, 0.1);
  b.sphere(orb, 0.045, b.mat("skin", pal.accent, pal.accent));
  b.torus(orb, 0.07, 0.006, b.mat("metal", pal.metal)).rotation.x = 1.2;
  rig.extras.push(orb);
}

function buildRanger(b: Builder, rig: FallbackRig, pal: Palette): void {
  const hair = b.mat("hair", pal.hair);
  const hood = b.mat("cloth", pal.main);
  b.sphere(rig.head, 0.09, hair, 0, 0.09, -0.01, 1, 0.85, 1);
  // Capucha puntiaguda.
  b.sphere(rig.head, 0.105, hood, 0, 0.095, -0.025, 1, 1, 1.05);
  b.cone(rig.head, 0.07, 0.17, hood, 0, 0.13, -0.12, -1.2, 0, 0);
  // Trenza.
  const braid = group(rig.head, 0.06, 0.05, -0.03);
  let parent: THREE.Object3D = braid;
  for (let i = 0; i < 3; i++) {
    const seg = group(parent, 0, i === 0 ? 0 : -0.06, 0.01);
    b.sphere(seg, 0.026, hair, 0, -0.03, 0, 1, 1.3, 1);
    parent = seg;
    rig.extras.push(seg);
  }
  // Hojas sobre el hombro.
  const leaf = b.mat("cloth", pal.accent);
  for (let i = 0; i < 3; i++) b.cone(rig.armL, 0.03, 0.08, leaf, 0.02, 0.03, -0.02 + i * 0.02, 0.4, 0, -1.2 + i * 0.4);
  // Arco en la mano izquierda + carcaj.
  const bow = group(rig.foreL, 0, -0.15, 0.02);
  const arc = b.torus(bow, 0.22, 0.01, b.mat("leather", pal.dark), Math.PI * 0.9);
  arc.rotation.set(0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.05);
  b.cyl(rig.torso, 0.03, 0.03, 0.24, b.mat("leather", pal.dark), -0.05, 0.16, -0.08).rotation.z = 0.5;
}

/** Cadera de El Primo: piernas cortas, torso enorme. */
const LUCHADOR_HIPS = 0.37;

/**
 * El Primo (recreación por código del render oficial de Brawl Stars):
 *  - Máscara azul intensa que cubre cabeza y nariz, aros rojos con borde
 *    oscuro alrededor de unos ojos blancos enormes, emblema de llama
 *    amarilla en la frente y la nariz asomando.
 *  - Sonrisa de dientes gigante y mentón al descubierto.
 *  - Torso en V sin camiseta, piel anaranjada, tatuaje de cruz en el vientre.
 *  - Brazos enormes con muñequeras azules y puños grandes.
 *  - Cinturón rojo de campeón con hebilla dorada y estrella.
 *  - Mallas azules y botas altas azul oscuro.
 */
function buildLuchador(b: Builder, root: THREE.Group, _pal: Palette): FallbackRig {
  const skin = b.mat("skin", "#d98a4e");
  const skinDark = b.mat("skin", "#8a4a26");
  const blue = b.mat("cloth", "#2b8cf2");
  const blueDark = b.mat("cloth", "#1d5fc9");
  const red = b.mat("leather", "#d1374f");
  const eyeRing = b.mat("leather", "#e8264a");
  const outline = b.mat("leather", "#151a33");
  const gold = b.mat("metal", "#ffb627");
  const goldStar = b.mat("metal", "#ffd84d");
  const yellow = b.mat("skin", "#ffd23f", "#ffb020");
  const white = b.mat("skin", "#ffffff");
  const eyeWhite = b.mat("skin", "#fdf4ff");

  const hips = group(root, 0, LUCHADOR_HIPS, 0);
  // Mallas azules.
  b.sphere(hips, 0.12, blue, 0, 0, 0, 1.2, 0.8, 0.95);
  // Cinturón rojo con hebilla dorada y estrella.
  const belt = b.cyl(hips, 0.148, 0.145, 0.075, red, 0, 0.065, 0);
  belt.scale.z = 0.84;
  const buckle = b.cyl(hips, 0.068, 0.068, 0.03, gold, 0.03, 0.065, 0.124);
  buckle.rotation.x = Math.PI / 2;
  const rim = b.torus(hips, 0.062, 0.01, b.mat("metal", "#e8941c"));
  rim.position.set(0.03, 0.065, 0.14);
  b.star(hips, 0.04, 0.012, goldStar, 0.03, 0.065, 0.138);
  // Remaches laterales de la hebilla.
  for (const sx of [-1, 1]) b.sphere(hips, 0.014, gold, 0.03 + sx * 0.088, 0.065, 0.118, 1, 1, 0.6);

  const torso = group(hips, 0, 0.06, 0);
  // Cintura + pecho en V (mucho más ancho arriba).
  b.sphere(torso, 0.15, skin, 0, 0.06, 0, 1, 0.85, 0.86);
  b.sphere(torso, 0.21, skin, 0, 0.22, -0.005, 1.28, 0.95, 0.82);
  for (const sx of [-1, 1]) b.sphere(torso, 0.1, skin, sx * 0.085, 0.27, 0.095, 1, 0.75, 0.55); // pectorales
  b.sphere(torso, 0.12, skin, 0, 0.35, -0.03, 1.7, 0.55, 0.9); // trapecios
  // Tatuaje de cruz en el vientre.
  b.box(torso, 0.012, 0.07, 0.01, skinDark, -0.045, 0.06, 0.128);
  b.box(torso, 0.045, 0.012, 0.01, skinDark, -0.045, 0.075, 0.128);

  // Cabeza grande, casi sin cuello.
  const head = group(torso, 0, 0.37, 0.05);
  // Mentón/mandíbula al descubierto (debajo de la máscara).
  b.sphere(head, 0.105, skin, 0, 0.02, 0.01, 1.05, 0.75, 0.95);
  // Máscara azul.
  b.sphere(head, 0.13, blue, 0, 0.1, -0.005, 1, 1.0, 0.98);
  // Borde inferior de la máscara (sobre el labio).
  const edge = b.torus(head, 0.118, 0.012, blueDark, Math.PI);
  edge.position.set(0, 0.055, 0);
  edge.rotation.set(Math.PI / 2, 0, Math.PI);
  // Sonrisa enorme: hueco oscuro + dientes.
  const mouth = b.box(head, 0.14, 0.055, 0.02, outline, 0, 0.035, 0.1);
  mouth.rotation.x = -0.15;
  const teeth = b.box(head, 0.128, 0.042, 0.02, white, 0, 0.036, 0.106);
  teeth.rotation.x = -0.15;
  for (const tx of [-0.03, 0, 0.03]) b.box(head, 0.003, 0.04, 0.005, outline, tx, 0.036, 0.117).rotation.x = -0.15;
  // Nariz que asoma por la máscara.
  b.cone(head, 0.024, 0.06, skin, 0, 0.085, 0.13, Math.PI / 2, 0, 0);
  // Ojos: borde oscuro + aro rojo + blanco enorme.
  for (const sx of [-1, 1]) {
    const ex = sx * 0.055;
    const ring = b.torus(head, 0.04, 0.012, eyeRing);
    ring.position.set(ex, 0.125, 0.113);
    ring.rotation.y = sx * 0.35;
    const line = b.torus(head, 0.053, 0.004, outline);
    line.position.set(ex, 0.125, 0.11);
    line.rotation.y = sx * 0.35;
    b.sphere(head, 0.038, eyeWhite, ex, 0.125, 0.112, 1, 1.05, 0.35);
  }
  // Emblema de llama amarilla en la frente.
  b.sphere(head, 0.022, yellow, 0, 0.19, 0.118, 1, 0.9, 0.35);
  b.cone(head, 0.016, 0.035, yellow, 0.006, 0.212, 0.116, 0, 0, -0.35).scale.z = 0.4;
  b.torus(head, 0.025, 0.005, b.mat("leather", "#e8941c")).position.set(0, 0.19, 0.116);

  // Brazos enormes con muñequeras azules.
  const shoulder = 0.27;
  const armR = group(torso, -shoulder, 0.3, 0);
  const armL = group(torso, shoulder, 0.3, 0);
  const foreR = group(armR, 0, -0.16, 0);
  const foreL = group(armL, 0, -0.16, 0);
  for (const [arm, fore] of [
    [armR, foreR],
    [armL, foreL],
  ] as const) {
    b.sphere(arm, 0.095, skin, 0, -0.01, 0, 1.05, 1, 1); // deltoide
    b.limb(arm, 0.072, 0.16, skin, 0.08); // bíceps
    b.limb(fore, 0.07, 0.12, skin, 0.074); // antebrazo
    b.cyl(fore, 0.079, 0.079, 0.065, blueDark, 0, -0.09, 0); // muñequera
    b.sphere(fore, 0.088, skin, 0, -0.165, 0.012, 1, 0.92, 1.08); // puño
    b.box(fore, 0.1, 0.012, 0.02, skinDark, 0, -0.16, 0.09); // nudillos
  }

  // Piernas: mallas azules y botas altas azul oscuro.
  const legR = group(hips, -0.075, -0.02, 0);
  const legL = group(hips, 0.075, -0.02, 0);
  const shinR = group(legR, 0, -0.15, 0);
  const shinL = group(legL, 0, -0.15, 0);
  for (const [leg, shin] of [
    [legR, shinR],
    [legL, shinL],
  ] as const) {
    b.limb(leg, 0.06, 0.15, blue, 0.066);
    b.limb(shin, 0.06, 0.14, blueDark, 0.058);
    b.cyl(shin, 0.068, 0.068, 0.035, blueDark, 0, -0.01, 0); // borde de la bota
    b.sphere(shin, 0.06, blueDark, 0, -0.15, 0.025, 1, 0.6, 1.5); // pie
  }

  return { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, extras: [], hipsHeight: LUCHADOR_HIPS };
}

/** Nova: idol cósmica con coletas, lazos, falda y micrófono-estrella. */
function buildIdol(b: Builder, rig: FallbackRig, pal: Palette): void {
  const hair = b.mat("hair", pal.hair);
  const bow = b.mat("skin", pal.accent, pal.accent);
  b.sphere(rig.head, 0.095, hair, 0, 0.1, -0.012, 1, 0.88, 1);
  for (const x of [-0.045, 0, 0.045]) b.sphere(rig.head, 0.03, hair, x, 0.135, 0.062, 1, 0.8, 0.6);
  for (const sx of [-1, 1]) {
    const tail = group(rig.head, sx * 0.09, 0.13, -0.02);
    b.sphere(tail, 0.03, bow);
    b.sphere(tail, 0.05, hair, sx * 0.03, -0.09, -0.01, 0.8, 1.9, 0.8);
    rig.extras.push(tail);
  }
  const skirt = b.cyl(rig.hips, 0.09, 0.17, 0.12, b.mat("cloth", pal.main), 0, -0.05, 0);
  skirt.scale.z = 0.85;
  b.torus(rig.hips, 0.165, 0.01, bow).rotation.x = Math.PI / 2;
  const mic = group(rig.foreR, 0, -0.17, 0.03);
  b.cyl(mic, 0.012, 0.012, 0.12, b.mat("metal", pal.metal), 0, 0.02, 0);
  b.star(mic, 0.05, 0.015, bow, 0, 0.11, -0.007);
}

/** Rook: caballero tanque con yelmo de visor brillante, peto y escudo torre. */
function buildTank(b: Builder, rig: FallbackRig, pal: Palette): void {
  const steel = b.mat("metal", pal.metal);
  const armor = b.mat("metal", pal.main);
  const gold = b.mat("metal", pal.accent);
  const glow = b.mat("skin", pal.eye, pal.eye);
  b.sphere(rig.head, 0.102, armor, 0, 0.08, 0, 1, 1.08, 1);
  b.box(rig.head, 0.13, 0.024, 0.02, glow, 0, 0.075, 0.096);
  b.cone(rig.head, 0.022, 0.11, gold, 0, 0.21, -0.02);
  b.box(rig.torso, 0.27, 0.2, 0.17, armor, 0, 0.14, 0);
  b.box(rig.torso, 0.05, 0.13, 0.02, gold, 0, 0.15, 0.09);
  b.box(rig.torso, 0.13, 0.04, 0.02, gold, 0, 0.17, 0.09);
  for (const arm of [rig.armL, rig.armR]) b.sphere(arm, 0.075, steel, 0, 0.01, 0, 1.25, 0.8, 1.1);
  for (const s of [rig.shinL, rig.shinR]) b.cyl(s, 0.045, 0.05, 0.14, steel, 0, -0.08, 0);
  const shield = group(rig.foreL, 0.03, -0.1, 0.07);
  b.box(shield, 0.24, 0.4, 0.03, armor);
  b.box(shield, 0.2, 0.035, 0.035, gold, 0, 0.05, 0.002);
  b.box(shield, 0.035, 0.3, 0.035, gold, 0, 0.02, 0.002);
  b.sphere(shield, 0.03, gold, 0, 0.05, 0.02);
}

/** Kaito: ninja con máscara, cinta, bufanda roja larga y katana a la espalda. */
function buildNinja(b: Builder, rig: FallbackRig, pal: Palette): void {
  const dark = b.mat("cloth", pal.hair);
  const red = b.mat("cloth", pal.accent);
  b.sphere(rig.head, 0.094, dark, 0, 0.1, -0.01, 1, 0.9, 1);
  for (let i = 0; i < 5; i++) {
    const a = (i / 4 - 0.5) * 1.6;
    b.cone(rig.head, 0.025, 0.1, dark, Math.sin(a) * 0.06, 0.17, -0.03, -0.5, 0, -a * 0.8);
  }
  b.sphere(rig.head, 0.08, dark, 0, 0.035, 0.02, 1.08, 0.65, 0.98);
  const band = b.torus(rig.head, 0.093, 0.012, red);
  band.position.y = 0.115;
  band.rotation.x = Math.PI / 2;
  const tails = group(rig.head, 0, 0.115, -0.09);
  b.box(tails, 0.02, 0.12, 0.008, red, 0.015, -0.06, 0).rotation.z = 0.3;
  b.box(tails, 0.02, 0.1, 0.008, red, -0.015, -0.05, 0).rotation.z = -0.3;
  rig.extras.push(tails);
  const scarf = b.torus(rig.torso, 0.06, 0.026, red);
  scarf.position.y = 0.26;
  scarf.rotation.x = Math.PI / 2;
  const st = group(rig.torso, 0.03, 0.26, -0.06);
  b.box(st, 0.05, 0.34, 0.01, red, 0, -0.17, 0);
  rig.extras.push(st);
  const katana = group(rig.torso, 0, 0.15, -0.09);
  katana.rotation.z = 0.7;
  b.box(katana, 0.016, 0.42, 0.01, b.mat("metal", pal.metal), 0, 0.06, 0);
  b.box(katana, 0.06, 0.012, 0.03, red, 0, -0.15, 0);
  b.box(katana, 0.02, 0.1, 0.02, dark, 0, -0.21, 0);
}

/** Taro: chef con gorro alto, bigote, delantal y wok en llamas. */
function buildChef(b: Builder, rig: FallbackRig, pal: Palette): void {
  const hair = b.mat("hair", pal.hair);
  const white = b.mat("cloth", "#f4f6ff");
  const flame = b.mat("skin", pal.accent, pal.accent);
  b.sphere(rig.head, 0.092, hair, 0, 0.09, -0.012, 1, 0.8, 1);
  b.cyl(rig.head, 0.078, 0.088, 0.1, white, 0, 0.19, 0);
  b.sphere(rig.head, 0.1, white, 0, 0.27, 0, 1.05, 0.6, 1.05);
  for (const sx of [-1, 1]) b.sphere(rig.head, 0.024, hair, sx * 0.026, 0.042, 0.083, 1.5, 0.6, 0.6);
  b.box(rig.torso, 0.17, 0.26, 0.015, white, 0, 0.08, 0.082);
  const tie = b.torus(rig.torso, 0.05, 0.02, flame);
  tie.position.y = 0.265;
  tie.rotation.x = Math.PI / 2;
  const wok = group(rig.foreR, 0, -0.17, 0.04);
  b.cyl(wok, 0.012, 0.012, 0.14, b.mat("leather", "#6a3a1c"), 0, 0, 0).rotation.x = Math.PI / 2;
  b.sphere(wok, 0.11, b.mat("metal", "#2a2d36"), 0, 0, 0.17, 1, 0.3, 1);
  for (let i = 0; i < 3; i++) b.cone(wok, 0.025, 0.07, flame, (i - 1) * 0.04, 0.05, 0.17, 0, 0, (i - 1) * 0.3);
}

/** Bolt: piloto con casco de carreras, visor brillante y propulsores. */
function buildPilot(b: Builder, rig: FallbackRig, pal: Palette): void {
  const helmet = b.mat("metal", pal.main);
  const visor = b.mat("metal", pal.eye, pal.eye);
  const stripe = b.mat("leather", pal.accent);
  b.sphere(rig.head, 0.108, helmet, 0, 0.085, 0, 1, 1, 1.05);
  b.sphere(rig.head, 0.08, visor, 0, 0.085, 0.048, 1.12, 0.55, 0.72);
  const s = b.torus(rig.head, 0.109, 0.014, stripe, Math.PI);
  s.position.y = 0.085;
  s.rotation.y = Math.PI / 2;
  b.box(rig.torso, 0.04, 0.2, 0.02, stripe, 0, 0.13, 0.078);
  for (const sx of [-1, 1]) {
    const pack = group(rig.torso, sx * 0.06, 0.16, -0.1);
    b.cyl(pack, 0.035, 0.03, 0.16, b.mat("metal", "#3a4054"));
    b.cone(pack, 0.026, 0.08, b.mat("skin", "#3ff0ff", "#3ff0ff"), 0, -0.12, 0, Math.PI, 0, 0);
  }
}

/** Gloop: rey slime, cuerpo gelatinoso con corona y ojos enormes. */
function buildSlime(b: Builder, root: THREE.Group, pal: Palette): FallbackRig {
  const goo = b.mat("leather", pal.main);
  const shine = b.mat("skin", "#ffffff");
  const gold = b.mat("metal", pal.accent);
  const eyeMat = b.mat("skin", pal.eye);
  const hips = group(root, 0, 0.22, 0);
  const torso = group(hips, 0, 0, 0);
  b.sphere(torso, 0.32, goo, 0, 0.12, 0, 1.1, 1.15, 0.95);
  b.sphere(torso, 0.06, shine, -0.13, 0.32, 0.2, 1, 0.6, 0.4);
  const head = group(torso, 0, 0.32, 0.05);
  for (const sx of [-1, 1]) {
    b.sphere(head, 0.055, shine, sx * 0.085, 0, 0.17, 1, 1.15, 0.5);
    b.sphere(head, 0.032, eyeMat, sx * 0.085, -0.008, 0.19, 1, 1.2, 0.5);
  }
  const crown = group(head, 0, 0.14, -0.04);
  b.cyl(crown, 0.085, 0.085, 0.05, gold);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.cone(crown, 0.022, 0.08, gold, Math.cos(a) * 0.075, 0.06, Math.sin(a) * 0.075);
  }
  const armR = group(torso, -0.3, 0.12, 0);
  const armL = group(torso, 0.3, 0.12, 0);
  const foreR = group(armR, 0, -0.05, 0);
  const foreL = group(armL, 0, -0.05, 0);
  b.sphere(foreR, 0.07, goo, 0, -0.03, 0);
  b.sphere(foreL, 0.07, goo, 0, -0.03, 0);
  const empty = (): THREE.Group => group(hips);
  return {
    hips,
    torso,
    head,
    armL,
    armR,
    foreL,
    foreR,
    legL: empty(),
    legR: empty(),
    shinL: empty(),
    shinR: empty(),
    extras: [],
    hipsHeight: 0.22,
  };
}

/** Unit-7: mecha de placas metálicas con visor y reactor rojos y antena. */
function buildRobot(b: Builder, root: THREE.Group, pal: Palette): FallbackRig {
  const plate = b.mat("metal", pal.main);
  const dark = b.mat("metal", "#2a3040");
  const glow = b.mat("skin", pal.accent, pal.accent);
  const H = 0.36;
  const hips = group(root, 0, H, 0);
  b.box(hips, 0.2, 0.08, 0.14, dark);
  const torso = group(hips, 0, 0.04, 0);
  b.box(torso, 0.3, 0.24, 0.2, plate, 0, 0.16, 0);
  b.box(torso, 0.2, 0.06, 0.16, dark, 0, 0.02, 0);
  b.sphere(torso, 0.04, glow, 0, 0.18, 0.1, 1, 1, 0.4);
  const head = group(torso, 0, 0.3, 0);
  b.box(head, 0.17, 0.13, 0.15, plate, 0, 0.07, 0);
  b.box(head, 0.13, 0.03, 0.02, glow, 0, 0.08, 0.078);
  b.cyl(head, 0.006, 0.006, 0.08, dark, 0.05, 0.17, 0);
  b.sphere(head, 0.016, glow, 0.05, 0.215, 0);
  const armR = group(torso, -0.19, 0.25, 0);
  const armL = group(torso, 0.19, 0.25, 0);
  const foreR = group(armR, 0, -0.14, 0);
  const foreL = group(armL, 0, -0.14, 0);
  for (const [arm, fore] of [
    [armR, foreR],
    [armL, foreL],
  ] as const) {
    b.sphere(arm, 0.055, dark);
    b.box(arm, 0.07, 0.13, 0.07, plate, 0, -0.07, 0);
    b.box(fore, 0.075, 0.11, 0.075, dark, 0, -0.06, 0);
    b.box(fore, 0.085, 0.07, 0.085, plate, 0, -0.15, 0);
  }
  const legR = group(hips, -0.06, -0.04, 0);
  const legL = group(hips, 0.06, -0.04, 0);
  const shinR = group(legR, 0, -0.15, 0);
  const shinL = group(legL, 0, -0.15, 0);
  for (const [leg, shin] of [
    [legR, shinR],
    [legL, shinL],
  ] as const) {
    b.box(leg, 0.08, 0.15, 0.09, dark, 0, -0.075, 0);
    b.box(shin, 0.09, 0.13, 0.1, plate, 0, -0.07, 0);
    b.box(shin, 0.1, 0.04, 0.15, dark, 0, -0.16, 0.02);
  }
  return { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, extras: [], hipsHeight: H };
}

function buildSack(b: Builder, root: THREE.Group, pal: Palette): FallbackRig {
  const sack = b.mat("cloth", pal.main);
  const rope = b.mat("leather", pal.accent);
  const hips = group(root, 0, HIPS_H, 0);
  const torso = group(hips, 0, 0, 0);
  const body = b.sphere(torso, 0.25, sack, 0, 0.02, 0, 1, 1.9, 0.85);
  body.userData.body = true;
  const head = group(torso, 0, 0.42, 0);
  b.sphere(head, 0.08, sack, 0, 0, 0, 1, 0.8, 1);
  b.torus(head, 0.06, 0.018, rope).rotation.x = Math.PI / 2;
  // Ojos en X y costura.
  const x = b.mat("leather", pal.dark);
  for (const sx of [-1, 1]) {
    for (const r of [0.7, -0.7]) {
      const bar = b.box(torso, 0.05, 0.012, 0.01, x, sx * 0.07, 0.25, 0.21);
      bar.rotation.z = r;
    }
  }
  b.box(torso, 0.012, 0.35, 0.01, x, 0.12, -0.05, 0.205).rotation.z = 0.15;
  const empty = (): THREE.Group => group(torso);
  const legs = group(hips, 0, -0.4, 0);
  b.sphere(legs, 0.2, rope, 0, 0, 0, 1, 0.25, 0.8);
  return {
    hips,
    torso,
    head,
    armL: empty(),
    armR: empty(),
    foreL: empty(),
    foreR: empty(),
    legL: empty(),
    legR: empty(),
    shinL: empty(),
    shinR: empty(),
    extras: [],
  };
}

// ---------------------------------------------------------------------------
// Poses procedimentales
// ---------------------------------------------------------------------------

/** Pose objetivo para `state`; `t` = tiempo global (s), `st` = tiempo en el estado (s). */
export function poseFor(state: AnimState, t: number, st: number, out: Pose = neutralPose()): Pose {
  for (const j of JOINTS) out[j] = 0;
  const breathe = Math.sin(t * 3) * 0.012;
  // Guardia de combate por defecto.
  out.armLX = -0.5;
  out.armLZ = 0.25;
  out.armRX = -0.7;
  out.armRZ = -0.25;
  out.foreLX = -1.3;
  out.foreRX = -1.2;
  out.legLX = -0.25;
  out.legRX = 0.2;
  out.shinLX = 0.35;
  out.shinRX = 0.2;
  out.hipsY = -0.015 + breathe;
  out.torsoX = 0.08;

  switch (state) {
    case "idle":
      out.torsoY = Math.sin(t * 1.5) * 0.06;
      out.headY = Math.sin(t * 1.1) * 0.08;
      break;
    case "run": {
      const c = t * 14;
      const s = Math.sin(c);
      out.legLX = s * 0.9 - 0.1;
      out.legRX = -s * 0.9 - 0.1;
      out.shinLX = 0.4 + Math.max(0, -Math.cos(c)) * 1.0;
      out.shinRX = 0.4 + Math.max(0, Math.cos(c)) * 1.0;
      out.armLX = -s * 0.9;
      out.armRX = s * 0.9;
      out.foreLX = -1.4;
      out.foreRX = -1.4;
      out.torsoX = 0.38;
      out.hipsY = Math.abs(Math.cos(c)) * 0.03 - 0.01;
      out.torsoY = s * 0.15;
      break;
    }
    case "jump":
      out.legLX = -1.1;
      out.shinLX = 1.6;
      out.legRX = -0.3;
      out.shinRX = 0.9;
      out.armLX = -2.4;
      out.armLZ = 0.4;
      out.armRX = -0.4;
      out.armRZ = -0.7;
      out.foreLX = -0.3;
      out.torsoX = -0.1;
      out.headX = -0.15;
      out.spin = st < 0.3 ? -st * 6 : 0;
      break;
    case "fall":
      out.legLX = -0.5;
      out.shinLX = 0.7;
      out.legRX = 0.25;
      out.shinRX = 0.3;
      out.armLZ = 1.1;
      out.armRZ = -1.1;
      out.armLX = -0.2;
      out.armRX = -0.2;
      out.foreLX = -0.4;
      out.foreRX = -0.4;
      out.torsoX = 0.05;
      out.headX = 0.15;
      break;
    case "light": {
      // Estocada rápida con el brazo derecho.
      const k = Math.min(1, st / 0.07);
      const back = Math.max(0, 1 - (st - 0.12) / 0.12);
      const p = k * back;
      out.armRX = -0.7 - 0.95 * p;
      out.armRZ = -0.25 + 0.2 * p;
      out.foreRX = -1.2 + 1.15 * p;
      out.torsoY = 0.5 * p;
      out.torsoX = 0.25;
      out.legLX = -0.6;
      out.shinLX = 0.6;
      out.legRX = 0.5;
      break;
    }
    case "heavy": {
      // Golpe en arco: arriba-atrás y abajo-delante.
      const swing = Math.min(1, st / 0.14);
      out.armRX = -2.9 + 2.7 * swing;
      out.armRZ = -0.3;
      out.foreRX = -0.2;
      out.armLX = -1.6 + 1.2 * swing;
      out.foreLX = -0.4;
      out.torsoX = -0.3 + 0.8 * swing;
      out.torsoY = -0.5 + 0.9 * swing;
      out.legLX = -0.9;
      out.shinLX = 0.9;
      out.legRX = 0.7;
      out.shinRX = 0.3;
      out.hipsY = -0.05;
      break;
    }
    case "charge": {
      // Agachado, brazo atrás, temblando.
      const tr = Math.sin(t * 60) * 0.03;
      out.armRX = 0.9 + tr;
      out.armRZ = -0.5;
      out.foreRX = -1.6;
      out.armLX = -1.4;
      out.foreLX = -0.6;
      out.torsoX = 0.3;
      out.torsoY = -0.6 + tr;
      out.legLX = -0.9;
      out.shinLX = 1.3;
      out.legRX = 0.5;
      out.shinRX = 0.9;
      out.hipsY = -0.07 + tr * 0.3;
      break;
    }
    case "shield":
      out.armLX = -1.4;
      out.armLZ = -0.5;
      out.armRX = -1.4;
      out.armRZ = 0.5;
      out.foreLX = -1.4;
      out.foreRX = -1.4;
      out.torsoX = 0.3;
      out.headX = 0.25;
      out.legLX = -0.6;
      out.shinLX = 1;
      out.legRX = 0.4;
      out.shinRX = 0.8;
      out.hipsY = -0.06;
      break;
    case "dodge":
      out.spin = st * 22;
      out.armLZ = 1.2;
      out.armRZ = -1.2;
      out.legLX = -1;
      out.shinLX = 1.4;
      out.legRX = -0.8;
      out.shinRX = 1.4;
      out.torsoX = 0.5;
      break;
    case "stun": {
      const w = Math.sin(t * 22);
      out.torsoX = -0.5;
      out.headX = -0.5;
      out.armLX = -2.2 + w * 0.4;
      out.armLZ = 0.9;
      out.armRX = -2 - w * 0.4;
      out.armRZ = -0.9;
      out.foreLX = -0.2;
      out.foreRX = -0.2;
      out.legLX = -0.7 + w * 0.3;
      out.legRX = 0.4 - w * 0.3;
      out.shinLX = 0.6;
      out.shinRX = 0.4;
      out.hipsRZ = w * 0.15;
      break;
    }
    case "wallSlide":
      out.armRX = -2.6;
      out.armRZ = -0.4;
      out.foreRX = -0.2;
      out.armLX = -0.4;
      out.armLZ = 0.7;
      out.legLX = -0.9;
      out.shinLX = 1.2;
      out.legRX = -0.2;
      out.shinRX = 0.4;
      out.torsoX = -0.1;
      out.headY = 0.6;
      break;
    case "celebrate": {
      const j = Math.abs(Math.sin(t * 5));
      out.armRX = -3.0;
      out.armRZ = -0.3;
      out.foreRX = -0.1;
      out.armLX = -0.3;
      out.armLZ = 0.6;
      out.foreLX = -1.8;
      out.hipsY = j * 0.06;
      out.torsoX = -0.2;
      out.headX = -0.25;
      out.legLX = -0.2;
      out.legRX = 0.1;
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface FallbackCharacter {
  readonly id: CharacterId;
  readonly root: THREE.Group;
  /** Rig procedimental (`null` en modelos GLTF, que usan su esqueleto). */
  readonly rig: FallbackRig | null;
  readonly uniforms: StylizedUniforms;
  readonly dominantColor: string;
  /** Avanza la animación (dt en s). */
  update(state: AnimState, dt: number): void;
  /** Gira hacia `facing` (±1) en ≤ 100 ms. */
  setFacing(facing: 1 | -1, dt: number): void;
  /** Tinte de golpe 0..1 (barato, solo uniforms). */
  setHitTint(amount: number, color?: THREE.ColorRepresentation): void;
  /** Golpe en curso (pose y extremidad agrandada), o `null`. */
  setAttack?(a: AttackVisual | null): void;
  dispose(): void;
}

/** Golpe a representar: parte del cuerpo, dirección, tipo e intensidad 0..1. */
export interface AttackVisual {
  limb: AttackLimb;
  dir: AttackDir;
  heavy: boolean;
  strength: number;
}

/**
 * Pose de golpe exagerada encima de la pose base (mezcla por `strength`):
 * puños al frente o arriba, patadas altas, cabezazos, placajes…
 */
export function applyAttackPose(p: Pose, a: AttackVisual): void {
  const k = Math.min(1, Math.max(0, a.strength));
  const mix = (j: Joint, v: number): void => {
    p[j] += (v - p[j]) * k;
  };
  if (a.limb === "kick") {
    if (a.dir === "up") {
      mix("legRX", -2.7);
      mix("shinRX", 0);
      mix("torsoX", -0.5);
      mix("legLX", 0.3);
    } else if (a.dir === "down") {
      mix("legRX", -0.2);
      mix("shinRX", 0);
      mix("legLX", -1.2);
      mix("shinLX", 1.5);
      mix("hipsY", 0.03);
    } else {
      mix("legRX", a.heavy ? -1.8 : -1.5);
      mix("shinRX", 0.05);
      mix("torsoX", -0.35);
      mix("legLX", 0.25);
      mix("armLZ", 1.0);
      mix("armRZ", -1.0);
    }
    return;
  }
  if (a.limb === "head") {
    const up = a.dir === "up";
    mix("torsoX", up ? -0.6 : 0.7);
    mix("headX", up ? -0.7 : 0.5);
    if (up) mix("hipsY", 0.05);
    return;
  }
  if (a.limb === "body") {
    if (a.dir === "down") {
      // Codazo / aplastón.
      mix("torsoX", 1.0);
      mix("armRX", -1.2);
      mix("armRZ", -0.2);
      mix("foreRX", -2.0);
    } else if (a.dir === "up") {
      mix("armLX", -3.0);
      mix("armRX", -3.0);
      mix("torsoX", -0.3);
    } else {
      // Placaje con el hombro.
      mix("torsoX", 0.55);
      mix("armLX", -1.4);
      mix("foreLX", -1.5);
      mix("armRX", -1.4);
      mix("foreRX", -1.5);
    }
    return;
  }
  // Puño / arma / magia con el brazo derecho.
  if (a.dir === "up") {
    mix("armRX", -3.0);
    mix("armRZ", -0.15);
    mix("foreRX", -0.05);
    mix("torsoX", -0.25);
  } else if (a.dir === "down") {
    mix("armRX", -0.6);
    mix("foreRX", -0.1);
    mix("torsoX", 0.75);
    mix("legLX", -0.8);
    mix("shinLX", 0.9);
  } else {
    mix("armRX", -1.6);
    mix("armRZ", 0);
    mix("foreRX", -0.02);
    mix("torsoY", 0.45);
    mix("torsoX", 0.2);
    mix("legLX", -0.6);
    mix("shinLX", 0.5);
    mix("legRX", 0.5);
  }
  if (a.limb === "magic") {
    mix("armLX", -1.6);
    mix("foreLX", -0.05);
  }
}

/** Cuánto crece la extremidad que golpea (efecto cartoon). */
export function limbScale(a: AttackVisual): number {
  const k = Math.min(1, Math.max(0, a.strength));
  const grow: Record<AttackLimb, number> = {
    fist: a.heavy ? 1.3 : 0.9,
    kick: a.heavy ? 1.1 : 0.8,
    weapon: a.heavy ? 0.7 : 0.45,
    magic: a.heavy ? 0.6 : 0.4,
    head: a.heavy ? 0.7 : 0.5,
    body: a.heavy ? 0.3 : 0.18,
  };
  return 1 + grow[a.limb] * k;
}

/** Yaw al mirar a la derecha: 3/4 hacia cámara para leer mejor la silueta. */
const FACING_YAW = 1.05;
const YAW_SPEED = (2 * FACING_YAW) / 0.08;

export function createFallbackCharacter(id: CharacterId): FallbackCharacter {
  const def = getCharacterVisual(id);
  const sil = def.fallback.silhouette;
  const pal: Palette = {
    main: def.dominantColor,
    accent: def.fallback.accent,
    hair: HAIR[sil],
    skin: "#f4cfb2",
    dark: "#1c2030",
    metal: "#c9d3e6",
    eye: EYE[sil],
  };
  const b = new Builder(new THREE.Color(def.dominantColor).lerp(new THREE.Color("#ffffff"), 0.55).getStyle());
  const root = new THREE.Group();
  root.name = `kb-char-${id}`;
  const body = new THREE.Group();
  root.add(body);

  let rig: FallbackRig;
  if (sil === "sack") {
    rig = buildSack(b, body, pal);
  } else if (sil === "luchador") {
    rig = buildLuchador(b, body, pal);
  } else if (sil === "slime") {
    rig = buildSlime(b, body, pal);
  } else if (sil === "robot") {
    rig = buildRobot(b, body, pal);
  } else {
    rig = buildHumanoid(b, body, pal, sil === "brawler" || sil === "ranger" || sil === "idol" || sil === "ninja");
    if (sil === "lancer") buildLancer(b, rig, pal);
    else if (sil === "brawler") buildBrawler(b, rig, pal);
    else if (sil === "mage") buildMage(b, rig, pal);
    else if (sil === "idol") buildIdol(b, rig, pal);
    else if (sil === "tank") buildTank(b, rig, pal);
    else if (sil === "ninja") buildNinja(b, rig, pal);
    else if (sil === "chef") buildChef(b, rig, pal);
    else if (sil === "pilot") buildPilot(b, rig, pal);
    else buildRanger(b, rig, pal);
  }

  const cur = neutralPose();
  const target = neutralPose();
  let t = Math.random() * 10;
  let st = 0;
  let prev: AnimState | null = null;
  let yaw = FACING_YAW;
  let atk: AttackVisual | null = null;

  const apply = (): void => {
    rig.hips.position.y = (rig.hipsHeight ?? HIPS_H) + cur.hipsY;
    rig.hips.rotation.set(cur.hipsRX, 0, cur.hipsRZ);
    rig.torso.rotation.set(cur.torsoX, cur.torsoY, cur.torsoZ);
    rig.head.rotation.set(cur.headX, cur.headY, 0);
    rig.armL.rotation.set(cur.armLX, 0, cur.armLZ);
    rig.armR.rotation.set(cur.armRX, 0, cur.armRZ);
    rig.foreL.rotation.x = cur.foreLX;
    rig.foreR.rotation.x = cur.foreRX;
    rig.legL.rotation.set(cur.legLX, 0, cur.legLZ);
    rig.legR.rotation.set(cur.legRX, 0, cur.legRZ);
    rig.shinL.rotation.x = cur.shinLX;
    rig.shinR.rotation.x = cur.shinRX;
    // Giros (salto/esquiva) alrededor del centro del cuerpo.
    body.rotation.x = cur.spin;
    body.position.set(0, 0.5 - Math.cos(cur.spin) * 0.5, -Math.sin(cur.spin) * 0.5);
    // Extras secundarios (capa/coleta/orbe) con oscilación propia.
    rig.extras.forEach((e, i) => {
      if (sil === "mage") {
        e.position.set(0.22 + Math.cos(t * 2) * 0.04, 0.15 + Math.sin(t * 3) * 0.04, 0.1 + Math.sin(t * 2) * 0.06);
        e.rotation.y = t * 2;
      } else {
        e.rotation.x = 0.25 + Math.sin(t * 4 + i * 0.7) * 0.12 + cur.torsoX * 0.6;
      }
    });
  };
  apply();

  return {
    id,
    root,
    rig,
    uniforms: b.uniforms,
    dominantColor: def.dominantColor,
    update(state, dt) {
      t += dt;
      if (state !== prev) {
        st = 0;
        // Ataques y esquiva arrancan sin fundido (R11.10).
        const instant = state === "light" || state === "heavy" || state === "dodge";
        prev = state;
        poseFor(state, t, 0, target);
        if (instant) Object.assign(cur, target);
      } else {
        st += dt;
      }
      poseFor(state, t, st, target);
      const striking = atk !== null && (state === "light" || state === "heavy");
      if (striking) applyAttackPose(target, atk!);
      // Fundido ≈ 120 ms (exponencial); los golpes, mucho más secos.
      const k = 1 - Math.exp(-dt * (striking ? 60 : 28));
      for (const j of JOINTS) {
        if (j === "spin") {
          if (target.spin !== 0) cur.spin = target.spin;
          else {
            // Vuelve a 0 por el camino corto (sin desenrollar vueltas enteras).
            const w = Math.atan2(Math.sin(cur.spin), Math.cos(cur.spin));
            cur.spin = w * (1 - k);
          }
        }
        else cur[j] += (target[j] - cur[j]) * k;
      }
      apply();
      // Extremidad que golpea, agrandada (puño enorme, pie gigante…).
      for (const g of [rig.foreR, rig.foreL, rig.shinR, rig.head, rig.torso]) g.scale.setScalar(1);
      if (striking) {
        const s = limbScale(atk!);
        const part =
          atk!.limb === "kick"
            ? rig.shinR
            : atk!.limb === "head"
              ? rig.head
              : atk!.limb === "body"
                ? rig.torso
                : rig.foreR;
        part.scale.setScalar(s);
        if (atk!.limb === "magic") rig.foreL.scale.setScalar(s);
      }
    },
    setAttack(a) {
      atk = a;
    },
    setFacing(facing, dt) {
      const goal = facing * FACING_YAW;
      const step = YAW_SPEED * Math.max(0, dt);
      const d = goal - yaw;
      yaw = Math.abs(d) <= step ? goal : yaw + Math.sign(d) * step;
      root.rotation.y = yaw;
    },
    setHitTint(amount, color) {
      setHitTint(b.uniforms, amount, color);
    },
    dispose() {
      for (const g of b.geos) g.dispose();
      for (const m of b.materials()) m.dispose();
    },
  };
}
