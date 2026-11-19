/**
 * Utilidades compartidas para el arte SVG procedimental de marca
 * (`logo.ts`, `portraits.ts`).
 *
 * Todo el SVG se construye con `document.createElementNS` y `setAttribute`:
 * nunca se interpola texto en cadenas de marcado, así que los nombres visibles
 * (que proceden de `src/content/lore.ts` o de ids de replays) no pueden
 * inyectar HTML. Los textos se asignan siempre con `textContent`.
 */

export const SVG_NS = "http://www.w3.org/2000/svg";

export type SvgAttrs = Record<string, string | number | undefined>;

/** Propiedades de pintura que se escriben como `style` para admitir `var()`. */
const STYLE_PROPS = new Set([
  "fill",
  "stroke",
  "stop-color",
  "stop-opacity",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "mix-blend-mode",
]);

/**
 * Crea un elemento SVG. Las propiedades de pintura (`fill`, `stroke`,
 * `stop-color`…) se escriben en el atributo `style` porque los atributos de
 * presentación no aceptan `var(--token)` de forma fiable en todos los
 * navegadores.
 */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: SvgAttrs = {},
  children: Array<Node | null | undefined> = [],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  const style: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key === "style") style.push(String(value));
    else if (STYLE_PROPS.has(key)) style.push(`${key}:${value}`);
    else el.setAttribute(key, String(value));
  }
  if (style.length > 0) el.setAttribute("style", style.join(";"));
  for (const child of children) if (child) el.appendChild(child);
  return el;
}

/** Ids únicos y estables por instancia para gradientes, patrones y recortes. */
let idCounter = 0;
export function uniqueId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}`;
}

/**
 * Resolución de tokens de color del Sistema_Diseño.
 *
 * Por defecto devuelve `var(--color-x)` (el SVG vive inline en el DOM y hereda
 * los tokens). Con `inline = true` resuelve el valor computado en
 * `document.documentElement`, útil para serializar el SVG y rasterizarlo
 * fuera del documento (p. ej. retratos del HUD como `ImageBitmap`), donde las
 * variables CSS no están disponibles.
 */
export type TokenName =
  | "primary"
  | "secondary"
  | "focus"
  | "danger"
  | "success"
  | "bg"
  | "surface"
  | "surface-raised"
  | "border"
  | "text"
  | "text-muted";

export type TokenFn = (name: TokenName) => string;

export function tokenResolver(inline = false): TokenFn {
  if (!inline || typeof getComputedStyle !== "function") {
    return (name) => `var(--color-${name})`;
  }
  const cs = getComputedStyle(document.documentElement);
  return (name) => {
    const v = cs.getPropertyValue(`--color-${name}`).trim();
    return v !== "" ? v : `var(--color-${name})`;
  };
}

/** Polígono de puntos `[x, y, x, y, …]` → atributo `points`. */
export function pts(coords: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) {
    out.push(`${round(coords[i])},${round(coords[i + 1])}`);
  }
  return out.join(" ");
}

/** Estrella de `n` puntas centrada en (cx, cy). */
export function starPoints(
  cx: number,
  cy: number,
  n: number,
  rOuter: number,
  rInner: number,
  rotation = 0,
  jitter?: () => number,
): string {
  const coords: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rotation + (Math.PI * i) / n;
    let r = i % 2 === 0 ? rOuter : rInner;
    if (jitter && i % 2 === 0) r *= 0.75 + jitter() * 0.5;
    coords.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts(coords);
}

/** Destello de cuatro puntas (glint / lens flare) como `d` de path. */
export function glintPath(cx: number, cy: number, r: number, thin = 0.14): string {
  const t = r * thin;
  return (
    `M${round(cx)} ${round(cy - r)} L${round(cx + t)} ${round(cy - t)} ` +
    `L${round(cx + r)} ${round(cy)} L${round(cx + t)} ${round(cy + t)} ` +
    `L${round(cx)} ${round(cy + r)} L${round(cx - t)} ${round(cy + t)} ` +
    `L${round(cx - r)} ${round(cy)} L${round(cx - t)} ${round(cy - t)} Z`
  );
}

/** Hash FNV-1a de 32 bits: semilla estable a partir de un id. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
