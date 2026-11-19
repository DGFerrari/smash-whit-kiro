/**
 * Retratos de personaje y vistas previas de escenario en SVG procedimental
 * (R3.3, R3.7).
 *
 * - Retratos: busto estilizado por personaje (peinado/silueta propios), relleno
 *   oscuro con luz de contorno en el color del personaje, ojos brillantes,
 *   fondo diagonal con trama de semitono y líneas de velocidad. La variación
 *   (líneas, trama, chispas) sale de una semilla por personaje.
 * - Vistas previas: paisaje por capas (cielo, lejano, combate, primer plano)
 *   siguiendo la dirección de arte de cada escenario en design.md.
 * - Si una vista previa falla (id desconocido o error al construir), se
 *   muestra un marcador con los colores del Sistema_Diseño y el nombre visible.
 *
 * Los colores de marca/UI salen de tokens (`var(--color-*)`); los colores de
 * personaje, de `CHARACTERS` del motor (solo lectura). Las paletas de
 * ilustración de los escenarios (`STAGE_ART`) son datos de arte de la
 * dirección de design.md, no estilos de Pantalla_UI.
 */
import { CHARACTERS, type CharacterId } from "../../engine/game/characters.ts";
import type { StageId } from "../../engine/game/stages.ts";
import { characterLore, stageLore } from "../../content/lore.ts";
import { PORTRAIT_CROP, portraitImageUrl } from "../../content/portraitImages.ts";
import { createVisualRng } from "../../render/visualRng.ts";
import {
  glintPath,
  hashSeed,
  pts,
  round,
  svgEl,
  tokenResolver,
  uniqueId,
  type TokenFn,
} from "./svg.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Semillas
// ─────────────────────────────────────────────────────────────────────────────

/** Semilla del retrato SVG por personaje (`CharacterVisualDef.portraitSeed`). */
export const PORTRAIT_SEEDS: Readonly<Record<CharacterId, number>> = {
  blue: 0x5052494d, // "PRIM"
  red: 0x56455350, // "VESP"
  yellow: 0x534f4c21, // "SOL!"
  green: 0x49565921, // "IVY!"
  kael: 0x4b41454c, // "KAEL"
  nova: 0x4e4f5641, // "NOVA"
  rook: 0x524f4f4b, // "ROOK"
  kaito: 0x4b414954, // "KAIT"
  taro: 0x5441524f, // "TARO"
  bolt: 0x424f4c54, // "BOLT"
  gloop: 0x474c4f4f, // "GLOO"
  unit7: 0x554e3737, // "UN77"
  sandbag: 0x5341434f, // "SACO"
};

