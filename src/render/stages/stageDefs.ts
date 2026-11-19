/**
 * Definiciones visuales de los escenarios (R10.1, R10.4).
 *
 * Cada escenario tiene: cielo (degradado + estrellas + astro), tres capas
 * lejanas pintadas por canvas, seis props animados por prioridad (los N
 * primeros se animan según el nivel `bgAnimations`), luz principal propia y
 * luces intensas para los destellos de lente. Todo procedimental: no hay
 * archivos externos, así que no puede fallar una descarga.
 */
import type { StageId } from "../../engine/game/stages.ts";
import type { AnimatedPropDef } from "./animatedProps.ts";

export interface SkyDef {
  top: string;
  mid: string;
  horizon: string;
  /** Y de escena del horizonte (bajo el suelo ⇒ más cielo). */
  horizonY: number;
  stars: number;
  /** Astro (sol/luna) en coords de escena del plano del cielo. */
  sun: { x: number; y: number; radius: number; color: string } | null;
}

export type LayerStyle =
  | "neonTowers"
  | "neonSkyline"
  | "neonNear"
  | "sunsetMountains"
  | "sunsetRuins"
  | "sunsetForest"
  | "dawnIslands"
  | "dawnCrystals"
  | "dawnTemples"
  | "holoWall";

export interface StageVisualDef {
  id: StageId;
  /** Color de fondo de respaldo (si el cielo no se pudiera dibujar). */
  background: string;
  sky: SkyDef;
  /** Capas lejanas, de más lejos a más cerca. */
  layers: { style: LayerStyle; z: number; parallax: number; seed: number }[];
  key: { color: string; intensity: number };
  fill: { color: string; intensity: number };
  rim: { color: string; intensity: number };
  ambient: number;
  /** Luces intensas visibles (destello de lente). */
  intenseLights: { x: number; y: number; z: number; color: string }[];
  /** Props animados en orden de prioridad (R10.5). */
  props: AnimatedPropDef[];
  /** Color de los bordes emisivos de las plataformas. */
  rimColor: string;
}

const SKY_Z = -4600;
export const SKY_PLANE_Z = SKY_Z;

