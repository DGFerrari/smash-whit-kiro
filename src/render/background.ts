import type { Camera } from "./camera.ts";

/**
 * Fondo de ciudad neón por CAPAS con parallax, para dar sensación de 3D al
 * mover la cámara. Cada capa se dibuja en espacio de PANTALLA y se desplaza una
 * fracción del movimiento de la cámara: las capas lejanas se mueven poco (factor
 * bajo) y las cercanas mucho (factor alto). Es puramente visual.
 *
 * Las capas son procedurales (siluetas de edificios generadas con una semilla
 * estable), así no necesitamos assets. Colores apagados para "no chillar".
 */

interface Building {
  x: number; // posición en el "mundo" de la capa (px)
  w: number;
  h: number;
  /** Ventanas encendidas: columnas x filas con un patrón estable. */
  litSeed: number;
}

interface Layer {
  /** Fracción del desplazamiento de cámara (0 = fijo, 1 = igual que el mundo). */
  parallax: number;
  /** Color base de las siluetas de esta capa. */
  color: string;
  /** Color del neón (bordes/ventanas) de esta capa. */
  neon: string;
  /** Altura base de los edificios (fracción de la pantalla desde abajo). */
  baseHeight: number;
  /** Separación horizontal del patrón que se repite (px). */
  tile: number;
  buildings: Building[];
}

export class Background {
  private readonly layers: Layer[];

  constructor() {
    // De lejos (arriba, tenue) a cerca (abajo, saturado).
    this.layers = [
      this.makeLayer(0.08, "#121a33", "#26407a", 0.28, 520, 11),
      this.makeLayer(0.16, "#16203f", "#2f5bd0", 0.4, 460, 29),
      this.makeLayer(0.3, "#1b2650", "#8a3df0", 0.55, 400, 47),
      this.makeLayer(0.5, "#202a4d", "#ff3d8b", 0.7, 360, 83),
    ];
  }

  private makeLayer(
    parallax: number,
    color: string,
    neon: string,
    baseHeight: number,
    tile: number,
    seed: number,
  ): Layer {
    // Generamos una tira ancha de edificios que luego repetimos (tiling).
    const buildings: Building[] = [];
    let x = 0;
    const span = tile;
    let s = seed;
    const rand = (): number => {
      // PRNG simple y estable (LCG) para siluetas reproducibles.
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    while (x < span) {
      const w = 40 + rand() * 90;
      const h = 60 + rand() * 220;
      buildings.push({ x, w, h, litSeed: Math.floor(rand() * 10000) });
      x += w + 10 + rand() * 40;
    }
    return { parallax, color, neon, baseHeight, tile: x, buildings };
  }

  /** Dibuja el cielo y todas las capas de edificios con parallax. */
  draw(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number): void {
    this.drawSky(ctx, w, h);

    for (const layer of this.layers) {
      this.drawLayer(ctx, layer, camera, w, h);
    }

    // Veladura inferior para fundir el fondo con la zona de juego.
    const grad = ctx.createLinearGradient(0, h * 0.55, 0, h);
    grad.addColorStop(0, "rgba(6,10,20,0)");
    grad.addColorStop(1, "rgba(6,10,20,0.75)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
  }

  private drawSky(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0a0f24");
    grad.addColorStop(0.5, "#141033");
    grad.addColorStop(1, "#1a0e2b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Un resplandor suave de ciudad en el horizonte.
    const glow = ctx.createRadialGradient(
      w * 0.5,
      h * 0.72,
      0,
      w * 0.5,
      h * 0.72,
      w * 0.6,
    );
    glow.addColorStop(0, "rgba(120, 60, 180, 0.18)");
    glow.addColorStop(1, "rgba(120, 60, 180, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    camera: Camera,
    w: number,
    h: number,
  ): void {
    // Desplazamiento de parallax a partir del foco de la cámara. Dividimos para
    // convertir el movimiento de mundo en un desplazamiento suave de pantalla.
    const offX = -camera.focusX * layer.parallax * 0.5;
    // Un poco de parallax vertical también (más sutil).
    const offY = (camera.focusY - 200) * layer.parallax * 0.12;

    const baseY = h - h * (layer.baseHeight * 0.5) + offY;

    ctx.save();
    // Repetimos el patrón de edificios para cubrir toda la pantalla.
    const tile = layer.tile;
    // Normalizamos el offset al rango del tile para no dibujar de más.
    let startX = (offX % tile) - tile;

    for (let tx = startX; tx < w + tile; tx += tile) {
      for (const b of layer.buildings) {
        const bx = tx + b.x;
        if (bx + b.w < 0 || bx > w) continue;
        this.drawBuilding(ctx, layer, b, bx, baseY, h);
      }
    }
    ctx.restore();
  }

  private drawBuilding(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    b: Building,
    bx: number,
    baseY: number,
    h: number,
  ): void {
    const top = baseY - b.h;

    // Silueta.
    ctx.fillStyle = layer.color;
    ctx.fillRect(bx, top, b.w, h - top);

    // Borde neón superior.
    ctx.fillStyle = layer.neon;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(bx, top, b.w, 2);
    ctx.globalAlpha = 1;

    // Ventanas encendidas (patrón estable por semilla).
    const cols = Math.max(1, Math.floor(b.w / 12));
    const rows = Math.max(1, Math.floor(b.h / 16));
    let s = b.litSeed;
    const rand = (): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    ctx.fillStyle = layer.neon;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rand() > 0.72) {
          const wx = bx + 4 + c * 12;
          const wy = top + 6 + r * 16;
          ctx.globalAlpha = 0.35 + rand() * 0.4;
          ctx.fillRect(wx, wy, 5, 7);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