/** Estrella de 5 puntas como trazado SVG. */
function starPath(cx: number, cy: number, r: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? "L" : "M"}${round(cx + Math.cos(a) * rr)} ${round(cy + Math.sin(a) * rr)} `;
  }
  return d + "Z";
}

/** Semilla de la vista previa por escenario (`StageVisualDef.previewSeed`). */
export const PREVIEW_SEEDS: Readonly<Record<StageId, number>> = {
  neonIsland: 0x4e454f4e,
  sunsetIsland: 0x5355534e,
  voidIsland: 0x414c4241,
  training: 0x5452414e,
};

function has<K extends string>(rec: Readonly<Record<K, unknown>>, id: string): id is K {
  return Object.prototype.hasOwnProperty.call(rec, id);
}

type Rng = () => number;
const between = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

// ─────────────────────────────────────────────────────────────────────────────
// Retratos
// ─────────────────────────────────────────────────────────────────────────────

export interface PortraitOptions {
  /** Oculta el retrato a tecnologías de asistencia (el nombre ya está al lado). */
  decorative?: boolean;
  /** Resuelve los tokens a valores (para serializar/rasterizar el SVG). */
  inlineTokens?: boolean;
  className?: string;
}

const PORTRAIT_W = 200;
const PORTRAIT_H = 240;

/** Cuello y torso comunes a los bustos humanos. */
const NECK = "M88 116 L112 116 L114 162 L86 162 Z";
const TORSO =
  "M8 240 C12 204 34 184 64 174 L88 160 L112 160 L136 174 C166 184 188 204 192 240 Z";
/** Cabeza en 3/4 con barbilla afilada (estilo anime). */
const HEAD =
  "M70 84 C70 58 86 46 102 46 C120 46 134 58 134 82 C134 98 130 110 122 120 " +
  "L106 134 C102 137 98 137 94 134 L78 120 C72 110 70 98 70 84 Z";
/** Ojos rasgados. */
const EYE_L = "M80 96 L97 99 L95 104 L82 102 Z";
const EYE_R = "M106 99 L123 95 L122 101 L108 104 Z";

interface Detail {
  d: string;
  fill?: string;
  stroke?: string;
  width?: number;
  opacity?: number;
  dash?: string;
}

interface PortraitArt {
  /** Formas que componen la silueta (rellenas en oscuro con luz de contorno). */
  silhouette: string[];
  /** Detalles por encima de la silueta. */
  details: Detail[];
  /** ¿Lleva ojos rasgados humanos? */
  eyes: boolean;
}

function leaf(cx: number, cy: number, s: number, angleDeg: number): string {
  const a = (angleDeg * Math.PI) / 180;
  const rot = (x: number, y: number) =>
    `${round(cx + x * Math.cos(a) - y * Math.sin(a))} ${round(cy + x * Math.sin(a) + y * Math.cos(a))}`;
  return (
    `M${rot(0, -s)} C${rot(s * 0.65, -s * 0.4)} ${rot(s * 0.65, s * 0.4)} ${rot(0, s)} ` +
    `C${rot(-s * 0.65, s * 0.4)} ${rot(-s * 0.65, -s * 0.4)} ${rot(0, -s)} Z`
  );
}

function portraitArt(id: string, color: string, t: TokenFn, rng: Rng): PortraitArt {
  switch (id) {
    case "blue": {
      // El Primo: luchador enmascarado, hombros gigantes, máscara con llamas.
      const flame = "#e8264a"; // aros rojos de los ojos
      const skin = "#d98a4e";
      return {
        silhouette: [
          // Torso enorme y deltoides.
          "M-6 240 C-4 196 18 168 58 156 L80 146 L120 146 L142 156 C182 168 204 196 206 240 Z",
          "M-2 196 a44 38 0 1 0 88 0 a44 38 0 1 0 -88 0",
          "M114 196 a44 38 0 1 0 88 0 a44 38 0 1 0 -88 0",
          // Trapecios / cuello ancho.
          "M66 152 C72 124 128 124 134 152 L140 170 L60 170 Z",
          // Cabeza con máscara (redonda).
          "M64 92 C64 60 80 44 100 44 C120 44 136 60 136 92 C136 118 122 138 100 138 C78 138 64 118 64 92 Z",
        ],
        details: [
          // Emblema de llama amarilla en la frente.
          { d: "M100 52 C94 58 94 66 100 68 C106 66 106 58 100 52 Z", fill: "#ffd23f" },
          // Aros rojos con ojos blancos enormes.
          { d: "M70 90 a14 13 0 1 0 28 0 a14 13 0 1 0 -28 0", fill: flame },
          { d: "M102 90 a14 13 0 1 0 28 0 a14 13 0 1 0 -28 0", fill: flame },
          { d: "M75 90 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0", fill: t("text") },
          { d: "M107 90 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0", fill: t("text") },
          // Nariz asomando.
          { d: "M96 98 L100 112 L104 98 Z", fill: skin },
          // Mandíbula al descubierto con sonrisa de dientes.
          { d: "M74 114 C78 140 122 140 126 114 C114 120 86 120 74 114 Z", fill: skin },
          { d: "M82 116 L118 116 L114 128 L86 128 Z", fill: t("text") },
          { d: "M94 116 L94 128 M100 116 L100 128 M106 116 L106 128", stroke: t("bg"), width: 1 },
          // Pectorales y muñequera insinuada.
          { d: "M58 198 C76 210 92 208 100 198 C108 208 124 210 142 198", stroke: color, width: 2.5, opacity: 0.8 },
          { d: "M100 172 L100 200", stroke: color, width: 1.5, opacity: 0.5 },
          { d: glintPath(150, 176, 8), fill: t("text"), opacity: 0.8 },
        ],
        eyes: false,
      };
    }
    case "kael": // Kael: pelo en púas peinado hacia atrás, hombreras y cuello alto.
      return {
        silhouette: [
          TORSO,
          "M8 214 L28 178 L66 170 L82 184 L62 214 L30 224 Z",
          "M192 214 L172 178 L134 170 L118 184 L138 214 L170 224 Z",
          NECK,
          "M80 150 L88 134 L100 156 L112 134 L120 150 L116 172 L100 184 L84 172 Z",
          HEAD,
          "M66 92 L58 70 L70 70 L62 48 L82 54 L84 30 L100 46 L114 22 L120 46 L146 32 " +
            "L136 56 L160 58 L138 72 L142 96 L130 80 L128 68 L112 62 L96 66 L82 64 L74 78 Z",
        ],
        details: [
          { d: "M28 178 L66 170 L82 184", stroke: color, width: 3 },
          { d: "M172 178 L134 170 L118 184", stroke: color, width: 3 },
          { d: "M88 134 L100 156 L112 134", stroke: color, width: 2 },
          { d: "M100 196 L109 208 L100 220 L91 208 Z", fill: color },
          { d: glintPath(100, 208, 7), fill: t("text"), opacity: 0.9 },
        ],
        eyes: true,
      };
    case "nova": // Nova: coletas con lazos, flequillo y estrella.
      return {
        silhouette: [
          TORSO,
          NECK,
          "M58 70 C38 92 32 132 44 166 C50 144 58 126 70 112 Z",
          "M142 70 C162 92 168 132 156 166 C150 144 142 126 130 112 Z",
          HEAD,
          "M66 92 C60 60 80 40 102 40 C126 40 142 60 136 92 C126 74 112 66 100 66 C88 68 76 76 66 92 Z",
        ],
        details: [
          { d: "M50 70 a10 8 0 1 0 20 0 a10 8 0 1 0 -20 0 M130 70 a10 8 0 1 0 20 0 a10 8 0 1 0 -20 0", fill: "#fff27a" },
          { d: starPath(118, 54, 9), fill: "#fff27a" },
          { d: starPath(100, 206, 14), fill: color },
          { d: glintPath(100, 206, 6), fill: t("text"), opacity: 0.9 },
        ],
        eyes: true,
      };
    case "rook": // Rook: yelmo con visor, penacho y hombreras.
      return {
        silhouette: [
          TORSO,
          "M2 214 C6 176 34 164 66 166 L82 196 L40 228 Z",
          "M198 214 C194 176 166 164 134 166 L118 196 L160 228 Z",
          NECK,
          "M62 98 C62 56 82 40 100 40 C118 40 138 56 138 98 L138 136 L62 136 Z",
          "M94 42 L100 10 L106 42 Z",
        ],
        details: [
          { d: "M72 90 L128 90 L126 102 L74 102 Z", fill: "#ffcf4a" },
          { d: "M100 104 L100 130", stroke: color, width: 3 },
          { d: "M90 188 L110 188 L110 222 L100 230 L90 222 Z", fill: "#ffcf4a" },
        ],
        eyes: false,
      };
    case "kaito": // Kaito: pelo en púas, cinta, máscara y bufanda al viento.
      return {
        silhouette: [
          TORSO,
          NECK,
          "M120 150 C150 138 172 150 198 130 C186 162 160 174 126 170 Z",
          HEAD,
          "M66 88 L60 62 L74 66 L72 44 L90 52 L100 32 L110 52 L128 44 L126 66 L140 62 L134 88 C120 72 82 72 66 88 Z",
        ],
        details: [
          { d: "M66 82 L134 82", stroke: "#e8263a", width: 6 },
          { d: "M134 82 L160 96 M134 82 L156 76", stroke: "#e8263a", width: 4 },
          { d: "M72 106 C80 126 120 126 128 106 L128 124 L106 136 L94 136 L72 124 Z", fill: color, opacity: 0.45 },
          { d: "M70 156 L130 156", stroke: "#e8263a", width: 9 },
        ],
        eyes: true,
      };
    case "taro": // Taro: gorro de chef alto, bigote y delantal.
      return {
        silhouette: [
          TORSO,
          NECK,
          HEAD,
          "M70 64 C58 22 84 6 100 18 C116 6 142 22 130 64 Z",
          "M70 60 L130 60 L130 76 L70 76 Z",
        ],
        details: [
          { d: "M70 64 C58 22 84 6 100 18 C116 6 142 22 130 64 Z M70 60 L130 60 L130 76 L70 76 Z", fill: t("text"), opacity: 0.9 },
          { d: "M84 114 C90 108 98 110 100 116 C102 110 110 108 116 114 C112 124 104 122 100 118 C96 122 88 124 84 114 Z", fill: t("bg") },
          { d: "M80 178 L120 178 L126 240 L74 240 Z", fill: t("text"), opacity: 0.8 },
          { d: "M86 168 L100 182 L114 168", stroke: "#ff6a2a", width: 6 },
        ],
        eyes: true,
      };
    case "bolt": // Bolt (invitado): casco de carreras con visor.
      return {
        silhouette: [
          TORSO,
          NECK,
          "M58 98 C58 56 80 36 100 36 C122 36 144 56 144 98 C144 124 130 142 100 142 C70 142 58 124 58 98 Z",
        ],
        details: [
          { d: "M68 84 C70 72 130 72 132 84 L128 106 C116 112 84 112 72 106 Z", fill: "#3ff0ff", opacity: 0.9 },
          { d: glintPath(84, 86, 6), fill: t("text"), opacity: 0.9 },
          { d: "M100 36 L100 72", stroke: t("bg"), width: 7 },
          { d: "M92 184 L110 184 L100 200 L114 200 L90 230 L97 208 L86 208 Z", fill: color },
        ],
        eyes: false,
      };
    case "gloop": // Gloop (invitado): rey slime con corona.
      return {
        silhouette: [
          "M26 240 C16 168 48 98 100 94 C152 98 184 168 174 240 Z",
          "M70 100 L74 68 L86 86 L100 60 L114 86 L126 68 L130 100 Z",
        ],
        details: [
          { d: "M70 100 L74 68 L86 86 L100 60 L114 86 L126 68 L130 100 Z", fill: "#ffd23f" },
          { d: "M70 150 a13 15 0 1 0 26 0 a13 15 0 1 0 -26 0 M104 150 a13 15 0 1 0 26 0 a13 15 0 1 0 -26 0", fill: t("text") },
          { d: "M78 152 a6 7 0 1 0 12 0 a6 7 0 1 0 -12 0 M110 152 a6 7 0 1 0 12 0 a6 7 0 1 0 -12 0", fill: t("bg") },
          { d: "M84 186 C94 196 106 196 116 186", stroke: t("bg"), width: 3 },
          { d: "M52 140 C54 124 62 114 72 110", stroke: t("text"), width: 5, opacity: 0.5 },
        ],
        eyes: false,
      };
    case "unit7": // Unit-7 (invitado): cabeza cuadrada, visor rojo y antena.
      return {
        silhouette: [
          TORSO,
          "M80 132 L120 132 L124 168 L76 168 Z",
          "M62 54 L138 54 L142 134 L58 134 Z",
          "M118 54 L121 22 L125 54 Z",
        ],
        details: [
          { d: "M70 84 L130 84 L130 102 L70 102 Z", fill: "#ff3d5a" },
          { d: "M116 20 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0", fill: "#ff3d5a" },
          { d: "M88 200 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0", fill: "#ff3d5a" },
          { d: "M66 60 L76 60 M124 60 L134 60 M66 128 L76 128 M124 128 L134 128", stroke: color, width: 3 },
        ],
        eyes: false,
      };
    case "red": // Vesper: melena larga, coleta en forma de llama, bufanda y guantelete.
      return {
        silhouette: [
          TORSO,
          "M126 52 C146 30 166 40 186 12 C182 42 172 58 152 70 C166 72 176 66 184 62 " +
            "C172 88 152 90 134 78 Z",
          "M62 100 C56 62 76 40 104 40 C130 40 144 60 140 94 L148 152 L130 134 L128 96 " +
            "L118 72 C110 80 96 82 84 74 L78 96 L74 152 L54 138 Z",
          NECK,
          HEAD,
          "M64 98 C58 64 78 44 104 44 C128 44 140 62 136 90 L126 72 L110 66 L104 94 " +
            "L98 70 L90 86 L86 70 L72 84 Z",
          "M78 160 C92 172 108 172 124 160 L132 174 C116 188 88 188 70 174 Z",
          "M74 172 L42 200 L54 206 L86 180 Z",
          "M136 240 L134 202 C134 188 146 180 160 180 L178 182 C192 184 198 198 196 212 L192 240 Z",
        ],
        details: [
          { d: "M142 198 L190 200", stroke: color, width: 2.5 },
          { d: "M146 212 L192 214", stroke: color, width: 2, opacity: 0.8 },
          { d: "M150 186 L150 198 M162 184 L162 198 M174 185 L174 199", stroke: color, width: 2 },
          { d: "M80 168 C94 178 108 178 122 168", stroke: color, width: 2 },
          { d: "M150 40 C160 34 170 30 178 22", stroke: t("focus"), width: 2, opacity: 0.8 },
          ...Array.from({ length: 7 }, (): Detail => {
            const x = between(rng, 140, 196);
            const y = between(rng, 6, 70);
            const r = between(rng, 1, 2.6);
            return {
              d: `M${round(x - r)} ${round(y)} a${round(r)} ${round(r)} 0 1 0 ${round(2 * r)} 0 a${round(r)} ${round(r)} 0 1 0 ${round(-2 * r)} 0`,
              fill: rng() < 0.5 ? t("focus") : t("danger"),
              opacity: 0.9,
            };
          }),
        ],
        eyes: true,
      };
    case "yellow": // Sol: pelo de punta hacia arriba, gafas en la frente, sudadera.
      return {
        silhouette: [
          TORSO,
          NECK,
          "M56 178 C66 150 84 144 100 154 C116 144 134 150 144 178 L130 190 " +
            "C120 172 80 172 70 190 Z",
          HEAD,
          "M66 92 L52 72 L68 70 L52 42 L78 52 L76 18 L96 42 L108 6 L118 42 L142 18 " +
            "L136 52 L162 46 L140 70 L146 94 L132 78 L118 70 L100 72 L84 70 L74 82 Z",
        ],
        details: [
          { d: "M64 66 L138 58 L140 72 L64 80 Z", fill: t("bg") },
          { d: "M64 66 L138 58 L140 72 L64 80 Z", stroke: color, width: 1.5 },
          {
            d: "M76 72 a10 9 0 1 0 20 0 a10 9 0 1 0 -20 0 M106 69 a10 9 0 1 0 20 0 a10 9 0 1 0 -20 0",
            fill: color,
          },
          { d: "M80 69 L88 66 M110 66 L118 63", stroke: t("text"), width: 2, opacity: 0.85 },
          { d: "M106 188 L90 212 L101 212 L94 234 L114 206 L103 206 L110 188 Z", fill: color },
          { d: "M70 190 L86 240 M130 190 L114 240", stroke: color, width: 2, opacity: 0.5 },
          { d: "M108 6 L118 42 M142 18 L136 52", stroke: t("text"), width: 1.5, opacity: 0.5 },
        ],
        eyes: true,
      };
    case "green": // Ivy: capucha con punta, trenza y hojas.
      return {
        silhouette: [
          TORSO,
          NECK,
          "M46 132 C38 80 62 34 106 24 L126 2 L126 28 C154 40 166 86 156 134 L136 118 " +
            "C142 86 130 60 102 58 C78 60 64 82 68 120 Z",
          HEAD,
          "M72 84 C82 62 112 56 130 74 L122 74 L114 88 L106 72 L96 88 L90 72 L80 90 Z",
          "M66 128 a8 10 0 1 0 0.1 0 Z",
          "M60 146 a8 10 0 1 0 0.1 0 Z",
          "M56 164 a8 10 0 1 0 0.1 0 Z",
          "M54 182 a7 9 0 1 0 0.1 0 Z",
        ],
        details: [
          { d: leaf(124, 10, 9, 30), fill: color },
          { d: leaf(150, 120, 8, -20), fill: color, opacity: 0.85 },
          { d: leaf(94, 178, 9, -50), fill: color },
          { d: leaf(106, 178, 9, 50), fill: color },
          { d: "M100 172 a5 5 0 1 0 0.1 0 Z", fill: t("focus") },
          { d: "M52 192 L48 206 M56 192 L60 206", stroke: color, width: 2 },
          { d: "M106 24 C80 36 60 70 58 112", stroke: color, width: 2, opacity: 0.7 },
        ],
        eyes: true,
      };
    case "sandbag": // Saco: saco de lona atado con cuerda, costuras y ojos en X.
      return {
        silhouette: [
          "M54 240 C36 186 44 120 78 92 L72 66 C72 56 128 56 128 66 L122 92 C156 120 164 186 146 240 Z",
          "M84 64 C78 44 94 36 100 48 C106 36 122 44 116 64 Z",
        ],
        details: [
          { d: "M74 72 C90 82 110 82 126 72 L124 86 C108 96 92 96 76 86 Z", fill: color },
          { d: "M80 78 L120 80", stroke: t("bg"), width: 1.5, opacity: 0.6, dash: "3 3" },
          { d: "M100 98 C95 140 97 190 103 240", stroke: color, width: 2.5, dash: "7 6" },
          { d: "M76 128 L92 144 M92 128 L76 144", stroke: color, width: 4 },
          { d: "M110 126 L126 142 M126 126 L110 142", stroke: color, width: 4 },
          { d: "M84 166 L92 160 L100 166 L108 160 L116 166", stroke: color, width: 2.5 },
          { d: "M118 192 L144 186 L148 210 L122 216 Z", stroke: color, width: 2, dash: "4 3" },
          { d: "M64 200 L74 206 M66 214 L76 218", stroke: color, width: 2, opacity: 0.7 },
        ],
        eyes: false,
      };
    default: // Personaje desconocido: busto genérico.
      return {
        silhouette: [
          TORSO,
          NECK,
          HEAD,
          "M66 92 C60 56 82 40 104 40 C130 40 142 58 138 92 L126 70 L100 66 L80 70 Z",
        ],
        details: [],
        eyes: true,
      };
  }
}

/** Retrato SVG del personaje. Nunca lanza para ids desconocidos (busto genérico). */
export function createCharacterPortrait(id: string, opts: PortraitOptions = {}): SVGSVGElement {
  const t = tokenResolver(opts.inlineTokens);
  const known = has(CHARACTERS, id);
  const color = known ? CHARACTERS[id].color : t("primary");
  const seed = has(PORTRAIT_SEEDS, id) ? PORTRAIT_SEEDS[id] : hashSeed(id);
  const rng = createVisualRng(seed);
  const art = portraitArt(id, color, t, rng);
  const ids = {
    bg: uniqueId("kb-pt-bg"),
    glow: uniqueId("kb-pt-glow"),
    vol: uniqueId("kb-pt-vol"),
  };

  const defs = svgEl("defs", {}, [
    svgEl("linearGradient", { id: ids.bg, x1: 0, y1: 1, x2: 1, y2: 0 }, [
      svgEl("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.95 }),
      svgEl("stop", { offset: "55%", "stop-color": color, "stop-opacity": 0.25 }),
      svgEl("stop", { offset: "100%", "stop-color": t("bg"), "stop-opacity": 0 }),
    ]),
    svgEl("radialGradient", { id: ids.glow, cx: "50%", cy: "50%", r: "50%" }, [
      svgEl("stop", { offset: "0%", "stop-color": t("text"), "stop-opacity": 0.55 }),
      svgEl("stop", { offset: "35%", "stop-color": color, "stop-opacity": 0.55 }),
      svgEl("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }),
    ]),
    svgEl("linearGradient", { id: ids.vol, x1: 0, y1: 0, x2: 1, y2: 1 }, [
      svgEl("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.32 }),
      svgEl("stop", { offset: "45%", "stop-color": color, "stop-opacity": 0 }),
    ]),
  ]);

  // ── Fondo: diagonal, semitono y líneas de velocidad ──
  const bg = svgEl("g", {}, [
    svgEl("rect", { width: PORTRAIT_W, height: PORTRAIT_H, fill: t("bg") }),
    svgEl("rect", { width: PORTRAIT_W, height: PORTRAIT_H, fill: `url(#${ids.bg})` }),
  ]);
  const tilt = between(rng, -14, 14);
  bg.appendChild(
    svgEl("polygon", {
      points: pts([0, 120 + tilt, PORTRAIT_W, 10 - tilt, PORTRAIT_W, 44 - tilt, 0, 160 + tilt]),
      fill: t("text"),
      opacity: 0.1,
    }),
  );
  bg.appendChild(
    svgEl("polygon", {
      points: pts([0, 170 + tilt, PORTRAIT_W, 62 - tilt, PORTRAIT_W, 70 - tilt, 0, 178 + tilt]),
      fill: color,
      opacity: 0.6,
    }),
  );
  // Semitono: puntos que crecen hacia la esquina inferior izquierda.
  const dots = svgEl("g", { fill: color, opacity: 0.5 });
  const step = 10;
  for (let y = 5; y < PORTRAIT_H; y += step) {
    for (let x = (y / step) % 2 === 0 ? 5 : 10; x < PORTRAIT_W; x += step) {
      const dist = Math.hypot(x, PORTRAIT_H - y);
      const r = 3.8 * (1 - dist / 190);
      if (r > 0.35) dots.appendChild(svgEl("circle", { cx: x, cy: y, r: round(r) }));
    }
  }
  bg.appendChild(dots);
  // Líneas de velocidad radiales desde detrás de la cabeza.
  const lines = svgEl("g", { fill: t("text") });
  const cx = 102;
  const cy = 88;
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + between(rng, -0.1, 0.1);
    const r0 = between(rng, 70, 100);
    const r1 = 200;
    const w = between(rng, 0.01, 0.035);
    lines.appendChild(
      svgEl("polygon", {
        points: pts([
          cx + Math.cos(a) * r0,
          cy + Math.sin(a) * r0,
          cx + Math.cos(a - w) * r1,
          cy + Math.sin(a - w) * r1,
          cx + Math.cos(a + w) * r1,
          cy + Math.sin(a + w) * r1,
        ]),
        opacity: round(between(rng, 0.12, 0.35)),
      }),
    );
  }
  bg.appendChild(lines);
  bg.appendChild(svgEl("circle", { cx, cy, r: 84, fill: `url(#${ids.glow})` }));

  // ── Silueta con luz de contorno ──
  const shapes = (attrs: Record<string, string | number>) =>
    svgEl("g", attrs, art.silhouette.map((d) => svgEl("path", { d })));
  const figure = svgEl("g", {}, [
    shapes({ transform: "translate(-5 -3)", fill: color }),
    shapes({ transform: "translate(4 -1)", fill: t("text"), opacity: 0.6 }),
    shapes({ fill: t("bg") }),
    shapes({ fill: `url(#${ids.vol})` }),
  ]);

  const details = svgEl("g", {});
  for (const dt of art.details) {
    details.appendChild(
      svgEl("path", {
        d: dt.d,
        fill: dt.fill ?? "none",
        stroke: dt.stroke,
        "stroke-width": dt.width,
        "stroke-linecap": dt.stroke ? "round" : undefined,
        "stroke-linejoin": dt.stroke ? "round" : undefined,
        "stroke-dasharray": dt.dash,
        opacity: dt.opacity,
      }),
    );
  }
  if (art.eyes) {
    details.appendChild(svgEl("path", { d: `${EYE_L} ${EYE_R}`, fill: color }));
    details.appendChild(
      svgEl("path", {
        d: "M84 99 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 M112 99 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0",
        fill: t("text"),
      }),
    );
  }

  // Marco: filo diagonal inferior en el color del personaje.
  const frame = svgEl("g", {}, [
    svgEl("polygon", {
      points: pts([0, PORTRAIT_H - 10, PORTRAIT_W, PORTRAIT_H - 34, PORTRAIT_W, PORTRAIT_H, 0, PORTRAIT_H]),
      fill: color,
      opacity: 0.9,
    }),
    svgEl("polygon", {
      points: pts([0, PORTRAIT_H - 4, PORTRAIT_W, PORTRAIT_H - 28, PORTRAIT_W, PORTRAIT_H, 0, PORTRAIT_H]),
      fill: t("bg"),
    }),
  ]);

  // Retrato con IMAGEN (PNG/JPG/WebP/SVG) si el personaje la tiene: se pinta
  // sobre el mismo fondo y, si falla al cargar, vuelve la silueta dibujada.
  const layers: SVGElement[] = [defs, bg, figure, details];
  const imgUrl = portraitImageUrl(id);
  if (imgUrl) {
    const h = PORTRAIT_H / PORTRAIT_CROP;
    const w = h * 0.753;
    const photo = svgEl("image", {
      href: imgUrl,
      x: round((PORTRAIT_W - w) / 2),
      y: 4,
      width: round(w),
      height: round(h),
      preserveAspectRatio: "xMidYMin meet",
    });
    figure.setAttribute("display", "none");
    details.setAttribute("display", "none");
    photo.addEventListener("error", () => {
      photo.remove();
      figure.removeAttribute("display");
      details.removeAttribute("display");
    });
    layers.push(photo);
  }
  layers.push(frame);

  const name = characterLore(id).name;
  const svg = svgEl(
    "svg",
    {
      viewBox: `0 0 ${PORTRAIT_W} ${PORTRAIT_H}`,
      class: opts.className ? `kb-portrait ${opts.className}` : "kb-portrait",
      preserveAspectRatio: "xMidYMid slice",
      "data-character-id": id,
      "data-portrait": imgUrl ? "image" : "svg",
    },
    layers,
  );
  applyA11y(svg, name, opts.decorative);
  return svg;
}