export const STAGE_VISUALS: Record<StageId, StageVisualDef> = {
  // -------------------------------------------------------------------------
  neonIsland: {
    id: "neonIsland",
    background: "#0a0420",
    sky: {
      top: "#05021a",
      mid: "#2a0a58",
      horizon: "#ff2d8a",
      horizonY: -700,
      stars: 0.5,
      sun: { x: 1300, y: 1500, radius: 260, color: "#ffd6f2" },
    },
    layers: [
      { style: "neonTowers", z: -3600, parallax: 0.1, seed: 11 },
      { style: "neonSkyline", z: -2600, parallax: 0.2, seed: 29 },
      { style: "neonNear", z: -1600, parallax: 0.34, seed: 47 },
    ],
    key: { color: "#ffd0f0", intensity: 1.5 },
    fill: { color: "#3fd8ff", intensity: 0.7 },
    rim: { color: "#ff3dd0", intensity: 1.6 },
    ambient: 0.35,
    intenseLights: [{ x: 1300, y: 1500, z: SKY_Z + 200, color: "#ffb8ec" }],
    rimColor: "#3ff0ff",
    props: [
      { id: "traffic", visual: "hoverTraffic", pose: "drift", period: 9, amplitude: 14, seed: 3, z: -1100, area: { x: 0, y: 150, w: 4200, h: 700 }, color: "#3ff0ff", accent: "#ff4fa8", count: 14 },
      { id: "rain", visual: "rain", pose: "fall", period: 0.9, amplitude: 0, seed: 7, z: 120, area: { x: 0, y: -100, w: 2400, h: 1600 }, color: "#9fd6ff", count: 160, hideWhenStatic: true },
      { id: "billboards", visual: "billboards", pose: "flicker", period: 4, amplitude: 0.7, seed: 5, z: -1300, area: { x: 0, y: 250, w: 3400, h: 600 }, color: "#ff2d8a", accent: "#3ff0ff", count: 5 },
      { id: "holo", visual: "hologram", pose: "spin", period: 10, amplitude: 20, seed: 9, z: -900, area: { x: -900, y: 420, w: 0, h: 0 }, color: "#3ff0ff" },
      { id: "search", visual: "searchlights", pose: "sway", period: 7, amplitude: 0.35, seed: 13, z: -1500, area: { x: 0, y: -700, w: 3000, h: 0 }, color: "#b8a8ff", count: 3 },
      { id: "blimp", visual: "dirigible", pose: "drift", period: 40, amplitude: 25, seed: 17, z: -2000, area: { x: 0, y: 900, w: 6000, h: 0 }, color: "#1a1438", accent: "#ff2d8a", count: 1 },
    ],
  },
  // -------------------------------------------------------------------------
  sunsetIsland: {
    id: "sunsetIsland",
    background: "#ff9a5a",
    sky: {
      top: "#3d4fc2",
      mid: "#ff7d5c",
      horizon: "#ffe08a",
      horizonY: -500,
      stars: 0,
      sun: { x: -900, y: 180, radius: 420, color: "#fff2b0" },
    },
    layers: [
      { style: "sunsetMountains", z: -3600, parallax: 0.1, seed: 5 },
      { style: "sunsetRuins", z: -2500, parallax: 0.2, seed: 21 },
      { style: "sunsetForest", z: -1500, parallax: 0.35, seed: 33 },
    ],
    key: { color: "#ffd49a", intensity: 1.9 },
    fill: { color: "#7da8ff", intensity: 0.5 },
    rim: { color: "#ffb347", intensity: 1.7 },
    ambient: 0.5,
    intenseLights: [{ x: -900, y: 180, z: SKY_Z + 200, color: "#fff0b0" }],
    rimColor: "#ffc861",
    props: [
      { id: "clouds", visual: "clouds", pose: "drift", period: 60, amplitude: 20, seed: 4, z: -2200, area: { x: 0, y: 1000, w: 9000, h: 900 }, color: "#ffd9c0", count: 8 },
      { id: "falls", visual: "waterfall", pose: "fall", period: 1.6, amplitude: 0, seed: 8, z: -1400, area: { x: 1150, y: -350, w: 160, h: 1300 }, color: "#bfe9ff" },
      { id: "birds", visual: "birds", pose: "drift", period: 22, amplitude: 30, seed: 12, z: -1100, area: { x: 0, y: 650, w: 4200, h: 300 }, color: "#3a2440", count: 7 },
      { id: "grass", visual: "grass", pose: "sway", period: 3.5, amplitude: 0.18, seed: 19, z: 90, area: { x: 0, y: -470, w: 2600, h: 0 }, color: "#2f5a28", accent: "#ffd27a", count: 40 },
      { id: "pollen", visual: "pollen", pose: "fall", period: 9, amplitude: 30, seed: 23, z: 60, area: { x: 0, y: -100, w: 2000, h: 1200 }, color: "#ffe9a0", count: 60, hideWhenStatic: true },
      { id: "rays", visual: "sunRays", pose: "pulse", period: 6, amplitude: 0.5, seed: 27, z: -2800, area: { x: -900, y: 180, w: 0, h: 0 }, color: "#ffe6a0", count: 7 },
    ],
  },
  // -------------------------------------------------------------------------
  voidIsland: {
    id: "voidIsland",
    background: "#130c3a",
    sky: {
      top: "#070a2a",
      mid: "#4a2c8f",
      horizon: "#ff9ec7",
      horizonY: -650,
      stars: 0.9,
      sun: { x: 900, y: 1300, radius: 200, color: "#d2f6ff" },
    },
    layers: [
      { style: "dawnIslands", z: -3600, parallax: 0.1, seed: 9 },
      { style: "dawnCrystals", z: -2500, parallax: 0.2, seed: 15 },
      { style: "dawnTemples", z: -1500, parallax: 0.34, seed: 41 },
    ],
    key: { color: "#d9e4ff", intensity: 1.5 },
    fill: { color: "#ff8ad8", intensity: 0.7 },
    rim: { color: "#7fe8ff", intensity: 1.8 },
    ambient: 0.4,
    intenseLights: [{ x: 900, y: 1300, z: SKY_Z + 200, color: "#c8f4ff" }],
    rimColor: "#b48cff",
    props: [
      { id: "aurora", visual: "aurora", pose: "wave", period: 14, amplitude: 60, seed: 2, z: -3000, area: { x: 0, y: 1600, w: 9000, h: 900 }, color: "#5affc8", accent: "#b48cff" },
      { id: "crystals", visual: "crystals", pose: "bob", period: 5, amplitude: 26, seed: 6, z: -900, area: { x: 0, y: 200, w: 3200, h: 700 }, color: "#8ff0ff", accent: "#d6a8ff", count: 7 },
      { id: "lanterns", visual: "lanterns", pose: "fall", period: 18, amplitude: 20, seed: 10, z: -700, area: { x: 0, y: 200, w: 2800, h: 1800 }, color: "#ffb860", count: 24, hideWhenStatic: true },
      { id: "islands", visual: "driftIslands", pose: "bob", period: 9, amplitude: 40, seed: 14, z: -1900, area: { x: 0, y: 500, w: 5200, h: 700 }, color: "#2a1c55", accent: "#7fffd0", count: 5 },
      { id: "shafts", visual: "lightShafts", pose: "pulse", period: 7, amplitude: 0.6, seed: 18, z: -1200, area: { x: 0, y: 600, w: 3600, h: 2000 }, color: "#c7b8ff", count: 4 },
      { id: "waves", visual: "seaWaves", pose: "wave", period: 6, amplitude: 10, seed: 22, z: -1700, area: { x: 0, y: -1200, w: 9000, h: 500 }, color: "#6fd8ff" },
    ],
  },
  // -------------------------------------------------------------------------
  training: {
    id: "training",
    background: "#060d24",
    sky: {
      top: "#040818",
      mid: "#0b1d44",
      horizon: "#1d5fc2",
      horizonY: -600,
      stars: 0,
      sun: null,
    },
    layers: [{ style: "holoWall", z: -2600, parallax: 0.15, seed: 3 }],
    key: { color: "#dbe8ff", intensity: 1.6 },
    fill: { color: "#4d7cff", intensity: 0.6 },
    rim: { color: "#5ff0ff", intensity: 1.5 },
    ambient: 0.45,
    intenseLights: [],
    rimColor: "#4d7cff",
    props: [
      { id: "scan", visual: "scanLine", pose: "scan", period: 5, amplitude: 0, seed: 1, z: -400, area: { x: 0, y: -100, w: 4000, h: 1600 }, color: "#5ff0ff" },
      { id: "panels", visual: "dataPanels", pose: "bob", period: 6, amplitude: 18, seed: 5, z: -800, area: { x: 0, y: 300, w: 3000, h: 500 }, color: "#3fa8ff", accent: "#5ff0ff", count: 5 },
      { id: "spots", visual: "spotlights", pose: "pulse", period: 4, amplitude: 0.5, seed: 9, z: -600, area: { x: 0, y: 900, w: 2600, h: 0 }, color: "#a8c8ff", count: 4 },
      { id: "dust", visual: "dust", pose: "fall", period: 14, amplitude: 20, seed: 13, z: 40, area: { x: 0, y: -100, w: 2400, h: 1400 }, color: "#7fb8ff", count: 50, hideWhenStatic: true },
      { id: "drone", visual: "drone", pose: "drift", period: 16, amplitude: 30, seed: 17, z: -500, area: { x: 0, y: 500, w: 2600, h: 0 }, color: "#5ff0ff", count: 1 },
      { id: "board", visual: "scoreboard", pose: "flicker", period: 5, amplitude: 0.4, seed: 21, z: -1400, area: { x: 0, y: 1000, w: 0, h: 0 }, color: "#5ff0ff" },
    ],
  },
};

