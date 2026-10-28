/** Vector 2D mutable. Lo usamos para posición, velocidad, etc. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Caja de colisión alineada a ejes (Axis-Aligned Bounding Box).
 *  (x, y) es la esquina superior izquierda. */
export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}