function applyA11y(svg: SVGSVGElement, label: string, decorative?: boolean): void {
  if (decorative) {
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return;
  }
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  const title = svgEl("title");
  title.textContent = label;
  svg.insertBefore(title, svg.firstChild);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vistas previas de escenario
// ─────────────────────────────────────────────────────────────────────────────

const VIEW_W = 320;
const VIEW_H = 180;

/** Paletas de ilustración por escenario (dirección de arte de design.md). */
const STAGE_ART = {
  neonIsland: {
    skyTop: "#140a2e",
    skyMid: "#3b1670",
    far: "#2a1758",
    near: "#0d0620",
    rock: "#1c1238",
    light: "#7fd4ff",
    ink: "#05030c",
  },
  sunsetIsland: {
    skyTop: "#7a2e5a",
    skyMid: "#e86a3a",
    skyLow: "#ffb36b",
    sun: "#ffe1a8",
    cloud: "#ffd6a0",
    cloudShade: "#f39a5a",
    ridgeFar: "#b4507a",
    ridgeNear: "#8a3a5a",
    valley: "#5a2a3a",
    mill: "#4a1f2c",
    rock: "#8a3a22",
    strata: "#6a2a18",
    grass: "#7f9a3a",
    grassLight: "#b8c75a",
    grassFg: "#3a1e14",
    pollen: "#fff2c0",
  },
  voidIsland: {
    skyTop: "#0d2f38",
    skyMid: "#1f5e6b",
    horizon: "#ffe7c2",
    mountain: "#2e6f78",
    mountainDark: "#22545c",
    snow: "#eef6f2",
    seaTop: "#164a55",
    seaLow: "#0b2a33",
    marble: "#ece6d6",
    marbleShade: "#b9b2a0",
    moss: "#3f7a4a",
    rock: "#2a4a40",
    lantern: "#ffcf7a",
    petal: "#ffc2d6",
    branch: "#0c2226",
  },
  training: {
    bgTop: "#1a1d24",
    bgLow: "#0e1015",
    bleacher: "#262a33",
    bleacherEdge: "#323744",
    steel: "#3a3f4c",
    dark: "#0b0d12",
    spot: "#ffffff",
  },
} as const;

export interface StagePreviewOptions {
  /** Fuerza el marcador de respaldo (pruebas o fallo detectado por el llamador). */
  forceFallback?: boolean;
  decorative?: boolean;
  inlineTokens?: boolean;
  className?: string;
}

interface SceneCtx {
  t: TokenFn;
  rng: Rng;
  defs: SVGDefsElement;
  uid: (p: string) => string;
}

function linear(
  ctx: SceneCtx,
  stops: Array<[string, string, number?]>,
  dir: [number, number, number, number] = [0, 0, 0, 1],
): string {
  const id = ctx.uid("lg");
  ctx.defs.appendChild(
    svgEl(
      "linearGradient",
      { id, x1: dir[0], y1: dir[1], x2: dir[2], y2: dir[3] },
      stops.map(([offset, c, o]) => svgEl("stop", { offset, "stop-color": c, "stop-opacity": o })),
    ),
  );
  return `url(#${id})`;
}

function radial(ctx: SceneCtx, stops: Array<[string, string, number?]>): string {
  const id = ctx.uid("rg");
  ctx.defs.appendChild(
    svgEl(
      "radialGradient",
      { id, cx: "50%", cy: "50%", r: "50%" },
      stops.map(([offset, c, o]) => svgEl("stop", { offset, "stop-color": c, "stop-opacity": o })),
    ),
  );
  return `url(#${id})`;
}

/** Isla flotante: cara superior plana y base rocosa dentada. */
function island(
  ctx: SceneCtx,
  x0: number,
  x1: number,
  top: number,
  depth: number,
  rock: string,
  edge: string,
): SVGGElement {
  const coords: number[] = [x0, top, x1, top];
  const n = 9;
  const tipX = (x0 + x1) / 2 + between(ctx.rng, -14, 14);
  for (let i = 1; i <= n; i++) {
    const f = i / (n + 1);
    // Recorre de derecha a izquierda por debajo, estrechándose hacia la punta.
    const x = x1 - (x1 - x0) * f;
    const taper = 1 - Math.abs(x - tipX) / ((x1 - x0) / 2 + 10);
    const y = top + 6 + Math.max(0, taper) * depth * between(ctx.rng, 0.75, 1.05);
    coords.push(x + between(ctx.rng, -4, 4), y);
  }
  coords.push(x0 + 4, top + 8);
  return svgEl("g", {}, [
    svgEl("polygon", { points: pts(coords), fill: rock }),
    svgEl("polygon", {
      points: pts([x0, top, x1, top, x1 - 4, top + 6, x0 + 4, top + 6]),
      fill: edge,
    }),
  ]);
}

/** Destello de lente para luces intensas. */
function lensFlare(ctx: SceneCtx, x: number, y: number, r: number, tint: string): SVGGElement {
  const halo = radial(ctx, [
    ["0%", ctx.t("text"), 0.95],
    ["30%", tint, 0.45],
    ["100%", tint, 0],
  ]);
  const g = svgEl("g", {}, [
    svgEl("circle", { cx: x, cy: y, r: r * 2.2, fill: halo }),
    svgEl("path", { d: glintPath(x, y, r * 1.8, 0.08), fill: ctx.t("text"), opacity: 0.9 }),
  ]);
  // Fantasmas hacia el centro de la imagen.
  const dx = VIEW_W / 2 - x;
  const dy = VIEW_H / 2 - y;
  for (const [f, rr, o] of [
    [0.5, 0.35, 0.25],
    [0.8, 0.2, 0.3],
    [1.25, 0.5, 0.15],
  ] as const) {
    g.appendChild(
      svgEl("circle", { cx: round(x + dx * f), cy: round(y + dy * f), r: round(r * rr), fill: tint, opacity: o }),
    );
  }
  return g;
}

function stars(ctx: SceneCtx, n: number, maxY: number): SVGGElement {
  const g = svgEl("g", { fill: ctx.t("text") });
  for (let i = 0; i < n; i++) {
    g.appendChild(
      svgEl("circle", {
        cx: round(between(ctx.rng, 0, VIEW_W)),
        cy: round(between(ctx.rng, 0, maxY)),
        r: round(between(ctx.rng, 0.3, 1.1)),
        opacity: round(between(ctx.rng, 0.3, 0.9)),
      }),
    );
  }
  return g;
}

function neonScene(ctx: SceneCtx): SVGElement[] {
  const { t, rng } = ctx;
  const A = STAGE_ART.neonIsland;
  const out: SVGElement[] = [];
  out.push(
    svgEl("rect", {
      width: VIEW_W,
      height: VIEW_H,
      fill: linear(ctx, [
        ["0%", A.skyTop],
        ["62%", A.skyMid],
        ["100%", t("secondary"), 0.8],
      ]),
    }),
  );
  out.push(stars(ctx, 26, 80));
  // Dirigible.
  out.push(
    svgEl("g", {}, [
      svgEl("ellipse", { cx: 236, cy: 30, rx: 26, ry: 7, fill: A.near }),
      svgEl("rect", { x: 228, y: 35, width: 14, height: 4, fill: A.near }),
      svgEl("rect", { x: 220, y: 28, width: 22, height: 2, fill: t("secondary"), opacity: 0.9 }),
    ]),
  );
  // Haces de los focos de búsqueda.
  const beam = linear(ctx, [
    ["0%", A.light, 0],
    ["100%", A.light, 0.35],
  ]);
  out.push(svgEl("polygon", { points: pts([52, 150, 62, 150, 10, 0, -30, 0]), fill: beam }));
  out.push(svgEl("polygon", { points: pts([262, 150, 270, 150, 330, 0, 280, 0]), fill: beam }));
  // Horizonte lejano.
  const far = svgEl("g", { fill: A.far });
  for (let x = -4; x < VIEW_W; ) {
    const w = between(rng, 10, 22);
    const h = between(rng, 30, 80);
    far.appendChild(svgEl("rect", { x: round(x), y: round(150 - h), width: round(w), height: round(h) }));
    x += w + between(rng, 0, 4);
  }
  out.push(far);
  // Rascacielos cercanos con ventanas y letreros.
  const near = svgEl("g", {});
  const windows = svgEl("g", {});
  const signs = svgEl("g", {});
  const winColors = [A.light, t("secondary"), t("focus")];
  for (let x = -6; x < VIEW_W; ) {
    const w = between(rng, 16, 30);
    const h = between(rng, 40, 100);
    const top = 156 - h;
    near.appendChild(svgEl("rect", { x: round(x), y: round(top), width: round(w), height: round(h), fill: A.near }));
    near.appendChild(
      svgEl("rect", { x: round(x), y: round(top), width: round(w), height: 1.5, fill: A.light, opacity: 0.6 }),
    );
    for (let wy = top + 5; wy < 150; wy += 6) {
      for (let wx = x + 3; wx < x + w - 3; wx += 5) {
        if (rng() < 0.32) {
          windows.appendChild(
            svgEl("rect", {
              x: round(wx),
              y: round(wy),
              width: 2,
              height: 3,
              fill: winColors[Math.floor(rng() * winColors.length)],
              opacity: round(between(rng, 0.5, 1)),
            }),
          );
        }
      }
    }
    if (rng() < 0.4) {
      const sc = rng() < 0.5 ? t("secondary") : t("primary");
      const sx = x + 2;
      const sy = top + between(rng, 8, 24);
      signs.appendChild(svgEl("rect", { x: round(sx - 2), y: round(sy - 2), width: 10, height: 22, fill: sc, opacity: 0.25 }));
      signs.appendChild(
        svgEl("rect", { x: round(sx), y: round(sy), width: 6, height: 18, fill: "none", stroke: sc, "stroke-width": 1.5 }),
      );
    }
    x += w + between(rng, 1, 6);
  }
  out.push(near, windows, signs);
  // Tráfico aéreo.
  const traffic = svgEl("g", {});
  for (let i = 0; i < 6; i++) {
    const y = between(rng, 40, 100);
    const x = between(rng, 0, VIEW_W);
    const len = between(rng, 14, 34);
    const c = i % 2 === 0 ? t("focus") : A.light;
    traffic.appendChild(svgEl("rect", { x: round(x), y: round(y), width: round(len), height: 1, fill: c, opacity: 0.6 }));
    traffic.appendChild(svgEl("circle", { cx: round(x + len), cy: round(y + 0.5), r: 1.6, fill: c }));
  }
  out.push(traffic);
  // Isla de combate con borde emisivo y reflejos en charcos.
  out.push(island(ctx, 70, 250, 130, 40, A.rock, A.light));
  const puddles = svgEl("g", { fill: t("secondary"), opacity: 0.5 });
  for (let i = 0; i < 5; i++) {
    puddles.appendChild(
      svgEl("rect", { x: round(between(ctx.rng, 80, 230)), y: 131.5, width: round(between(rng, 6, 16)), height: 1 }),
    );
  }
  out.push(puddles);
  out.push(lensFlare(ctx, 57, 150, 6, A.light), lensFlare(ctx, 266, 150, 6, A.light));
  // Lluvia.
  const rain = svgEl("g", { stroke: t("text"), "stroke-width": 0.6, opacity: 0.35 });
  for (let i = 0; i < 46; i++) {
    const x = between(rng, -20, VIEW_W);
    const y = between(rng, 0, VIEW_H);
    rain.appendChild(svgEl("line", { x1: round(x), y1: round(y), x2: round(x - 4), y2: round(y + 12) }));
  }
  out.push(rain);
  // Primer plano: cables y farola.
  out.push(
    svgEl("path", { d: "M-4 14 Q60 44 130 -4", fill: "none", stroke: A.ink, "stroke-width": 2.2 }),
    svgEl("path", { d: "M-4 30 Q40 50 86 -4", fill: "none", stroke: A.ink, "stroke-width": 1.4 }),
    svgEl("rect", { x: 10, y: 120, width: 4, height: 60, fill: A.ink }),
    svgEl("rect", { x: 6, y: 116, width: 20, height: 5, fill: A.ink }),
    svgEl("circle", { cx: 22, cy: 124, r: 9, fill: radial(ctx, [["0%", A.light, 0.9], ["100%", A.light, 0]]) }),
  );
  return out;
}

function sunsetScene(ctx: SceneCtx): SVGElement[] {
  const { rng } = ctx;
  const A = STAGE_ART.sunsetIsland;
  const out: SVGElement[] = [];
  out.push(
    svgEl("rect", {
      width: VIEW_W,
      height: VIEW_H,
      fill: linear(ctx, [
        ["0%", A.skyTop],
        ["48%", A.skyMid],
        ["80%", A.skyLow],
      ]),
    }),
  );
  // Sol con rayos.
  const sx = 232;
  const sy = 92;
  const rays = svgEl("g", { fill: A.sun, opacity: 0.16 });
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI + (i / 8) * Math.PI + between(rng, -0.05, 0.05);
    rays.appendChild(
      svgEl("polygon", {
        points: pts([
          sx,
          sy,
          sx + Math.cos(a - 0.05) * 260,
          sy + Math.sin(a - 0.05) * 260,
          sx + Math.cos(a + 0.05) * 260,
          sy + Math.sin(a + 0.05) * 260,
        ]),
      }),
    );
  }
  out.push(rays, svgEl("circle", { cx: sx, cy: sy, r: 24, fill: A.sun }));
  // Nubes.
  const clouds = svgEl("g", {});
  for (let i = 0; i < 5; i++) {
    const cx = between(rng, 10, 310);
    const cy = between(rng, 16, 70);
    const s = between(rng, 0.7, 1.4);
    clouds.appendChild(
      svgEl("g", { opacity: 0.85 }, [
        svgEl("ellipse", { cx: round(cx), cy: round(cy + 3 * s), rx: round(26 * s), ry: round(6 * s), fill: A.cloudShade }),
        svgEl("ellipse", { cx: round(cx - 8 * s), cy: round(cy), rx: round(14 * s), ry: round(7 * s), fill: A.cloud }),
        svgEl("ellipse", { cx: round(cx + 6 * s), cy: round(cy - 3 * s), rx: round(16 * s), ry: round(9 * s), fill: A.cloud }),
      ]),
    );
  }
  out.push(clouds);
  // Valle por capas.
  const ridge = (base: number, amp: number, fill: string) => {
    const c: number[] = [0, VIEW_H];
    for (let x = 0; x <= VIEW_W; x += 20) c.push(x, base - amp * (0.4 + rng() * 0.6));
    c.push(VIEW_W, VIEW_H);
    return svgEl("polygon", { points: pts(c), fill });
  };
  out.push(ridge(122, 26, A.ridgeFar), ridge(136, 18, A.ridgeNear), ridge(152, 8, A.valley));
  // Molinos de piedra.
  const mill = (x: number, base: number, s: number, rot: number) => {
    const hubY = base - 26 * s;
    const blades = svgEl("g", { transform: `rotate(${round(rot)} ${x} ${round(hubY)})`, fill: A.mill });
    for (let k = 0; k < 4; k++) {
      blades.appendChild(
        svgEl("rect", {
          x: round(x - 1.2 * s),
          y: round(hubY - 22 * s),
          width: round(2.4 * s),
          height: round(22 * s),
          transform: `rotate(${k * 90} ${x} ${round(hubY)})`,
        }),
      );
    }
    return svgEl("g", {}, [
      svgEl("polygon", {
        points: pts([x - 6 * s, base, x + 6 * s, base, x + 3.5 * s, hubY, x - 3.5 * s, hubY]),
        fill: A.mill,
      }),
      blades,
    ]);
  };
  out.push(mill(44, 118, 1, between(rng, 0, 90)), mill(118, 128, 0.7, between(rng, 0, 90)));
  // Risco de combate.
  out.push(island(ctx, 60, 252, 132, 42, A.rock, A.grass));
  const strata = svgEl("g", { stroke: A.strata, "stroke-width": 1.5, opacity: 0.8 });
  for (let i = 0; i < 4; i++) {
    const y = 144 + i * 7;
    strata.appendChild(svgEl("line", { x1: 90 + i * 12, y1: y, x2: 222 - i * 12, y2: y + between(rng, -2, 2) }));
  }
  out.push(strata, svgEl("rect", { x: 60, y: 131, width: 192, height: 1.5, fill: A.grassLight }));
  out.push(lensFlare(ctx, sx, sy, 8, A.sun));
  // Pájaros y polen.
  const birds = svgEl("g", { fill: "none", stroke: A.mill, "stroke-width": 1.2 });
  for (let i = 0; i < 4; i++) {
    const bx = between(rng, 80, 200);
    const by = between(rng, 30, 70);
    birds.appendChild(svgEl("path", { d: `M${round(bx - 4)} ${round(by)} q2 -3 4 0 q2 -3 4 0` }));
  }
  const pollen = svgEl("g", { fill: A.pollen });
  for (let i = 0; i < 18; i++) {
    pollen.appendChild(
      svgEl("circle", {
        cx: round(between(rng, 0, VIEW_W)),
        cy: round(between(rng, 90, 175)),
        r: round(between(rng, 0.4, 1.2)),
        opacity: round(between(rng, 0.4, 0.9)),
      }),
    );
  }
  out.push(birds, pollen);
  // Hierba alta en primer plano (más densa en las esquinas).
  const grass = svgEl("g", { fill: A.grassFg });
  for (let x = -4; x < VIEW_W + 4; x += between(rng, 2, 5)) {
    const edge = Math.min(x, VIEW_W - x) / (VIEW_W / 2);
    const h = (1 - edge) * 34 + between(rng, 4, 12);
    const lean = between(rng, -6, 6);
    grass.appendChild(svgEl("polygon", { points: pts([x - 2, VIEW_H, x + 2, VIEW_H, x + lean, VIEW_H - h]) }));
  }
  out.push(grass);
  return out;
}