export function getStageVisual(id: StageId | undefined): StageVisualDef {
  return (id && STAGE_VISUALS[id]) || STAGE_VISUALS.neonIsland;
}

// ---------------------------------------------------------------------------
// Pintado de capas lejanas (canvas 2D)
// ---------------------------------------------------------------------------

export function makeRand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Pinta una capa en `ctx` (W×H, fondo transparente). */
export function paintLayer(ctx: CanvasRenderingContext2D, W: number, H: number, style: LayerStyle, seed: number): void {
  const r = makeRand(seed);
  switch (style) {
    case "neonTowers":
      return neonBuildings(ctx, W, H, r, { base: "#1a0f3d", glow: "#6a3dff", hMin: 0.35, hMax: 0.85, win: 0.12, spires: true });
    case "neonSkyline":
      return neonBuildings(ctx, W, H, r, { base: "#140a33", glow: "#ff2d8a", hMin: 0.25, hMax: 0.65, win: 0.22, spires: false, signs: true });
    case "neonNear":
      return neonBuildings(ctx, W, H, r, { base: "#0b061f", glow: "#3ff0ff", hMin: 0.2, hMax: 0.5, win: 0.3, spires: false, signs: true });
    case "sunsetMountains":
      return mountains(ctx, W, H, r, "#b0608a", "#ffd7b0", 0.35, true);
    case "sunsetRuins":
      return ruins(ctx, W, H, r);
    case "sunsetForest":
      return forest(ctx, W, H, r);
    case "dawnIslands":
      return floatingIslands(ctx, W, H, r);
    case "dawnCrystals":
      return crystalSpires(ctx, W, H, r);
    case "dawnTemples":
      return temples(ctx, W, H, r);
    case "holoWall":
      return holoWall(ctx, W, H);
  }
}

