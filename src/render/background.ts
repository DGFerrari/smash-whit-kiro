import * as THREE from "three";
import type { Camera } from "./camera.ts";
import type { StageBackdrop } from "../engine/game/stages.ts";

/**
 * Fondo por CAPAS en 3D. Colocamos planos a distintas PROFUNDIDADES (Z) y
 * dejamos que la perspectiva de la cámara genere el parallax: las capas lejanas
 * (Z muy negativa) se mueven poco; las cercanas, más. Cada capa es un plano
 * grande con una textura generada por canvas.
 *
 * Soporta varios ESTILOS (backdrop), cada uno con su propio dibujo de capas:
 *  - neonCity: skyline de ciudad neón (isla Neón).
 *  - meadow: cielo pastel con colinas lejanas (isla Pradera).
 *  - sanctuary: cielo nuboso pastel con mar, montaña y sol (isla Santuario).
 *  - grid: oculto (lo usa el escenario de entrenamiento; el renderer dibuja la
 *    rejilla y un color de fondo plano).
 *
 * Al cambiar de backdrop se REGENERAN las texturas de las capas, así cada
 * escenario tiene un fondo claramente distinto (no un simple tinte).
 */

interface LayerDef {
  z: number; // profundidad (más negativo = más lejos)
  seed: number;
  /** Cuánto sigue este plano al foco de la cámara (0 = quieto, 1 = pegado). */
  parallax: number;
}

/** 4 capas a distintas profundidades; la textura la decide el backdrop. */
/**
 * Capas, de más LEJOS a más CERCA. Más alejadas que antes (Z más negativa) y
 * con un `parallax` por capa: cuánto SIGUE cada plano al foco de la cámara.
 *  - parallax 0 = clavado al mundo (se queda quieto; la cámara lo "sobrevuela").
 *  - parallax 1 = pegado a la cámara (parece estático respecto a la pantalla).
 * Valores bajos en las capas lejanas y algo más altos en las cercanas dan la
 * sensación de profundidad: al moverte, el fondo se desplaza (antes se movían
 * todas con la cámara 1:1, así que casi no se notaba).
 */
const LAYERS: LayerDef[] = [
  { z: -3800, seed: 11, parallax: 0.08 },
  { z: -2900, seed: 29, parallax: 0.16 },
  { z: -2000, seed: 47, parallax: 0.26 },
  { z: -1200, seed: 83, parallax: 0.4 },
];

export class Background3D {
  private readonly group = new THREE.Group();
  private readonly planes: THREE.Mesh[] = [];
  private backdrop: StageBackdrop = "neonCity";

  constructor(private readonly scene: THREE.Scene) {
    for (const def of LAYERS) {
      const plane = this.buildLayer(def);
      this.planes.push(plane);
      this.group.add(plane);
    }
    this.scene.add(this.group);
    this.applyBackdrop("neonCity");
  }

  /** Elige el estilo de fondo. "grid" lo oculta; el resto regenera capas. */
  setBackdrop(backdrop: StageBackdrop): void {
    if (backdrop === this.backdrop) {
      this.group.visible = backdrop !== "grid";
      return;
    }
    this.backdrop = backdrop;
    this.applyBackdrop(backdrop);
  }

  private applyBackdrop(backdrop: StageBackdrop): void {
    const visible = backdrop !== "grid";
    this.group.visible = visible;
    if (!visible) return;
    this.planes.forEach((plane, i) => {
      const def = LAYERS[i];
      const depth = i / (LAYERS.length - 1); // 0 = más lejos, 1 = más cerca
      const tex = this.makeTexture(backdrop, def, depth);
      const mat = plane.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.map = tex;
      mat.color.setHex(0xffffff);
      mat.needsUpdate = true;
    });
  }

  /**
   * Coloca cada capa con PARALLAX: sigue al foco de la cámara solo una fracción
   * (`parallax`). Las capas lejanas se quedan casi clavadas al mundo, así que
   * al moverse la cámara el fondo se desplaza respecto a la escena (sensación
   * de profundidad). Al no seguir 1:1 a la cámara, los planos deben ser grandes
   * (ver buildLayer) para no enseñar los bordes.
   */
  update(camera: Camera): void {
    if (this.backdrop === "grid") return;
    const fx = camera.focusX;
    const fy = -camera.focusY; // a coords de escena
    this.planes.forEach((plane, i) => {
      const k = LAYERS[i].parallax;
      plane.position.x = fx * k;
      plane.position.y = fy * k;
    });
  }

  private buildLayer(def: LayerDef): THREE.Mesh {
    const dist = Math.abs(def.z);
    // Planos MÁS GRANDES: al estar más lejos y moverse con parallax (no pegados
    // a la cámara), tienen que cubrir de sobra la vista para que NO se vean los
    // bordes ni al alejar el zoom ni al desplazarse el foco.
    const w = dist * 5.0;
    const h = dist * 3.0;
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = def.z;
    mesh.renderOrder = -10; // detrás de todo
    return mesh;
  }

  /** Genera la textura de una capa según el estilo de fondo. */
  private makeTexture(
    backdrop: StageBackdrop,
    def: LayerDef,
    depth: number,
  ): THREE.CanvasTexture {
    const W = 1024;
    const H = 512;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // PRNG estable por capa.
    let s = def.seed;
    const rand = (): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };

    switch (backdrop) {
      case "meadow":
        this.drawMeadow(ctx, W, H, depth, rand);
        break;
      case "sanctuary":
        this.drawSanctuary(ctx, W, H, depth, rand);
        break;
      case "neonCity":
      default:
        this.drawNeonCity(ctx, W, H, depth, rand);
        break;
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  // --- Estilos de fondo -----------------------------------------------------

  /** Ciudad neón: siluetas de edificios con ventanas luminosas. */
  private drawNeonCity(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    depth: number,
    rand: () => number,
  ): void {
    // Paleta por profundidad: las capas cercanas más saturadas.
    const bases = ["#121a33", "#16203f", "#1b2650", "#202a4d"];
    const neons = ["#26407a", "#2f5bd0", "#8a3df0", "#ff3d8b"];
    const idx = Math.round(depth * 3);
    const base = bases[idx];
    const neon = neons[idx];
    const heightFrac = 0.45 + depth * 0.45;

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "rgba(10,15,36,0)");
    sky.addColorStop(1, "rgba(20,14,43,0.4)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    let x = 0;
    while (x < W) {
      const bw = 40 + rand() * 100;
      const bh = (0.25 + rand() * heightFrac) * H;
      const top = H - bh;
      ctx.fillStyle = base;
      ctx.fillRect(x, top, bw, bh);
      ctx.fillStyle = neon;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, top, bw, 3);
      ctx.globalAlpha = 1;
      const cols = Math.max(1, Math.floor(bw / 14));
      const rows = Math.max(1, Math.floor(bh / 18));
      ctx.fillStyle = neon;
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
  }

  /** Pradera: cielo pastel claro con colinas verdes lejanas y alguna nube. */
  private drawMeadow(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    depth: number,
    rand: () => number,
  ): void {
    // Cielo: azul muy suave arriba, casi blanco cálido abajo.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "rgba(150,195,225,0.55)");
    sky.addColorStop(0.6, "rgba(206,224,235,0.35)");
    sky.addColorStop(1, "rgba(232,240,228,0.25)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Nubes suaves (más en las capas lejanas).
    const clouds = depth < 0.6 ? 3 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 2);
    for (let i = 0; i < clouds; i++) {
      const cx = rand() * W;
      const cy = H * (0.1 + rand() * 0.4);
      const r = 26 + rand() * 60;
      this.softBlob(ctx, cx, cy, r, "rgba(255,255,255,0.55)");
    }

    // Colinas verdes en el horizonte (más altas y oscuras cuanto más cerca).
    const hillColors = ["#9bc47f", "#84b667", "#6fa551", "#5c9344"];
    const col = hillColors[Math.round(depth * 3)];
    const baseY = H * (0.72 - depth * 0.12);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, baseY);
    let x = 0;
    while (x < W) {
      const peak = baseY - (20 + rand() * 70) * (0.5 + depth);
      const nx = x + 80 + rand() * 160;
      ctx.quadraticCurveTo((x + nx) / 2, peak, nx, baseY - rand() * 20);
      x = nx;
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Santuario: cielo nuboso pastel con un sol tenue, montaña y mar al fondo. */
  private drawSanctuary(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    depth: number,
    rand: () => number,
  ): void {
    // Cielo rosado-azulado pastel.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "rgba(201,214,232,0.55)");
    sky.addColorStop(0.5, "rgba(232,210,220,0.4)");
    sky.addColorStop(1, "rgba(244,228,224,0.3)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sol/brillo suave (solo en la capa más lejana).
    if (depth < 0.35) {
      this.softBlob(ctx, W * 0.3, H * 0.28, 150, "rgba(255,248,224,0.5)");
    }

    // Montaña rosada al fondo (capas lejanas).
    if (depth < 0.6) {
      ctx.fillStyle = "rgba(196,150,160,0.5)";
      ctx.beginPath();
      ctx.moveTo(W * 0.55, H * 0.72);
      ctx.lineTo(W * 0.82, H * 0.3);
      ctx.lineTo(W * 1.05, H * 0.72);
      ctx.closePath();
      ctx.fill();
    }

    // Nubes esponjosas pastel.
    const clouds = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < clouds; i++) {
      const cx = rand() * W;
      const cy = H * (0.08 + rand() * 0.5);
      const r = 30 + rand() * 70;
      this.softBlob(ctx, cx, cy, r, "rgba(255,255,255,0.6)");
      this.softBlob(ctx, cx + r * 0.7, cy + r * 0.2, r * 0.7, "rgba(255,255,255,0.5)");
    }

    // Mar turquesa claro en la franja inferior (capas cercanas).
    if (depth > 0.4) {
      const seaY = H * 0.74;
      const sea = ctx.createLinearGradient(0, seaY, 0, H);
      sea.addColorStop(0, "rgba(150,210,205,0.55)");
      sea.addColorStop(1, "rgba(120,185,190,0.5)");
      ctx.fillStyle = sea;
      ctx.fillRect(0, seaY, W, H - seaY);
      // Espuma/orilla clara.
      ctx.fillStyle = "rgba(235,245,240,0.5)";
      ctx.fillRect(0, seaY, W, 6);
    }
  }

  /** Dibuja un círculo con degradado radial suave (nube/sol). */
  private softBlob(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    color: string,
  ): void {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