function sanctuaryScene(ctx: SceneCtx): SVGElement[] {
  const { t, rng } = ctx;
  const A = STAGE_ART.voidIsland;
  const out: SVGElement[] = [];
  out.push(
    svgEl("rect", {
      width: VIEW_W,
      height: VIEW_H,
      fill: linear(ctx, [
        ["0%", A.skyTop],
        ["60%", A.skyMid],
        ["72%", A.horizon, 0.9],
      ]),
    }),
  );
  out.push(stars(ctx, 18, 60));
  // Auroras.
  const aurora = linear(
    ctx,
    [
      ["0%", t("success"), 0],
      ["50%", t("success"), 0.4],
      ["100%", A.horizon, 0],
    ],
    [0, 0, 1, 0],
  );
  out.push(
    svgEl("path", { d: "M-10 40 C60 10 120 50 190 24 C240 6 290 30 330 14 L330 30 C280 46 240 24 190 42 C120 66 60 28 -10 58 Z", fill: aurora }),
    svgEl("path", { d: "M-10 62 C80 40 150 70 230 46 C270 36 300 46 330 40 L330 48 C300 56 260 48 230 58 C150 82 80 52 -10 72 Z", fill: aurora, opacity: 0.6 }),
  );
  // Montañas nevadas.
  out.push(
    svgEl("polygon", { points: pts([0, 128, 50, 70, 70, 84, 110, 128]), fill: A.mountainDark }),
    svgEl("polygon", { points: pts([90, 128, 206, 34, 320, 128]), fill: A.mountain }),
    svgEl("polygon", { points: pts([184, 52, 206, 34, 230, 54, 218, 50, 208, 60, 198, 50]), fill: A.snow }),
    svgEl("polygon", { points: pts([42, 80, 50, 70, 58, 79, 51, 77]), fill: A.snow }),
  );
  // Mar en calma con reflejos.
  out.push(
    svgEl("rect", {
      y: 128,
      width: VIEW_W,
      height: 52,
      fill: linear(ctx, [
        ["0%", A.seaTop],
        ["100%", A.seaLow],
      ]),
    }),
  );
  const waves = svgEl("g", { fill: A.horizon });
  for (let i = 0; i < 16; i++) {
    const y = between(rng, 131, 176);
    waves.appendChild(
      svgEl("rect", {
        x: round(between(rng, 0, VIEW_W - 30)),
        y: round(y),
        width: round(between(rng, 8, 34)),
        height: 0.8,
        opacity: round(0.15 + ((y - 128) / 52) * 0.3),
      }),
    );
  }
  out.push(waves);
  // Isla del templo con cascada.
  out.push(
    svgEl("rect", {
      x: 214,
      y: 124,
      width: 6,
      height: 56,
      fill: linear(ctx, [
        ["0%", A.snow, 0.8],
        ["100%", A.snow, 0],
      ]),
    }),
  );
  out.push(island(ctx, 88, 236, 120, 38, A.rock, A.moss));
  const temple = svgEl("g", {}, [
    svgEl("rect", { x: 112, y: 114, width: 100, height: 6, fill: A.marble }),
    svgEl("rect", { x: 118, y: 109, width: 88, height: 5, fill: A.marbleShade }),
    svgEl("polygon", { points: pts([118, 78, 162, 60, 206, 78]), fill: A.marble }),
    svgEl("rect", { x: 118, y: 78, width: 88, height: 4, fill: A.marbleShade }),
  ]);
  for (let i = 0; i < 5; i++) {
    temple.appendChild(svgEl("rect", { x: 124 + i * 18, y: 82, width: 6, height: 27, fill: A.marble }));
    temple.appendChild(svgEl("rect", { x: 128 + i * 18, y: 82, width: 2, height: 27, fill: A.marbleShade }));
  }
  out.push(temple);
  const moss = svgEl("g", { fill: A.moss });
  for (let i = 0; i < 8; i++) {
    moss.appendChild(
      svgEl("ellipse", {
        cx: round(between(rng, 96, 228)),
        cy: round(between(rng, 121, 128)),
        rx: round(between(rng, 3, 8)),
        ry: round(between(rng, 1.5, 3)),
      }),
    );
  }
  out.push(moss);
  // Farol mayor (luz intensa) y faroles flotantes.
  out.push(
    svgEl("rect", { x: 158, y: 88, width: 8, height: 11, rx: 2, fill: A.lantern }),
    lensFlare(ctx, 162, 93, 6, A.lantern),
  );
  const lanterns = svgEl("g", {});
  const halo = radial(ctx, [
    ["0%", A.lantern, 0.8],
    ["100%", A.lantern, 0],
  ]);
  for (let i = 0; i < 9; i++) {
    const x = between(rng, 12, 308);
    const y = between(rng, 40, 150);
    const s = between(rng, 0.6, 1.2);
    lanterns.appendChild(svgEl("circle", { cx: round(x), cy: round(y), r: round(7 * s), fill: halo }));
    lanterns.appendChild(
      svgEl("rect", { x: round(x - 2 * s), y: round(y - 3 * s), width: round(4 * s), height: round(6 * s), rx: 1, fill: A.lantern }),
    );
  }
  out.push(lanterns);
  const petals = svgEl("g", { fill: A.petal });
  for (let i = 0; i < 12; i++) {
    const x = between(rng, 0, VIEW_W);
    const y = between(rng, 10, 170);
    petals.appendChild(
      svgEl("ellipse", {
        cx: round(x),
        cy: round(y),
        rx: 1.8,
        ry: 0.9,
        transform: `rotate(${Math.round(between(rng, 0, 180))} ${round(x)} ${round(y)})`,
        opacity: 0.85,
      }),
    );
  }
  out.push(petals);
  // Primer plano: ramas con musgo.
  out.push(
    svgEl("path", { d: "M-6 22 C30 18 60 6 92 -6 L100 -6 C70 12 40 30 -6 34 Z", fill: A.branch }),
    svgEl("path", { d: "M326 8 C300 14 280 26 262 -6 L254 -6 C272 30 300 24 326 20 Z", fill: A.branch }),
    svgEl("path", { d: `${leafy(30, 22)} ${leafy(58, 12)} ${leafy(80, 2)} ${leafy(290, 18)}`, fill: A.moss }),
  );
  return out;
}

