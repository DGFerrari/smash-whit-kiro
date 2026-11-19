/**
 * Logo de KiroBrawl (R1.2, R1.9).
 *
 * SVG procedimental sin dependencias de fuentes ni assets externos: las letras
 * "KIRO" y "BRAWL" están dibujadas como trazos geométricos (estilo Russo One:
 * bloque, esquinas biseladas) con inclinación de −8°, relleno degradado con los
 * tokens de marca, contorno grueso oscuro + filete claro, brillo diagonal,
 * líneas de velocidad y un destello de impacto en estrella tras la "B".
 *
 * Accesibilidad: el `<svg>` lleva `role="img"`, `aria-label="KiroBrawl"` y un
 * `<title>`. Si la construcción del SVG falla, el contenedor muestra en la
 * misma posición un `<h1>` "KiroBrawl" con `--font-display`.
 */
import { createVisualRng } from "../../render/visualRng.ts";
import {
  glintPath,
  pts,
  starPoints,
  svgEl,
  tokenResolver,
  uniqueId,
} from "./svg.ts";

export const LOGO_TEXT = "KiroBrawl";

/** Glifos de 100 u de alto. `w` = ancho de avance; `d` usa evenodd para huecos. */
const GLYPHS: Record<string, { w: number; d: string }> = {
  K: { w: 82, d: "M0 0H24V38L52 0H82L46 50L82 100H52L24 62V100H0Z" },
  I: { w: 24, d: "M0 0H24V100H0Z" },
  R: { w: 78, d: "M0 0H60L76 14V44L62 56L78 100H52L40 60H24V100H0Z M24 22V40H52V22Z" },
  O: { w: 78, d: "M16 0H62L78 16V84L62 100H16L0 84V16Z M24 24V76H54V24Z" },
  B: {
    w: 76,
    d: "M0 0H60L74 12V38L64 48L76 60V88L64 100H0Z M24 20V38H50V20Z M24 58V80H52V58Z",
  },
  A: { w: 84, d: "M26 0H58L84 100H58L53 80H31L26 100H0Z M36 60H48L42 32Z" },
  W: { w: 112, d: "M0 0H24L34 58L46 0H66L78 58L88 0H112L92 100H66L56 48L46 100H20Z" },
  L: { w: 66, d: "M0 0H24V76H66V100H0Z" },
};

const LETTER_GAP = 10;
const WORD_GAP = 16;
const ORIGIN_X = 44;
const ORIGIN_Y = 50;
const VIEW_W = 840;
const VIEW_H = 200;
/** Semilla fija: el logo es idéntico en cada carga. */
const LOGO_SEED = 0x6b1b0;

export interface LogoOptions {
  /** Fuerza el respaldo de texto (pruebas o fallo detectado por el llamador). */
  forceFallback?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Resuelve los tokens a valores (para serializar/rasterizar el SVG). */
  inlineTokens?: boolean;
}

interface WordLayout {
  paths: Array<{ d: string; x: number }>;
  width: number;
  /** Posición x de cada letra dentro de la palabra. */
  letterX: number[];
}

function layoutWord(word: string): WordLayout {
  const paths: WordLayout["paths"] = [];
  const letterX: number[] = [];
  let x = 0;
  for (const ch of word) {
    const g = GLYPHS[ch];
    letterX.push(x);
    paths.push({ d: g.d, x });
    x += g.w + LETTER_GAP;
  }
  return { paths, width: x - LETTER_GAP, letterX };
}

