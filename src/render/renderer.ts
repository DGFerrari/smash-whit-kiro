import { BLAST_ZONE } from "../config.ts";
import type { Player } from "../entities/player.ts";
import type { Platform } from "../physics/platform.ts";
import type { Camera } from "./camera.ts";
import type { World, DeathEffect } from "../game/world.ts";
import { debug } from "../debug/debugState.ts";
import { drawPercentHud, type PercentEntry } from "../ui/percentHud.ts";

/**
 * Dibuja el estado del juego en el canvas 2D a pantalla completa.
 *
 * El flujo es:
 *   1. Pintar el fondo (en espacio de pantalla, no se mueve con la cámara).
 *   2. Aplicar la cámara y dibujar el mundo (isla + jugador) en coords de mundo.
 *   3. Pintar el HUD encima (espacio de pantalla).
 *
 * `alpha` es el factor de interpolación [0..1] entre el paso de física anterior
 * y el actual, para que el movimiento se vea suave a cualquier tasa de refresco.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;

  /** Medición de FPS: media móvil del tiempo entre frames. */
  private fps = 0;
  private lastFrameTime = performance.now();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo obtener el contexto 2D del canvas");
    this.ctx = ctx;
    this.resize();
  }

  /** Ajusta el canvas al tamaño de la ventana (con densidad de píxeles). */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    // Trabajamos en píxeles CSS; el dpr lo absorbe esta escala base.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get cssWidth(): number {
    return window.innerWidth;
  }
  get cssHeight(): number {
    return window.innerHeight;
  }

  render(world: World, camera: Camera, alpha: number): void {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;

    this.updateFps();
    this.drawBackground(ctx, w, h);

    // --- Mundo (afectado por la cámara) ---
    ctx.save();
    camera.apply(ctx);
    this.drawPlatforms(ctx, world.platforms);
    // Plataformas temporales de reaparición (una por combatiente que acaba de
    // reaparecer): se dibujan distintas para comunicar que son efímeras.
    for (const f of world.fighters) {
      if (f.respawnPlatform && f.respawnPlatformBlinkOn) {
        this.drawRespawnPlatform(ctx, f.respawnPlatform);
      }
    }
    if (debug.showBlastZone) this.drawBlastZone(ctx);

    // Combatientes vivos y sus ataques/escudos.
    for (const f of world.fighters) {
      if (!f.alive || f.isDead) continue;
      this.drawShield(ctx, f.player, alpha);
      this.drawFighter(ctx, f.player, alpha, f.color);
      this.drawAttack(ctx, f.player);
      if (debug.showHitboxes) this.drawHitbox(ctx, f.player, alpha);
    }

    // Efectos de muerte encima de todo (en coords de mundo).
    for (const e of world.deathEffects) this.drawDeathEffect(ctx, e);

    ctx.restore();

    // --- HUD y overlays de debug (espacio de pantalla) ---
    const entries: PercentEntry[] = world.fighters.map((f) => ({
      label: f.label,
      color: f.color,
      damage: f.player.damage,
      // Vidas infinitas (dummy) -> -1 oculta el medidor.
      lives: Number.isFinite(f.lives) ? f.lives : -1,
      anim: f.hudAnim,
    }));
    drawPercentHud(ctx, entries, w, h);

    if (debug.showStats) this.drawStats(ctx, world.player, camera);
    if (debug.showFps) this.drawFps(ctx);
  }

  private updateFps(): void {
    const now = performance.now();
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;
    if (dt > 0) {
      const instant = 1000 / dt;
      // Media móvil exponencial para que el número no baile.
      this.fps = this.fps === 0 ? instant : this.fps * 0.9 + instant * 0.1;
    }
  }

  /** Dibuja el rectángulo de la blast zone en coords de mundo. */
  private drawBlastZone(ctx: CanvasRenderingContext2D): void {
    const x = BLAST_ZONE.left;
    const y = BLAST_ZONE.top;
    const w = BLAST_ZONE.right - BLAST_ZONE.left;
    const h = BLAST_ZONE.bottom - BLAST_ZONE.top;

    ctx.save();
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 10]);
    ctx.strokeStyle = "rgba(255, 80, 80, 0.85)";
    ctx.strokeRect(x, y, w, h);
    // Relleno muy tenue fuera de la zona segura para dar idea del límite.
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 80, 80, 0.05)";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /** Dibuja el contorno de la caja de colisión del jugador. */
  private drawHitbox(
    ctx: CanvasRenderingContext2D,
    player: Player,
    alpha: number,
  ): void {
    const rx = lerp(player.prevPos.x, player.pos.x, alpha);
    const ry = lerp(player.prevPos.y, player.pos.y, alpha);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(80, 255, 140, 0.95)";
    ctx.strokeRect(rx, ry, player.width, player.height);
    // Punto central.
    ctx.fillStyle = "rgba(80, 255, 140, 0.95)";
    ctx.fillRect(rx + player.width / 2 - 1, ry + player.height / 2 - 1, 2, 2);
    ctx.restore();
  }

  private drawStats(
    ctx: CanvasRenderingContext2D,
    player: Player,
    camera: Camera,
  ): void {
    const lines = [
      `pos  x:${player.pos.x.toFixed(1)}  y:${player.pos.y.toFixed(1)}`,
      `vel  x:${player.vel.x.toFixed(1)}  y:${player.vel.y.toFixed(1)}`,
      `suelo: ${player.onGround ? "sí" : "no"}   mira: ${
        player.facing === 1 ? "→" : "←"
      }`,
      `zoom: ${camera.currentZoom.toFixed(2)}`,
    ];

    ctx.save();
    ctx.font = "13px ui-monospace, monospace";
    ctx.textBaseline = "top";
    const pad = 10;
    const lineH = 18;
    const boxW = 240;
    const boxH = pad * 2 + lines.length * lineH;
    const x = 16;
    const y = 68;

    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = "#9ed8a0";
    lines.forEach((line, i) => {
      ctx.fillText(line, x + pad, y + pad + i * lineH);
    });
    ctx.restore();
  }

  private drawFps(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.font = "600 14px ui-monospace, monospace";
    ctx.textBaseline = "top";
    const text = `${Math.round(this.fps)} FPS`;
    const w = ctx.measureText(text).width + 16;
    const x = this.cssWidth - w - 16;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, 16, w, 26);
    ctx.fillStyle = "#ffd36b";
    ctx.fillText(text, x + 8, 21);
    ctx.restore();
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    // Degradado vertical tipo "cielo profundo" para dar sensación de vacío.
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0b1a33");
    grad.addColorStop(1, "#060a14");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  private drawPlatforms(
    ctx: CanvasRenderingContext2D,
    platforms: Platform[],
  ): void {
    for (const p of platforms) {
      const { x, y, w, h } = p.box;
      if (p.oneWay) {
        // Plataforma atravesable: barra fina y semitransparente, para
        // comunicar que solo sostiene desde arriba.
        ctx.fillStyle = "rgba(127, 178, 255, 0.35)";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "#7fb2ff";
        ctx.fillRect(x, y, w, 4); // borde superior sólido (donde te apoyas)
      } else {
        // Isla sólida.
        ctx.fillStyle = "#3a4a66";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "#5b7fa6";
        ctx.fillRect(x, y, w, 6); // césped
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(x, y + h - 10, w, 10); // sombra inferior
      }
    }
  }

  /**
   * Dibuja un combatiente (jugador o dummy; ambos son Player). `baseColor` es
   * su color identificativo; se tiñe de blanco al recibir golpe y cambia con
   * el estado (agarre a pared / aire).
   */
  private drawFighter(
    ctx: CanvasRenderingContext2D,
    fighter: Player,
    alpha: number,
    baseColor: string,
  ): void {
    const rx = lerp(fighter.prevPos.x, fighter.pos.x, alpha);
    const ry = lerp(fighter.prevPos.y, fighter.pos.y, alpha);

    // Color del cuerpo. El flash de golpe siempre manda. Los colores de estado
    // (suelo/aire/pared) solo si el toggle de dev tools está activo.
    let color: string;
    if (fighter.dodging) {
      color = "rgba(200, 230, 255, 0.55)"; // esquiva: translúcido (invulnerable)
    } else if (fighter.hitFlash > 0) {
      color = "#ffffff";
    } else if (debug.showStateColors && fighter.wallSliding) {
      color = "#6bffb0"; // pared
    } else if (debug.showStateColors && !fighter.onGround) {
      color = shade(baseColor, 0.85); // aire (algo más oscuro)
    } else {
      color = baseColor; // suelo / sin colores de estado
    }
    ctx.fillStyle = color;
    ctx.fillRect(rx, ry, fighter.width, fighter.height);

    // Contorno para dar definición.
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeRect(rx, ry, fighter.width, fighter.height);

    // Marca de aturdimiento (dev): aro amarillo si ataca, magenta si golpeado.
    if (debug.showStun && (fighter.stunned || fighter.attacking)) {
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = fighter.stunned ? "#ff53d0" : "#ffd84d";
      ctx.strokeRect(rx - 4, ry - 4, fighter.width + 8, fighter.height + 8);
      // Etiqueta corta encima.
      ctx.font = "700 12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = fighter.stunned ? "#ff53d0" : "#ffd84d";
      ctx.fillText(
        fighter.stunned ? "STUN" : "ATK",
        rx + fighter.width / 2,
        ry - 10,
      );
      ctx.restore();
    }

    // Recursos agotados (dev): avisa si se quedó sin saltos o sin fuerte aéreo.
    if (debug.showResources && (fighter.outOfJumps || fighter.outOfHeavy)) {
      ctx.save();
      ctx.font = "700 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      const labels: string[] = [];
      if (fighter.outOfJumps) labels.push("SIN SALTO");
      if (fighter.outOfHeavy) labels.push("SIN FUERTE");
      ctx.fillStyle = "#ff6b6b";
      labels.forEach((t, i) => {
        ctx.fillText(
          t,
          rx + fighter.width / 2,
          ry + fighter.height + 16 + i * 14,
        );
      });
      ctx.restore();
    }

    // Ojo que marca hacia dónde mira.
    ctx.fillStyle = "#0d1017";
    const eyeW = 6;
    const eyeX =
      fighter.facing === 1 ? rx + fighter.width - eyeW - 6 : rx + 6;
    ctx.fillRect(eyeX, ry + 12, eyeW, 6);

    // Barra de carga del ataque fuerte sobre la cabeza.
    if (fighter.charging) {
      const ratio = fighter.chargeRatio;
      const barW = fighter.width;
      const barH = 6;
      const bx = rx;
      const by = ry - 14;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = chargeColor(ratio);
      ctx.fillRect(bx, by, barW * ratio, barH);
    }
  }

  /** Dibuja el "cubo" placeholder de la hitbox del ataque activo. */
  private drawAttack(ctx: CanvasRenderingContext2D, player: Player): void {
    const atk = player.attack;
    if (!atk || !atk.hitbox) return;
    const { x, y, w, h } = atk.hitbox;

    // Color: ligeros en cian; fuertes según carga (blanco->amarillo->rojo).
    const color =
      atk.def.kind === "light" ? "#7df9ff" : chargeColor(atk.charge);

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  /** Burbuja de escudo alrededor del combatiente (se encoge con su salud). */
  private drawShield(
    ctx: CanvasRenderingContext2D,
    player: Player,
    alpha: number,
  ): void {
    const radius = player.shieldRadius;
    if (radius <= 0) return;
    const rx = lerp(player.prevPos.x, player.pos.x, alpha) + player.width / 2;
    const ry = lerp(player.prevPos.y, player.pos.y, alpha) + player.height / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(rx, ry, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(120, 200, 255, 0.28)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(160, 220, 255, 0.8)";
    ctx.stroke();
    ctx.restore();
  }

  /** Plataforma temporal de reaparición: barra tenue y punteada. */
  private drawRespawnPlatform(
    ctx: CanvasRenderingContext2D,
    p: Platform,
  ): void {
    const { x, y, w, h } = p.box;
    ctx.save();
    ctx.fillStyle = "rgba(180, 210, 255, 0.22)";
    ctx.fillRect(x, y, w, h);
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(180, 210, 255, 0.6)";
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  /**
   * Efecto de muerte: un RAYO vertical estilo Smash que cae desde arriba sobre
   * el punto donde el combatiente salió, con un destello en el impacto. El
   * zigzag es estable (usa la semilla del efecto) y se desvanece con la vida.
   */
  private drawDeathEffect(
    ctx: CanvasRenderingContext2D,
    e: DeathEffect,
  ): void {
    const prog = 1 - e.life / e.maxLife; // 0..1
    // El rayo "cae" rápido (primera mitad) y luego se desvanece.
    const fall = Math.min(1, prog / 0.35);
    const fade = prog < 0.35 ? 1 : 1 - (prog - 0.35) / 0.65;

    // El rayo nace muy arriba del impacto y baja hasta el punto.
    const topY = e.y - 620;
    const tipY = topY + (e.y - topY) * easeOut(fall);

    // Construimos el zigzag del rayo con desviaciones pseudoaleatorias estables.
    const segments = 14;
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const y = topY + (tipY - topY) * s;
      // Amplitud del zigzag mayor arriba, estrecha cerca del impacto.
      const amp = 26 * (1 - s) + 6;
      const jitter = Math.sin((i * 12.9898 + e.seed) * 43.233);
      const x = e.x + (jitter - Math.trunc(jitter)) * 2 * amp - amp;
      points.push({ x, y });
    }

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Halo ancho del rayo (brillo).
    ctx.strokeStyle = e.color;
    ctx.globalAlpha = fade * 0.5;
    ctx.lineWidth = 12;
    this.strokePolyline(ctx, points);

    // Núcleo blanco brillante.
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    this.strokePolyline(ctx, points);

    // Una rama secundaria a media altura para dar el look ramificado.
    const branchStart = points[Math.floor(segments * 0.45)];
    if (branchStart) {
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = fade * 0.7;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(branchStart.x, branchStart.y);
      ctx.lineTo(branchStart.x + 40, branchStart.y + 70);
      ctx.lineTo(branchStart.x + 18, branchStart.y + 120);
      ctx.stroke();
    }

    // Destello/anillo en el punto de impacto (cuando el rayo ya tocó).
    if (fall >= 1) {
      const flashR = 46 * easeOut(Math.min(1, (prog - 0.35) / 0.4));
      ctx.globalAlpha = fade;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(e.x, e.y, 14 * fade, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(e.x, e.y, flashR, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private strokePolyline(
    ctx: CanvasRenderingContext2D,
    points: Array<{ x: number; y: number }>,
  ): void {
    if (points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Suavizado de salida (rápido al principio, lento al final). */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Oscurece (o aclara con f>1) un color hex #rrggbb por un factor f. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/** Color de carga: 0 blanco -> amarillo -> naranja -> 1 rojo. */
function chargeColor(t: number): string {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  if (c < 0.5) {
    // blanco -> amarillo
    const k = c / 0.5;
    const b = Math.round(255 - 255 * k);
    return `rgb(255,255,${b})`;
  }
  // amarillo -> rojo
  const k = (c - 0.5) / 0.5;
  const g = Math.round(255 - 255 * k);
  return `rgb(255,${g},0)`;
}