function leafy(x: number, y: number): string {
  return `M${x - 6} ${y} a6 3.5 0 1 0 12 0 a6 3.5 0 1 0 -12 0`;
}

function trainingScene(ctx: SceneCtx): SVGElement[] {
  const { t, rng } = ctx;
  const A = STAGE_ART.training;
  const out: SVGElement[] = [];
  out.push(
    svgEl("rect", {
      width: VIEW_W,
      height: VIEW_H,
      fill: linear(ctx, [
        ["0%", A.bgTop],
        ["100%", A.bgLow],
      ]),
    }),
  );
  // Rejilla de medición.
  const grid = svgEl("g", { stroke: t("border"), "stroke-width": 0.6, opacity: 0.6 });
  for (let x = 0; x <= VIEW_W; x += 16) grid.appendChild(svgEl("line", { x1: x, y1: 0, x2: x, y2: 112 }));
  for (let y = 0; y <= 112; y += 16) grid.appendChild(svgEl("line", { x1: 0, y1: y, x2: VIEW_W, y2: y }));
  const major = svgEl("g", { stroke: t("primary"), "stroke-width": 0.8, opacity: 0.45 });
  for (let x = 0; x <= VIEW_W; x += 64) major.appendChild(svgEl("line", { x1: x, y1: 0, x2: x, y2: 112 }));
  major.appendChild(svgEl("line", { x1: 0, y1: 64, x2: VIEW_W, y2: 64 }));
  out.push(grid, major);
  // Línea de escaneo.
  out.push(svgEl("rect", { x: 0, y: round(between(rng, 20, 90)), width: VIEW_W, height: 2, fill: t("primary"), opacity: 0.6 }));
  // Gradas.
  const bleachers = svgEl("g", {});
  for (let i = 0; i < 4; i++) {
    const y = 92 + i * 6;
    bleachers.appendChild(svgEl("rect", { x: 0, y, width: VIEW_W, height: 6, fill: A.bleacher }));
    bleachers.appendChild(svgEl("rect", { x: 0, y, width: VIEW_W, height: 1, fill: A.bleacherEdge }));
  }
  out.push(bleachers);
  // Pantallas de datos y marcador.
  const screen = (x: number, y: number) => {
    const g = svgEl("g", {}, [
      svgEl("rect", { x, y, width: 44, height: 26, fill: A.dark, stroke: t("primary"), "stroke-width": 1 }),
    ]);
    for (let i = 0; i < 6; i++) {
      const h = between(rng, 4, 18);
      g.appendChild(
        svgEl("rect", { x: x + 4 + i * 6.5, y: round(y + 23 - h), width: 4, height: round(h), fill: t("success"), opacity: 0.85 }),
      );
    }
    return g;
  };
  out.push(screen(20, 40), screen(256, 40));
  out.push(
    svgEl("rect", { x: 130, y: 30, width: 60, height: 20, fill: A.dark, stroke: t("border"), "stroke-width": 1 }),
    svgEl("rect", { x: 136, y: 36, width: 20, height: 8, fill: t("focus"), opacity: 0.9 }),
    svgEl("rect", { x: 164, y: 36, width: 20, height: 8, fill: t("danger"), opacity: 0.9 }),
  );
  // Suelo en perspectiva.
  out.push(svgEl("rect", { y: 116, width: VIEW_W, height: 64, fill: A.dark }));
  const floor = svgEl("g", { stroke: t("primary"), "stroke-width": 0.6, opacity: 0.35 });
  for (let i = -8; i <= 8; i++) floor.appendChild(svgEl("line", { x1: 160 + i * 8, y1: 116, x2: 160 + i * 44, y2: 180 }));
  for (const y of [124, 136, 154]) floor.appendChild(svgEl("line", { x1: 0, y1: y, x2: VIEW_W, y2: y }));
  out.push(floor);
  // Focos de estudio (luces intensas).
  const cone = linear(ctx, [
    ["0%", A.spot, 0.22],
    ["100%", A.spot, 0],
  ]);
  for (const x of [60, 160, 260]) {
    out.push(
      svgEl("polygon", { points: pts([x - 5, 6, x + 5, 6, x + 40, 140, x - 40, 140]), fill: cone }),
      svgEl("rect", { x: x - 8, y: 0, width: 16, height: 7, fill: A.steel }),
    );
  }
  const dust = svgEl("g", { fill: A.spot });
  for (let i = 0; i < 22; i++) {
    const x = [60, 160, 260][i % 3] + between(rng, -28, 28);
    dust.appendChild(
      svgEl("circle", { cx: round(x), cy: round(between(rng, 20, 130)), r: round(between(rng, 0.3, 0.9)), opacity: 0.6 }),
    );
  }
  out.push(dust);
  // Plataforma de acero con borde emisivo y saco de entrenamiento.
  out.push(
    svgEl("rect", { x: 62, y: 128, width: 196, height: 12, fill: A.steel }),
    svgEl("rect", { x: 62, y: 127, width: 196, height: 2, fill: t("primary") }),
    svgEl("rect", { x: 62, y: 140, width: 196, height: 2, fill: t("primary"), opacity: 0.4 }),
    svgEl("rect", { x: 90, y: 142, width: 6, height: 24, fill: A.steel }),
    svgEl("rect", { x: 224, y: 142, width: 6, height: 24, fill: A.steel }),
  );
  const bag = CHARACTERS.sandbag.color;
  out.push(
    svgEl("path", { d: "M196 127 C190 116 192 102 200 96 L199 91 L211 91 L210 96 C218 102 220 116 214 127 Z", fill: bag }),
    svgEl("path", { d: "M200 96 L210 96", stroke: A.dark, "stroke-width": 1.5 }),
  );
  // Dron cámara.
  out.push(
    svgEl("rect", { x: 236, y: 70, width: 14, height: 6, rx: 2, fill: A.steel }),
    svgEl("rect", { x: 230, y: 67, width: 26, height: 1.5, fill: A.steel }),
    svgEl("circle", { cx: 243, cy: 78, r: 1.6, fill: t("danger") }),
  );
  out.push(lensFlare(ctx, 60, 7, 5, A.spot), lensFlare(ctx, 160, 7, 5, A.spot), lensFlare(ctx, 260, 7, 5, A.spot));
  // Primer plano: barandillas.
  const rail = svgEl("g", { fill: A.dark });
  rail.appendChild(svgEl("rect", { y: 160, width: VIEW_W, height: 3 }));
  rail.appendChild(svgEl("rect", { y: 172, width: VIEW_W, height: 2 }));
  for (let x = 6; x < VIEW_W; x += 34) rail.appendChild(svgEl("rect", { x, y: 158, width: 3, height: 22 }));
  out.push(rail, svgEl("rect", { y: 160, width: VIEW_W, height: 0.8, fill: t("primary"), opacity: 0.5 }));
  return out;
}