/** Construye el `<svg>` del logo. Puede lanzar si el entorno no soporta SVG. */
export function createLogoSvg(opts: Pick<LogoOptions, "inlineTokens"> = {}): SVGSVGElement {
  const t = tokenResolver(opts.inlineTokens);
  const rng = createVisualRng(LOGO_SEED);
  const id = {
    kiro: uniqueId("kb-logo-kiro"),
    brawl: uniqueId("kb-logo-brawl"),
    fillKiro: uniqueId("kb-logo-fk"),
    fillBrawl: uniqueId("kb-logo-fb"),
    shade: uniqueId("kb-logo-shade"),
    burst: uniqueId("kb-logo-burst"),
    flare: uniqueId("kb-logo-flare"),
    clip: uniqueId("kb-logo-clip"),
    title: uniqueId("kb-logo-title"),
  };

  const kiro = layoutWord("KIRO");
  const brawl = layoutWord("BRAWL");
  const brawlX = kiro.width + WORD_GAP;
  const totalW = brawlX + brawl.width;

  const wordGroup = (gid: string, w: WordLayout, dx: number) =>
    svgEl(
      "g",
      { id: gid, transform: `translate(${dx} 0)`, "fill-rule": "evenodd" },
      w.paths.map((p) => svgEl("path", { d: p.d, transform: `translate(${p.x} 0)` })),
    );

  const stop = (offset: string, color: string, opacity?: number) =>
    svgEl("stop", { offset, "stop-color": color, "stop-opacity": opacity });

  const defs = svgEl("defs", {}, [
    wordGroup(id.kiro, kiro, 0),
    wordGroup(id.brawl, brawl, brawlX),
    // Relleno cromado vertical: brillo arriba, color de marca, base saturada.
    svgEl(
      "linearGradient",
      { id: id.fillKiro, x1: 0, y1: 0, x2: 0, y2: 100, gradientUnits: "userSpaceOnUse" },
      [stop("0%", t("text")), stop("34%", t("primary")), stop("100%", t("primary"))],
    ),
    svgEl(
      "linearGradient",
      { id: id.fillBrawl, x1: 0, y1: 0, x2: 0, y2: 100, gradientUnits: "userSpaceOnUse" },
      [stop("0%", t("focus")), stop("42%", t("secondary")), stop("100%", t("danger"))],
    ),
    svgEl(
      "linearGradient",
      { id: id.shade, x1: 0, y1: 0, x2: 0, y2: 100, gradientUnits: "userSpaceOnUse" },
      [stop("0%", t("bg"), 0), stop("52%", t("bg"), 0), stop("54%", t("bg"), 0.28), stop("100%", t("bg"), 0.5)],
    ),
    svgEl("radialGradient", { id: id.burst, cx: "50%", cy: "50%", r: "50%" }, [
      stop("0%", t("text"), 1),
      stop("30%", t("focus"), 0.95),
      stop("70%", t("secondary"), 0.75),
      stop("100%", t("secondary"), 0),
    ]),
    svgEl("radialGradient", { id: id.flare, cx: "50%", cy: "50%", r: "50%" }, [
      stop("0%", t("text"), 0.9),
      stop("40%", t("focus"), 0.35),
      stop("100%", t("focus"), 0),
    ]),
    svgEl("clipPath", { id: id.clip }, [
      svgEl("use", { href: `#${id.kiro}` }),
      svgEl("use", { href: `#${id.brawl}` }),
    ]),
  ]);

  // ── Líneas de velocidad (detrás de todo, misma inclinación que el texto) ──
  const slashes = svgEl("g", { "aria-hidden": "true" });
  for (let i = 0; i < 14; i++) {
    const fromLeft = i % 2 === 0;
    const y = 6 + rng() * 92;
    const len = 90 + rng() * 220;
    const h = 1.5 + rng() * 5;
    const x0 = fromLeft ? -60 + rng() * 60 : totalW - len + 40 + rng() * 60;
    const color = i % 3 === 0 ? t("focus") : fromLeft ? t("primary") : t("secondary");
    slashes.appendChild(
      svgEl("polygon", {
        points: pts([x0 + 10, y, x0 + len, y - h * 0.4, x0 + len - 6, y + h, x0, y + h * 1.2]),
        fill: color,
        opacity: (0.35 + rng() * 0.5).toFixed(2),
      }),
    );
  }

  // ── Destello de impacto tras la "B" ──
  const bCx = brawlX + GLYPHS.B.w / 2;
  const burst = svgEl("g", { "aria-hidden": "true" }, [
    svgEl("polygon", {
      points: starPoints(bCx, 50, 14, 98, 44, -Math.PI / 2, rng),
      fill: `url(#${id.burst})`,
    }),
    svgEl("polygon", {
      points: starPoints(bCx, 50, 10, 62, 26, -Math.PI / 3, rng),
      fill: t("focus"),
      opacity: 0.85,
    }),
    svgEl("polygon", {
      points: starPoints(bCx, 50, 8, 34, 14, 0, rng),
      fill: t("text"),
      opacity: 0.9,
    }),
  ]);

  const useWords = (attrs: Record<string, string | number>) => [
    svgEl("use", { href: `#${id.kiro}`, ...attrs }),
    svgEl("use", { href: `#${id.brawl}`, ...attrs }),
  ];

  // ── Capas del texto ──
  const shadow = svgEl(
    "g",
    { transform: "translate(7 9)", "aria-hidden": "true" },
    useWords({
      fill: t("bg"),
      stroke: t("bg"),
      "stroke-width": 18,
      "stroke-linejoin": "round",
    }),
  );
  const outline = svgEl(
    "g",
    { "aria-hidden": "true" },
    useWords({ fill: t("bg"), stroke: t("bg"), "stroke-width": 16, "stroke-linejoin": "round" }),
  );
  const rim = svgEl(
    "g",
    { "aria-hidden": "true" },
    useWords({ fill: "none", stroke: t("text"), "stroke-width": 7, "stroke-linejoin": "round" }),
  );
  const fill = svgEl("g", { "aria-hidden": "true" }, [
    svgEl("use", { href: `#${id.kiro}`, fill: `url(#${id.fillKiro})` }),
    svgEl("use", { href: `#${id.brawl}`, fill: `url(#${id.fillBrawl})` }),
  ]);
  const shade = svgEl("g", { "aria-hidden": "true" }, useWords({ fill: `url(#${id.shade})` }));
  // Brillo diagonal recortado a las letras.
  const shine = svgEl("g", { "clip-path": `url(#${id.clip})`, "aria-hidden": "true" }, [
    svgEl("polygon", {
      points: pts([40, -10, 120, -10, 30, 110, -50, 110]),
      fill: t("text"),
      opacity: 0.35,
    }),
    svgEl("polygon", {
      points: pts([140, -10, 158, -10, 68, 110, 50, 110]),
      fill: t("text"),
      opacity: 0.25,
    }),
    svgEl("polygon", {
      points: pts([brawlX + 230, -10, brawlX + 300, -10, brawlX + 210, 110, brawlX + 140, 110]),
      fill: t("text"),
      opacity: 0.22,
    }),
  ]);

  const text = svgEl(
    "g",
    { transform: `translate(${ORIGIN_X} ${ORIGIN_Y}) skewX(-8)` },
    [slashes, burst, shadow, outline, rim, fill, shade, shine],
  );

  // ── Destellos de lente (fuera de la inclinación para que queden rectos) ──
  const wX = ORIGIN_X + brawlX + brawl.letterX[3] + GLYPHS.W.w;
  const glints = svgEl("g", { "aria-hidden": "true" }, [
    svgEl("circle", { cx: wX, cy: ORIGIN_Y + 4, r: 46, fill: `url(#${id.flare})` }),
    svgEl("path", { d: glintPath(wX, ORIGIN_Y + 4, 40), fill: t("text") }),
    svgEl("path", { d: glintPath(wX, ORIGIN_Y + 4, 16, 0.2), fill: t("text"), transform: `rotate(45 ${wX} ${ORIGIN_Y + 4})` }),
    svgEl("circle", { cx: ORIGIN_X + 6, cy: ORIGIN_Y + 2, r: 22, fill: `url(#${id.flare})` }),
    svgEl("path", { d: glintPath(ORIGIN_X + 6, ORIGIN_Y + 2, 20), fill: t("text") }),
  ]);

  const svg = svgEl(
    "svg",
    {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      role: "img",
      "aria-label": LOGO_TEXT,
      class: "kb-logo__svg",
      width: "100%",
      preserveAspectRatio: "xMidYMid meet",
      style: "display:block;height:auto;overflow:visible",
    },
    [svgEl("title", { id: id.title }), defs, text, glints],
  );
  svg.querySelector("title")!.textContent = LOGO_TEXT;
  return svg;
}

