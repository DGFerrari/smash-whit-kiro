import type { AABB } from "../core/types.ts";

/** ¿Se solapan dos cajas? (contacto exacto en el borde NO cuenta como solape). */
export function overlaps(a: AABB, b: AABB): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Centro en X de una caja. */
export function centerX(a: AABB): number {
  return a.x + a.w / 2;
}
