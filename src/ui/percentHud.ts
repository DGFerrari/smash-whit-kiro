/**
 * HUD de combate KiroBrawl (R5), dibujado en el canvas 2D en espacio de
 * pantalla. Paneles inferiores estilo arcade: placa inclinada del color del
 * jugador, retrato que rompe el marco, porcentaje enorme en cursiva con la
 * tipografía display, iconos de vida y barra de furia.
 *
 * La lógica (texto, color `t`, sacudida, roturas, furia, reparto) vive en
 * `hudModel.ts`; aquí solo se pinta. Los colores y fuentes salen de los tokens
 * del Sistema_Diseño leídos con `getComputedStyle`.
 */
import { createCharacterPortrait } from "./brand/portraits.ts";
import { PORTRAIT_CROP, portraitImageUrl } from "../content/portraitImages.ts";
import {
  HudAnimTracker,
  buildHudPanel,
  layoutColumns,
  type HudColumn,
  type HudPanel,
} from "./hudModel.ts";

export interface PercentEntry {
  /** Etiqueta corta, p. ej. "P1", "CPU", "DUMMY". */
  label: string;
  /** Color identificativo del combatiente (debe casar con su color en el juego). */
  color: string;
  /** Daño acumulado en %. */
  damage: number;
  /** Vidas restantes. Usa -1 para no mostrar medidor de vidas (p. ej. dummy). */
  lives: number;
  /** Animación de entrada/salida de la tarjeta [0..1] (1 = en su sitio). */
  anim?: number;
  /** Carga de furia [0..1] (mientras se llena). */
  fury?: number;
  /** ¿Modo furia activo? */
  furyActive?: boolean;
  /** Fracción de efecto de furia restante [0..1] mientras está activo. */
  furyRemaining?: number;
  /** Id de personaje: nombre visible (lore) y retrato. */
  characterId?: string;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface HudTokens {
  neutral: string;
  danger: string;
  focus: string;
  secondary: string;
  bg: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  fontDisplay: string;
  fontText: string;
  percentSize: number;
}

const FALLBACK: HudTokens = {
  neutral: "#f4f6ff",
  danger: "#ff3b3b",
  focus: "#ffd60a",
  secondary: "#ff3d8b",
  bg: "#0b0e1f",
  surface: "#161b36",
  border: "#3a4478",
  text: "#f4f6ff",
  textMuted: "#a9b2d9",
  fontDisplay: '"Russo One", "Arial Black", system-ui, sans-serif',
  fontText: '"Rajdhani", "Segoe UI", system-ui, sans-serif',
  percentSize: 44,
};

let tokenCache: HudTokens | null = null;
let observing = false;

/** Tokens del HUD (se leen una vez y se releen si cambian atributos de <html>). */
export function hudTokens(): HudTokens {
  if (tokenCache) return tokenCache;
  const t: HudTokens = { ...FALLBACK };
  try {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const v = (name: string): string => cs.getPropertyValue(name).trim();
    const pick = (name: string, fb: string): string => v(name) || fb;
    t.neutral = pick("--color-hud-neutral", t.neutral);
    t.danger = pick("--color-danger", t.danger);
    t.focus = pick("--color-focus", t.focus);
    t.secondary = pick("--color-secondary", t.secondary);
    t.bg = pick("--color-bg", t.bg);
    t.surface = pick("--color-surface", t.surface);
    t.border = pick("--color-border", t.border);
    t.text = pick("--color-text", t.text);
    t.textMuted = pick("--color-text-muted", t.textMuted);
    t.fontDisplay = pick("--font-display", t.fontDisplay);
    t.fontText = pick("--font-text", t.fontText);
    const size = parseFloat(v("--fs-hud-percent"));
    if (Number.isFinite(size) && size > 0) t.percentSize = size;
    if (!observing && typeof MutationObserver !== "undefined") {
      observing = true;
      new MutationObserver(() => {
        tokenCache = null;
      }).observe(root, { attributes: true });
    }
  } catch {
    /* sin DOM: valores de respaldo */
  }
  tokenCache = t;
  return t;
}

function reducedMotion(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-reduced-motion");
}

// ---------------------------------------------------------------------------
// Color: interpolación OKLab
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function parseHex(c: string): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]: RGB): RGB {
  const lr = toLin(r), lg = toLin(g), lb = toLin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, A, B]: RGB): RGB {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const f = (x: number): number => Math.min(1, Math.max(0, toSrgb(x)));
  return [
    f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    f(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    f(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const labCache = new Map<string, RGB>();
function lab(c: string, fb: string): RGB {
  let v = labCache.get(c);
  if (!v) {
    v = rgbToOklab(parseHex(c) ?? parseHex(fb) ?? [1, 1, 1]);
    labCache.set(c, v);
  }
  return v;
}

/** Mezcla `a`→`b` en OKLab con `t` ∈ [0,1]; devuelve `rgb(...)`. */
export function mixOklab(a: string, b: string, t: number): string {
  const A = lab(a, FALLBACK.neutral);
  const B = lab(b, FALLBACK.danger);
  const k = Math.min(1, Math.max(0, t));
  const [r, g, bl] = oklabToRgb([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(bl * 255)})`;
}

// ---------------------------------------------------------------------------
// Retratos (SVG rasterizado una vez por personaje)
// ---------------------------------------------------------------------------

interface HudPortrait {
  img: HTMLImageElement;
  /** Fracción superior de la imagen que se dibuja (1 = entera). */
  crop: number;
}

const portraitCache = new Map<string, HudPortrait | null>();

/** Retrato SVG dibujado por código, rasterizado como imagen. */
function svgPortrait(id: string): HudPortrait | null {
  try {
    const svg = createCharacterPortrait(id, { inlineTokens: true, decorative: true });
    // Una imagen dentro de un SVG rasterizado no carga: se quita y se deja la silueta.
    svg.querySelector("image")?.remove();
    svg.querySelectorAll("[display]").forEach((el) => el.removeAttribute("display"));
    // Tamaño intrínseco explícito (×2 para que se vea nítido): sin width/height
    // algunos navegadores rasterizan el SVG a 300×150 (recortado) o a 0×0 (no
    // se dibuja nunca). Proporción = la del viewBox.
    const vb = (svg.getAttribute("viewBox") ?? "0 0 200 240").split(/\s+/).map(Number);
    const vw = vb[2] || 200;
    const vh = vb[3] || 240;
    svg.setAttribute("width", String(vw * 2));
    svg.setAttribute("height", String(vh * 2));
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.removeAttribute("class");
    const src = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onerror = () => portraitCache.set(id, null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
    return { img, crop: 1 };
  } catch {
    return null;
  }
}

function portraitImage(id: string | undefined): HudPortrait | null {
  if (!id) return null;
  if (portraitCache.has(id)) {
    const p = portraitCache.get(id)!;
    return p && p.img.complete && p.img.naturalWidth > 0 ? p : null;
  }
  const url = portraitImageUrl(id);
  if (url) {
    // Imagen (PNG/JPG/WebP/SVG); si falla, se cae al SVG procedimental.
    const img = new Image();
    img.onerror = () => portraitCache.set(id, svgPortrait(id));
    img.src = url;
    portraitCache.set(id, { img, crop: PORTRAIT_CROP });
  } else {
    portraitCache.set(id, svgPortrait(id));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------

const tracker = new HudAnimTracker();
let layoutKey = "";
let layout: HudColumn[] = [];

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    layoutKey = "";
  });
}

const PANEL_H = 92;
const SLANT = 16;
const BOTTOM = 18;

export function drawPercentHud(
  ctx: CanvasRenderingContext2D,
  entries: PercentEntry[],
  screenW: number,
  screenH: number,
): void {
  if (entries.length === 0) {
    tracker.reset();
    return;
  }
  const key = `${entries.length}|${screenW}`;
  if (key !== layoutKey) {
    layoutKey = key;
    layout = layoutColumns(entries.length, screenW);
  }
  const now = performance.now();
  const rm = reducedMotion();
  tracker.update(entries, now);
  const tk = hudTokens();
  const y = screenH - PANEL_H - BOTTOM;

  entries.forEach((e, i) => {
    const col = layout[i];
    if (!col) return;
    const anim = e.anim ?? 1;
    const ay = y + (1 - easeOutBack(anim)) * (PANEL_H + 70);
    drawPanel(ctx, buildHudPanel(e), i, col.x, ay, col.w, anim, now, rm, tk);
  });
}

/** Easing con pequeño rebote al asentarse. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Paralelogramo inclinado (borde izquierdo y derecho a 'slant'). */
function slantPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x + s, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - s, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  p: HudPanel,
  i: number,
  x: number,
  y: number,
  w: number,
  alpha: number,
  now: number,
  rm: boolean,
  tk: HudTokens,
): void {
  const h = PANEL_H;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  // Placa base oscura + placa de color inclinada.
  slantPath(ctx, x, y, w, h, SLANT);
  const base = ctx.createLinearGradient(x, y, x + w, y);
  base.addColorStop(0, p.color);
  base.addColorStop(0.42, tk.surface);
  base.addColorStop(1, tk.bg);
  ctx.fillStyle = base;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 2;
  ctx.strokeStyle = tk.border;
  ctx.stroke();
  // Franja de color superior.
  slantPath(ctx, x + SLANT * 0.5, y, w - SLANT * 0.5, 5, 2);
  ctx.fillStyle = p.color;
  ctx.fill();

  // Retrato que rompe el marco por arriba.
  const portW = Math.min(w * 0.34, 110);
  const portH = h + 34;
  const portrait = portraitImage(p.characterId);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + SLANT, y - 34);
  ctx.lineTo(x + SLANT + portW, y - 34);
  ctx.lineTo(x + portW, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.clip();
  if (p.portraitDimmed) {
    ctx.globalAlpha *= 0.5;
    ctx.filter = "grayscale(1)";
  }
  if (portrait) {
    const { img, crop } = portrait;
    const sh = img.naturalHeight * crop;
    const scale = portH / sh;
    const iw = img.naturalWidth * scale;
    ctx.drawImage(img, 0, 0, img.naturalWidth, sh, x + SLANT / 2 + (portW - iw) / 2, y + h - portH, iw, portH);
  } else {
    // Respaldo: disco del color del jugador con su inicial.
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x + portW / 2 + 6, y + h / 2, h * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tk.bg;
    ctx.font = `400 28px ${tk.fontDisplay}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.name.charAt(0).toUpperCase(), x + portW / 2 + 6, y + h / 2 + 1);
  }
  ctx.restore();

  const right = x + w - SLANT - 10;

  // Porcentaje: cursiva display, contorno oscuro y degradado neutro→daño.
  const shake = tracker.shake(i, now, rm);
  let dmgColor = mixOklab(tk.neutral, tk.danger, p.t);
  if (shake.pulse > 0 && rm) dmgColor = mixOklab(dmgColor, tk.focus, shake.pulse * 0.8);
  const num = p.percentText.slice(0, -1);
  const big = tk.percentSize;
  const small = Math.round(big * 0.5);
  const baseY = y + h - 30;
  ctx.save();
  ctx.translate(right + shake.offsetX, baseY + shake.offsetY);
  ctx.scale(shake.scale, shake.scale);
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.font = `italic 400 ${small}px ${tk.fontDisplay}`;
  const pctW = ctx.measureText("%").width;
  ctx.font = `italic 400 ${big}px ${tk.fontDisplay}`;
  const grad = ctx.createLinearGradient(0, -big, 0, 0);
  grad.addColorStop(0, mixOklab(dmgColor, tk.neutral, 0.45));
  grad.addColorStop(1, dmgColor);
  ctx.lineWidth = 7;
  ctx.strokeStyle = tk.bg;
  ctx.strokeText(num, -pctW - 2, 0);
  ctx.fillStyle = grad;
  ctx.fillText(num, -pctW - 2, 0);
  ctx.font = `italic 400 ${small}px ${tk.fontDisplay}`;
  ctx.lineWidth = 5;
  ctx.strokeText("%", 0, 0);
  ctx.fillText("%", 0, 0);
  ctx.restore();

  // Nombre visible + etiqueta del jugador.
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 16px ${tk.fontText}`;
  ctx.fillStyle = tk.text;
  ctx.lineWidth = 3;
  ctx.strokeStyle = tk.bg;
  const nameY = y + h - 12;
  ctx.strokeText(p.name.toUpperCase(), right - 2, nameY);
  ctx.fillText(p.name.toUpperCase(), right - 2, nameY);
  ctx.textAlign = "left";
  ctx.font = `700 13px ${tk.fontText}`;
  ctx.fillStyle = p.color;
  ctx.strokeText(p.label, x + portW + 2, y + 22);
  ctx.fillText(p.label, x + portW + 2, y + 22);

  // Vidas: iconos individuales (arriba a la derecha) + roturas en curso.
  if (p.showLives) drawStocks(ctx, p, i, right, y + 16, now, tk);

  // Barra de furia en la base de la placa.
  drawFury(ctx, p, x, y + h - 6, w, now, tk);

  ctx.restore();
}

function drawStocks(
  ctx: CanvasRenderingContext2D,
  p: HudPanel,
  i: number,
  right: number,
  cy: number,
  now: number,
  tk: HudTokens,
): void {
  const r = 5.5;
  const step = 15;
  const posX = (k: number): number => right - r - k * step;
  ctx.lineWidth = 2;
  ctx.strokeStyle = tk.bg;
  for (let k = 0; k < p.livesActive; k++) {
    ctx.beginPath();
    ctx.arc(posX(k), cy, r, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.stroke();
  }
  // Rotura en 4 fragmentos que salen despedidos y se desvanecen (R5.5).
  for (const b of tracker.breaks(i, now)) {
    const cx = posX(b.index);
    const d = 4 + b.p * 16;
    ctx.save();
    ctx.globalAlpha *= 1 - b.p;
    ctx.fillStyle = p.color;
    for (let q = 0; q < 4; q++) {
      const a = Math.PI / 4 + (q * Math.PI) / 2;
      const fx = cx + Math.cos(a) * d;
      const fy = cy + Math.sin(a) * d + b.p * b.p * 10;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.arc(fx, fy, r, a + Math.PI * 0.75, a + Math.PI * 1.25);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawFury(
  ctx: CanvasRenderingContext2D,
  p: HudPanel,
  x: number,
  y: number,
  w: number,
  now: number,
  tk: HudTokens,
): void {
  const bx = x + SLANT * 0.6;
  const bw = w - SLANT * 1.6;
  const bh = 6;
  ctx.save();
  slantPath(ctx, bx, y, bw, bh, 3);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();
  if (p.furyFill > 0) {
    slantPath(ctx, bx, y, Math.max(4, bw * p.furyFill), bh, 3);
    if (p.furyState === "active") {
      const shift = (now / 600) % 1;
      const g = ctx.createLinearGradient(bx - bw * shift, 0, bx + bw * (2 - shift), 0);
      for (let s = 0; s <= 4; s++) {
        g.addColorStop(s / 4, [tk.danger, tk.focus, tk.secondary, tk.focus, tk.danger][s]);
      }
      ctx.fillStyle = g;
      ctx.shadowColor = tk.danger;
      ctx.shadowBlur = 16;
    } else {
      ctx.fillStyle = p.color;
    }
    ctx.fill();
  }
  ctx.restore();
}