const SCENES: Record<StageId, (ctx: SceneCtx) => SVGElement[]> = {
  neonIsland: neonScene,
  sunsetIsland: sunsetScene,
  voidIsland: sanctuaryScene,
  training: trainingScene,
};

/**
 * Construye el `<svg>` de vista previa de un escenario.
 * Lanza si el id no tiene arte (el llamador debe usar el marcador).
 */
export function createStagePreviewSvg(
  id: string,
  opts: Pick<StagePreviewOptions, "decorative" | "inlineTokens"> = {},
): SVGSVGElement {
  if (!has(SCENES, id)) throw new Error(`Sin vista previa para el escenario "${id}"`);
  const defs = svgEl("defs");
  const ctx: SceneCtx = {
    t: tokenResolver(opts.inlineTokens),
    rng: createVisualRng(PREVIEW_SEEDS[id]),
    defs,
    uid: (p) => uniqueId(`kb-stg-${p}`),
  };
  const layers = SCENES[id](ctx);
  // Viñeta sutil para unificar el encuadre.
  const vignette = radial(ctx, [
    ["60%", ctx.t("bg"), 0],
    ["100%", ctx.t("bg"), 0.55],
  ]);
  const svg = svgEl(
    "svg",
    {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      class: "kb-stage-preview__svg",
      preserveAspectRatio: "xMidYMid slice",
      width: "100%",
      style: "display:block;height:auto",
      "data-stage-id": id,
    },
    [defs, ...layers, svgEl("rect", { width: VIEW_W, height: VIEW_H, fill: vignette })],
  );
  applyA11y(svg, stageLore(id).name, opts.decorative);
  return svg;
}

