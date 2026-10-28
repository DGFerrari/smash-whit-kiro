import { BLAST_ZONE } from "../config.ts";
import type { Player } from "../entities/player.ts";
import type { Platform } from "../physics/platform.ts";
import type { Camera } from "./camera.ts";
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

  render(
    player: Player,
    dummy: Player,
    platforms: Platform[],
    camera: Camera,
    lives: number,
    alpha: number,
  ): void {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;

    this.updateFps();
    this.drawBackground(ctx, w, h);

    // --- Mundo (afectado por la cámara) ---
    ctx.save();
    camera.apply(ctx);
    this.drawPlatforms(ctx, platforms);
    if (debug.showBlastZone) this.drawBlastZone(ctx);
    // El dummy es un Player: se dibuja igual, con otro color y sin ataque.
    this.drawFighter(ctx, dummy, alpha, "#c45b7a");
    this.drawFighter(ctx, player, alpha, "#7fb2ff");
    this.drawAttack(ctx, player); // el "cubo" del ataque del jugador
    if (debug.showHitboxes) {
      this.drawHitbox(ctx, player, alpha);
      this.drawHitbox(ctx, dummy, alpha);
    }
    ctx.restore();

    // --- HUD y overlays de debug (espacio de pantalla) ---
    // Panel de porcentajes + vidas estilo Smash (abajo, centrado).
    const entries: PercentEntry[] = [
      { label: "P1", color: "#7fb2ff", damage: player.damage, lives },
      { label: "DUMMY", color: "#c45b7a", damage: dummy.damage, lives: -1 },
    ];
    drawPercentHud(ctx, entries, w, h);

    if (debug.showStats) this.drawStats(ctx, player, camera);
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
    if (fighter.hitFlash > 0) {
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

}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
