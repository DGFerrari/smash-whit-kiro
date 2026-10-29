/**
 * HUD de porcentajes estilo Smash Bros: una fila de recuadros en la parte
 * inferior, uno por combatiente, con su nombre y su % de daño en grande.
 *
 * Es agnóstico de la entidad: recibe una lista de PercentEntry, así sirve igual
 * para 1 jugador, 2, o jugador + dummy. Dibuja sobre el canvas 2D en espacio de
 * pantalla (no lo afecta la cámara).
 */

export interface PercentEntry {
  /** Etiqueta corta, p. ej. "P1", "CPU", "DUMMY". */
  label: string;
  /** Color identificativo del combatiente (debe casar con su color en el juego). */
  color: string;
  /** Daño acumulado en %. */
  damage: number;
  /** Vidas restantes. Usa -1 para no mostrar medidor de vidas (p. ej. dummy). */
  lives: number;
  /**
   * Animación de entrada/salida de la tarjeta [0..1]:
   *   1 = colocada en su sitio; 0 = fuera (caída abajo). Valores intermedios
   *   interpolan la caída/surgimiento. Por defecto 1.
   */
  anim?: number;
  /** Carga de furia [0..1] para la barra. */
  fury?: number;
  /** ¿Modo furia activo? (barra brillando de colores). */
  furyActive?: boolean;
}

export function drawPercentHud(
  ctx: CanvasRenderingContext2D,
  entries: PercentEntry[],
  screenW: number,
  screenH: number,
): void {
  if (entries.length === 0) return;

  const boxW = 150;
  const boxH = 104;
  const gap = 18;
  const totalW = entries.length * boxW + (entries.length - 1) * gap;
  const startX = (screenW - totalW) / 2;
  const y = screenH - boxH - 24;

  entries.forEach((e, i) => {
    const x = startX + i * (boxW + gap);
    // Animación de caída/surgimiento: anim=1 en su sitio; anim=0 fuera (abajo).
    const anim = e.anim ?? 1;
    // Desplazamiento vertical hacia abajo fuera de pantalla cuando anim->0.
    const fallDist = boxH + 60;
    const ay = y + (1 - easeOutBack(anim)) * fallDist;
    drawBox(ctx, e, x, ay, boxW, boxH, anim);
  });
}

/** Easing con pequeño rebote al asentarse (para el "surgir" de la tarjeta). */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  e: PercentEntry,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  // Fondo del recuadro con un borde del color del combatiente.
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = "rgba(10, 14, 22, 0.85)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = e.color;
  ctx.stroke();

  // Etiqueta del combatiente.
  ctx.textAlign = "center";
  ctx.font = "700 14px system-ui, sans-serif";
  ctx.fillStyle = e.color;
  ctx.textBaseline = "top";
  ctx.fillText(e.label, x + w / 2, y + 8);

  // Porcentaje grande. El color sube de blanco a rojo con el daño, como Smash.
  const pct = Math.round(e.damage);
  ctx.font = "800 34px system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = percentColor(pct);
  ctx.fillText(`${pct}%`, x + w / 2, y + 62);

  // Medidor de vidas (iconos) en la base del recuadro.
  if (e.lives >= 0) {
    drawLives(ctx, e.lives, e.color, x + w / 2, y + h - 16);
  }

  // Barra de furia: franja fina en el borde inferior del recuadro.
  drawFuryBar(ctx, e, x, y, w, h);

  ctx.restore();
}

/** Barra de furia en la base del recuadro (brilla de colores si está activa). */
function drawFuryBar(
  ctx: CanvasRenderingContext2D,
  e: PercentEntry,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const fury = e.fury ?? 0;
  if (fury <= 0 && !e.furyActive) return;

  const pad = 10;
  const barW = w - pad * 2;
  const barH = 5;
  const bx = x + pad;
  const by = y + h - 6;

  // Fondo de la barra.
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(bx, by, barW, barH);

  if (e.furyActive) {
    // Furia activa: barra llena con un degradado arcoíris animado.
    const t = performance.now() / 600;
    const grad = ctx.createLinearGradient(bx, 0, bx + barW, 0);
    for (let i = 0; i <= 6; i++) {
      const hue = (i / 6 + t) % 1;
      grad.addColorStop(i / 6, `hsl(${hue * 360}, 95%, 60%)`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, barW, barH);
  } else {
    // Cargando: barra proporcional en el color del combatiente.
    ctx.fillStyle = e.color;
    ctx.fillRect(bx, by, barW * fury, barH);
  }
}

/** Dibuja `lives` iconos de vida centrados en (cx, y). */
function drawLives(
  ctx: CanvasRenderingContext2D,
  lives: number,
  color: string,
  cx: number,
  y: number,
): void {
  const size = 11;
  const gap = 6;
  const total = lives * size + Math.max(0, lives - 1) * gap;
  let ix = cx - total / 2;
  for (let i = 0; i < lives; i++) {
    ctx.fillStyle = color;
    // Rombo pequeño como icono de vida.
    ctx.beginPath();
    ctx.moveTo(ix + size / 2, y);
    ctx.lineTo(ix + size, y + size / 2);
    ctx.lineTo(ix + size / 2, y + size);
    ctx.lineTo(ix, y + size / 2);
    ctx.closePath();
    ctx.fill();
    ix += size + gap;
  }
}

/** Color del número de %: blanco (0) -> amarillo -> naranja -> rojo (alto). */
function percentColor(pct: number): string {
  if (pct <= 0) return "#ffffff";
  const t = Math.min(pct / 150, 1); // satura a 150%
  // blanco -> amarillo (0..0.4) -> rojo (0.4..1)
  if (t < 0.4) {
    const k = t / 0.4;
    const b = Math.round(255 - 180 * k);
    return `rgb(255,255,${b})`;
  }
  const k = (t - 0.4) / 0.6;
  const g = Math.round(220 - 180 * k);
  return `rgb(255,${g},60)`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