/** Marcador de respaldo (R3.7): colores del Sistema_Diseño y nombre visible. */
export function createStagePlaceholder(id: string): HTMLElement {
  const name = stageLore(id).name;
  const ph = document.createElement("div");
  ph.className = "kb-stage-preview__placeholder";
  ph.setAttribute("role", "img");
  ph.setAttribute("aria-label", name);
  ph.setAttribute(
    "style",
    "display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;width:100%;" +
      "box-sizing:border-box;padding:var(--space-4);background:var(--color-surface);" +
      "border:2px solid var(--color-border);border-radius:var(--radius-md);" +
      "color:var(--color-text);font-family:var(--font-display);font-size:var(--fs-h2);" +
      "text-align:center;overflow-wrap:anywhere",
  );
  const label = document.createElement("span");
  label.className = "kb-stage-preview__name";
  label.textContent = name;
  ph.appendChild(label);
  return ph;
}

/**
 * Contenedor de la vista previa de un escenario. Si el arte falla (id sin
 * arte o error de construcción) muestra el marcador en la misma caja.
 */
export function createStagePreview(id: string, opts: StagePreviewOptions = {}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = opts.className ? `kb-stage-preview ${opts.className}` : "kb-stage-preview";
  wrap.dataset.stageId = id;
  if (opts.forceFallback) {
    showStagePlaceholder(wrap, id);
    return wrap;
  }
  try {
    wrap.appendChild(createStagePreviewSvg(id, opts));
    wrap.dataset.preview = "svg";
  } catch {
    showStagePlaceholder(wrap, id);
  }
  return wrap;
}

/** Sustituye el contenido de un contenedor de vista previa por el marcador. */
export function showStagePlaceholder(wrap: HTMLElement, id: string): void {
  wrap.replaceChildren(createStagePlaceholder(id));
  wrap.dataset.preview = "placeholder";
}
