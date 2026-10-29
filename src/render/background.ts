import * as THREE from "three";
import type { Camera } from "./camera.ts";
import type { StageKind } from "../game/world.ts";

/**
 * Fondo de ciudad neón por CAPAS en 3D. En vez de simular el parallax a mano,
 * colocamos planos con siluetas de edificios a distintas PROFUNDIDADES (Z) y
 * dejamos que la perspectiva de la cámara genere el parallax automáticamente:
 * las capas lejanas (Z muy negativa) se mueven poco; las cercanas, más.
 *
 * Cada capa es un plano grande con una textura generada (canvas) de siluetas y
 * ventanas de neón. Los planos siguen a la cámara en X/Y (para cubrir siempre
 * la vista) pero mantienen su Z, de modo que el desplazamiento relativo entre
 * capas da el efecto 3D.
 *
 * En el modo "trainingGrid" el fondo se oculta (la escena usa un color plano
 * blanco y la rejilla la dibuja el renderer).
 */

interface LayerDef {
  z: number; // profundidad (más negativo = más lejos)
  base: string; // color de las siluetas
  neon: string; // color de ventanas/bordes
  heightFrac: number; // altura máx de edificios respecto a la textura
  seed: number;
}

const LAYERS: LayerDef[] = [
  { z: -2600, base: "#121a33", neon: "#26407a", heightFrac: 0.45, seed: 11 },
  { z: -1900, base: "#16203f", neon: "#2f5bd0", heightFrac: 0.6, seed: 29 },
  { z: -1300, base: "#1b2650", neon: "#8a3df0", heightFrac: 0.75, seed: 47 },
  { z: -800, base: "#202a4d", neon: "#ff3d8b", heightFrac: 0.9, seed: 83 },
];

export class Background3D {
  private readonly group = new THREE.Group();
  private readonly planes: THREE.Mesh[] = [];
  private mode: StageKind = "island";

  constructor(private readonly scene: THREE.Scene) {
    for (const def of LAYERS) {
      const plane = this.buildLayer(def);
      this.planes.push(plane);
      this.group.add(plane);
    }
    this.scene.add(this.group);
  }

  setMode(mode: StageKind): void {
    this.mode = mode;
    this.group.visible = mode !== "trainingGrid";
  }

  /**
   * Coloca las capas centradas en la X/Y de la cámara (para cubrir la vista),
   * manteniendo su Z. El tamaño de cada plano es grande y proporcional a su
   * distancia para llenar el encuadre.
   */
  update(camera: Camera): void {
    if (this.mode === "trainingGrid") return;
    const fx = camera.focusX;
    const fy = -camera.focusY; // a coords de escena
    for (const plane of this.planes) {
      plane.position.x = fx;
      plane.position.y = fy;
    }
  }

  private buildLayer(def: LayerDef): THREE.Mesh {
    const tex = this.makeTexture(def);
    // El plano se dimensiona según su distancia para cubrir sobradamente la
    // vista; cuanto más lejos, más grande para no quedarse corto.
    const dist = Math.abs(def.z);
    const w = dist * 3.2;
    const h = dist * 1.9;
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = def.z;
    mesh.renderOrder = -10; // detrás de todo
    return mesh;
  }

  /** Genera la textura de una capa (siluetas de edificios + ventanas neón). */
  private makeTexture(def: LayerDef): THREE.CanvasTexture {
    const W = 1024;
    const H = 512;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // Cielo con un leve degradado (transparente arriba para fundir con la
    // escena; el color de fondo lo pone la escena).
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "rgba(10,15,36,0)");
    sky.addColorStop(1, "rgba(20,14,43,0.4)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // PRNG estable.
    let s = def.seed;
    const rand = (): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };

    // Edificios desde la base (abajo) hacia arriba.
    let x = 0;
    while (x < W) {
      const bw = 40 + rand() * 100;
      const bh = (0.25 + rand() * def.heightFrac) * H;
      const top = H - bh;

      ctx.fillStyle = def.base;
      ctx.fillRect(x, top, bw, bh);
      ctx.fillStyle = def.neon;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, top, bw, 3);
      ctx.globalAlpha = 1;

      // Ventanas.
      const cols = Math.max(1, Math.floor(bw / 14));
      const rows = Math.max(1, Math.floor(bh / 18));
      ctx.fillStyle = def.neon;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rand() > 0.74) {
            ctx.globalAlpha = 0.35 + rand() * 0.45;
            ctx.fillRect(x + 5 + c * 14, top + 8 + r * 18, 6, 9);
          }
        }
      }
      ctx.globalAlpha = 1;
      x += bw + 8 + rand() * 36;
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }
}