interface NeonOpts {
  base: string;
  glow: string;
  hMin: number;
  hMax: number;
  win: number;
  spires: boolean;
  signs?: boolean;
}

function neonBuildings(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number, o: NeonOpts): void {
  // Neblina luminosa en la base.
  const haze = ctx.createLinearGradient(0, H * 0.5, 0, H);
  haze.addColorStop(0, "rgba(255,45,138,0)");
  haze.addColorStop(1, hexA(o.glow, 0.25));
  ctx.fillStyle = haze;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);
  let x = -20;
  while (x < W) {
    const bw = 40 + r() * 110;
    const bh = (o.hMin + r() * (o.hMax - o.hMin)) * H;
    const top = H - bh;
    ctx.fillStyle = o.base;
    ctx.fillRect(x, top, bw, bh);
    // Borde de neón superior y lateral.
    ctx.fillStyle = hexA(o.glow, 0.85);
    ctx.fillRect(x, top, bw, 2);
    ctx.fillStyle = hexA(o.glow, 0.35);
    ctx.fillRect(x, top, 2, bh);
    if (o.spires && r() > 0.6) {
      ctx.fillStyle = o.base;
      ctx.beginPath();
      ctx.moveTo(x + bw * 0.35, top);
      ctx.lineTo(x + bw * 0.5, top - 60 - r() * 90);
      ctx.lineTo(x + bw * 0.65, top);
      ctx.fill();
      ctx.fillStyle = "#ff4d6d";
      ctx.fillRect(x + bw * 0.5 - 2, top - 64 - 80 * r(), 4, 4);
    }
    // Ventanas.
    for (let wy = top + 10; wy < H - 6; wy += 14) {
      for (let wx = x + 6; wx < x + bw - 8; wx += 11) {
        if (r() < o.win) {
          ctx.fillStyle = hexA(r() > 0.5 ? o.glow : "#ffe9a8", 0.4 + r() * 0.5);
          ctx.fillRect(wx, wy, 5, 7);
        }
      }
    }
    // Letreros verticales.
    if (o.signs && r() > 0.7) {
      const sh = 40 + r() * 90;
      const sy = top + 20 + r() * Math.max(10, bh * 0.3);
      ctx.fillStyle = hexA(r() > 0.5 ? "#ff2d8a" : "#3ff0ff", 0.9);
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.fillRect(x + bw - 10, sy, 7, sh);
      ctx.shadowBlur = 0;
    }
    x += bw + 4 + r() * 24;
  }
}

