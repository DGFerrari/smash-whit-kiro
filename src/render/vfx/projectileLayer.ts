/**
 * Dibujo de los proyectiles del World (solo lectura). Un pool de objetos por
 * proyectil vivo: forma según el tipo (lanza, bola de fuego, flecha…), halo
 * aditivo brillante (se ve con el bloom) y orientación según su velocidad.
 */
import * as THREE from "three";
import type { ProjectileKind } from "../../engine/combat/attacks.ts";
import type { Projectile } from "../../engine/combat/projectile.ts";

interface Visual {
  root: THREE.Group;
  shapes: Map<ProjectileKind, THREE.Object3D>;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
}

const COLORS: Record<ProjectileKind, number> = {
  spear: 0x5fe8ff,
  fireball: 0xff6a1f,
  bolt: 0xfff27a,
  arrow: 0x9dff8a,
  note: 0xff7ae6,
  kunai: 0xd8dcf0,
  tomato: 0xff3b3b,
  tire: 0x2a2d36,
  laser: 0xff3d5a,
  plasma: 0x7a5cff,
};

let glowTex: THREE.Texture | null = null;
function getGlowTex(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

function emissive(color: number, intensity = 2): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.3,
    metalness: 0.1,
    toneMapped: false,
  });
}

export class ProjectileLayer {
  readonly group = new THREE.Group();
  private readonly pool: Visual[] = [];
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly sphere = new THREE.SphereGeometry(0.5, 14, 10);
  private readonly cone = new THREE.ConeGeometry(0.5, 1, 8);
  private readonly torus = new THREE.TorusGeometry(0.36, 0.16, 8, 18);
  private readonly quad = new THREE.PlaneGeometry(1, 1);
  private readonly mats = new Map<string, THREE.Material>();

  constructor() {
    this.group.name = "projectiles";
  }

  private mat(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.mats.get(key);
    if (!m) {
      m = make();
      this.mats.set(key, m);
    }
    return m;
  }

  /** Construye la forma de un tipo (tamaño unitario; se escala con w×h). */
  private buildShape(kind: ProjectileKind): THREE.Object3D {
    const c = COLORS[kind];
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x = 0, rz = 0): void => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.scale.set(sx, sy, sz);
      mesh.position.x = x;
      mesh.rotation.z = rz;
      g.add(mesh);
    };
    const core = this.mat(`core-${kind}`, () => emissive(c, kind === "tire" ? 0 : 2.2));
    const white = this.mat("white", () => emissive(0xffffff, 1.6));
    switch (kind) {
      case "spear":
      case "arrow":
      case "kunai":
        add(this.box, core, 0.8, 0.35, 0.35, -0.1);
        add(this.cone, white, 0.5, 0.4, 0.5, 0.45, -Math.PI / 2);
        break;
      case "bolt":
      case "laser":
        add(this.box, core, 1, 0.6, 0.6);
        add(this.box, white, 0.9, 0.25, 0.3);
        break;
      case "tire": {
        const t = new THREE.Mesh(this.torus, core);
        t.scale.setScalar(1.4);
        g.add(t);
        const hub = new THREE.Mesh(this.sphere, this.mat("hub", () => emissive(0xd9ff3a, 1.5)));
        hub.scale.setScalar(0.35);
        g.add(hub);
        break;
      }
      case "note":
        add(this.sphere, core, 0.7, 0.55, 0.5, -0.1);
        add(this.box, core, 0.12, 0.9, 0.12, 0.22);
        break;
      default:
        // fireball, tomato, plasma: esfera con núcleo brillante.
        add(this.sphere, core, 1, 1, 1);
        add(this.sphere, white, 0.5, 0.5, 0.5);
        break;
    }
    return g;
  }

  private get(i: number): Visual {
    const existing = this.pool[i];
    if (existing) return existing;
    const root = new THREE.Group();
    const glowMat = new THREE.MeshBasicMaterial({
      map: getGlowTex(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const glow = new THREE.Mesh(this.quad, glowMat);
    root.add(glow);
    this.group.add(root);
    const v: Visual = { root, shapes: new Map(), glow, glowMat };
    this.pool[i] = v;
    return v;
  }

  update(projectiles: readonly Projectile[], alpha: number, camera: THREE.Camera, timeS: number): void {
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      const v = this.get(i);
      v.root.visible = true;
      let shape = v.shapes.get(p.kind);
      if (!shape) {
        shape = this.buildShape(p.kind);
        v.shapes.set(p.kind, shape);
        v.root.add(shape);
      }
      for (const [k, s] of v.shapes) s.visible = k === p.kind;
      const x = p.prevX + (p.x - p.prevX) * alpha + p.w / 2;
      const y = -(p.prevY + (p.y - p.prevY) * alpha + p.h / 2);
      v.root.position.set(x, y, 6);
      // Orientación según la velocidad (las esferas giran sobre sí mismas).
      const ang = Math.atan2(-p.vy, p.vx);
      if (p.kind === "tire") {
        shape.rotation.set(0, 0, -timeS * 14 * Math.sign(p.vx || 1));
        shape.scale.set(p.w / 1.4 / 0.52, p.h / 1.4 / 0.52, 12);
      } else if (p.kind === "fireball" || p.kind === "tomato" || p.kind === "plasma") {
        const pulse = 1 + Math.sin(timeS * 20 + i) * 0.08;
        shape.scale.set(p.w * pulse, p.h * pulse, p.w * pulse);
        shape.rotation.set(timeS * 6, timeS * 4, 0);
      } else {
        shape.rotation.set(0, 0, ang);
        shape.scale.set(Math.max(p.w, p.h), Math.min(p.w, p.h) * (p.kind === "note" ? 1.6 : 1), Math.min(p.w, p.h));
      }
      // Halo aditivo de cara a la cámara.
      v.glow.quaternion.copy(camera.quaternion);
      const gs = Math.max(p.w, p.h) * (p.kind === "plasma" ? 2.6 : 2.0);
      v.glow.scale.set(gs, gs, 1);
      v.glowMat.color.setHex(p.kind === "tire" ? 0xd9ff3a : COLORS[p.kind]);
      v.glowMat.opacity = p.kind === "tire" ? 0.35 : 0.85;
    }
    for (let i = projectiles.length; i < this.pool.length; i++) this.pool[i].root.visible = false;
  }

  dispose(): void {
    for (const g of [this.box, this.sphere, this.cone, this.torus, this.quad]) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    for (const v of this.pool) v.glowMat.dispose();
  }
}