/** Respaldo de texto (R1.9): `<h1>` "KiroBrawl" con la tipografía display. */
export function createLogoFallback(): HTMLHeadingElement {
  const h1 = document.createElement("h1");
  h1.className = "kb-logo__fallback";
  h1.textContent = LOGO_TEXT;
  h1.setAttribute(
    "style",
    "margin:0;font-family:var(--font-display);font-size:var(--fs-display);" +
      "font-weight:var(--fw-display);color:var(--color-text);font-style:italic;" +
      "letter-spacing:0.02em;line-height:1",
  );
  return h1;
}

/**
 * Contenedor del logo. Mantiene la misma caja en el layout tanto con SVG
 * como con el respaldo, para que el texto aparezca en la misma posición.
 */
export function createLogo(opts: LogoOptions = {}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = opts.className ? `kb-logo ${opts.className}` : "kb-logo";
  if (opts.forceFallback) {
    showLogoFallback(wrap);
    return wrap;
  }
  try {
    wrap.appendChild(createLogoSvg(opts));
    wrap.dataset.logo = "svg";
  } catch {
    showLogoFallback(wrap);
  }
  return wrap;
}

/** Sustituye el contenido de un contenedor de logo por el respaldo de texto. */
export function showLogoFallback(wrap: HTMLElement): void {
  wrap.replaceChildren(createLogoFallback());
  wrap.dataset.logo = "fallback";
}