function mountains(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number, col: string, snow: string, base: number, haze: boolean): void {
  const baseY = H * (1 - base * 0.5);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, baseY);
  let x = 0;
  const peaks: { x: number; y: number }[] = [];
  while (x < W) {
    const nx = x + 120 + r() * 200;
    const py = baseY - (80 + r() * 200);
    ctx.lineTo((x + nx) / 2, py);
    peaks.push({ x: (x + nx) / 2, y: py });
    ctx.lineTo(nx, baseY - r() * 40);
    x = nx;
  }
  ctx.lineTo(W, H);
  ctx.fill();
  // Nieve con luz de atardecer.
  ctx.fillStyle = hexA(snow, 0.75);
  for (const p of peaks) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - 26, p.y + 40);
    ctx.lineTo(p.x + 10, p.y + 30);
    ctx.lineTo(p.x + 30, p.y + 44);
    ctx.fill();
  }
  if (haze) {
    const g = ctx.createLinearGradient(0, baseY - 100, 0, H);
    g.addColorStop(0, "rgba(255,200,150,0)");
    g.addColorStop(1, "rgba(255,200,150,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, baseY - 100, W, H);
  }
}

function ruins(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number): void {
  mountains(ctx, W, H, r, "#8a4a5e", "#ffcf9a", 0.5, false);
  // Templo en ruinas sobre un risco: columnas y arcos con borde dorado.
  const baseY = H * 0.62;
  for (let k = 0; k < 3; k++) {
    const cx = W * (0.15 + k * 0.33) + r() * 60;
    const cols = 4 + Math.floor(r() * 4);
    ctx.fillStyle = "#5a2f3f";
    ctx.fillRect(cx - 20, baseY + 10, cols * 30 + 40, 16);
    for (let i = 0; i < cols; i++) {
      const h = 60 + r() * 70 * (r() > 0.3 ? 1 : 0.4);
      const x = cx + i * 30;
      ctx.fillStyle = "#5a2f3f";
      ctx.fillRect(x, baseY + 10 - h, 12, h);
      ctx.fillStyle = "rgba(255,210,122,0.8)";
      ctx.fillRect(x, baseY + 10 - h, 2, h);
    }
    ctx.strokeStyle = "#5a2f3f";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx + cols * 15, baseY - 110, cols * 14, Math.PI, 0);
    ctx.stroke();
  }
}

function forest(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number): void {
  const baseY = H * 0.78;
  ctx.fillStyle = "#2a2040";
  ctx.fillRect(0, baseY, W, H - baseY);
  for (let x = -10; x < W; x += 14 + r() * 20) {
    const h = 60 + r() * 120;
    ctx.fillStyle = r() > 0.5 ? "#2c2445" : "#352a4a";
    ctx.beginPath();
    ctx.moveTo(x - 22, baseY + 4);
    ctx.lineTo(x, baseY - h);
    ctx.lineTo(x + 22, baseY + 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255,190,110,0.55)";
    ctx.beginPath();
    ctx.moveTo(x, baseY - h);
    ctx.lineTo(x - 4, baseY - h + 30);
    ctx.lineTo(x - 22, baseY + 4);
    ctx.lineTo(x - 18, baseY + 4);
    ctx.fill();
  }
}

