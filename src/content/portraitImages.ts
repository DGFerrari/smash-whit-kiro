/**
 * Retratos con IMAGEN (PNG, JPG, WebP, GIF o SVG) por personaje.
 *
 * Si un personaje tiene aquí una ruta, sus retratos (selección, HUD, pantalla
 * de carga, resultados, repeticiones…) muestran esa imagen. Si el archivo no
 * existe o falla al cargar, se usa automáticamente el retrato SVG dibujado
 * por código, así que nunca se rompe nada.
 *
 * Las rutas son relativas a `public/` (p. ej. `public/portraits/el-primo.webp`
 * se escribe `"portraits/el-primo.webp"`). Recomendado: render de cuerpo
 * entero vertical (≈ 3:4) con fondo transparente; los retratos muestran la
 * parte superior (cabeza a cintura) según `PORTRAIT_CROP`.
 */
import type { CharacterId } from "../engine/game/characters.ts";

export const PORTRAIT_IMAGES: Partial<Record<CharacterId, string>> = {
  blue: "portraits/el-primo.webp",
};

/** Fracción superior de la imagen que se ve en los retratos (busto). */
export const PORTRAIT_CROP = 0.64;

/** URL absoluta (con la base de Vite) del retrato con imagen, o `null`. */
export function portraitImageUrl(id: string): string | null {
  const rel = (PORTRAIT_IMAGES as Record<string, string | undefined>)[id];
  if (!rel) return null;
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? "/";
  return (base.endsWith("/") ? base : `${base}/`) + rel.replace(/^\/+/, "");
}