function floatingIslands(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number): void {
  for (let i = 0; i < 6; i++) {
    const cx = r() * W;
    const cy = H * (0.25 + r() * 0.45);
    const w = 60 + r() * 140;
    ctx.fillStyle = "#3b2a78";
    ctx.beginPath();
    ctx.ellipse(cx, cy, w, w * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - w, cy);
    ctx.lineTo(cx, cy + w * 0.9);
    ctx.lineTo(cx + w, cy);
    ctx.fill();
    ctx.fillStyle = "rgba(127,255,208,0.55)";
    ctx.fillRect(cx - w * 0.8, cy - 3, w * 1.6, 3);
    // Cascada que cae del borde.
    const g = ctx.createLinearGradient(0, cy, 0, cy + 200);
    g.addColorStop(0, "rgba(180,230,255,0.6)");
    g.addColorStop(1, "rgba(180,230,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx + w * 0.4, cy, 6, 200);
  }
}

function crystalSpires(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number): void {
  for (let x = 0; x < W; x += 40 + r() * 90) {
    const h = 80 + r() * 260;
    const w = 20 + r() * 40;
    const g = ctx.createLinearGradient(x, H - h, x, H);
    g.addColorStop(0, "rgba(160,240,255,0.85)");
    g.addColorStop(1, "rgba(90,60,170,0.9)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, H);
    ctx.lineTo(x, H - h);
    ctx.lineTo(x + w / 2, H);
    ctx.fill();
    ctx.strokeStyle = "rgba(220,250,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, H - h);
    ctx.lineTo(x + w * 0.1, H);
    ctx.stroke();
  }
}

function temples(ctx: CanvasRenderingContext2D, W: number, H: number, r: () => number): void {
  const baseY = H * 0.8;
  ctx.fillStyle = "#1c1240";
  ctx.fillRect(0, baseY, W, H - baseY);
  for (let k = 0; k < 4; k++) {
    const cx = W * (0.1 + k * 0.27) + r() * 40;
    const tiers = 2 + Math.floor(r() * 3);
    let y = baseY;
    for (let t = 0; t < tiers; t++) {
      const w = 120 - t * 26;
      const h = 34;
      ctx.fillStyle = "#24164f";
      ctx.fillRect(cx - w / 2 + 10, y - h, w - 20, h);
      ctx.beginPath();
      ctx.moveTo(cx - w / 2 - 14, y - h);
      ctx.lineTo(cx, y - h - 26);
      ctx.lineTo(cx + w / 2 + 14, y - h);
      ctx.fill();
      // Linternas.
      ctx.fillStyle = "rgba(255,184,96,0.95)";
      ctx.shadowColor = "#ffb860";
      ctx.shadowBlur = 10;
      ctx.fillRect(cx - w / 2 + 16, y - h + 10, 5, 7);
      ctx.fillRect(cx + w / 2 - 21, y - h + 10, 5, 7);
      ctx.shadowBlur = 0;
      y -= h + 22;
    }
  }
}

function holoWall(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.strokeStyle = "rgba(95,240,255,0.18)";
  ctx.lineWidth = 1.5;
  const s = 34;
  for (let row = 0; row * s * 0.86 < H + s; row++) {
    for (let col = 0; col * s * 1.5 < W + s; col++) {
      const cx = col * s * 1.5;
      const cy = row * s * 1.72 + (col % 2) * s * 0.86;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = cx + Math.cos(a) * s * 0.9;
        const py = cy + Math.sin(a) * s * 0.9;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(4,8,24,0.7)");
  g.addColorStop(0.6, "rgba(4,8,24,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** "#rrggbb" + alpha → "rgba(...)". */
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
