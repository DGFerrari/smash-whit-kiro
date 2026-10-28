import { CAMERA, VIEW, WORLD } from "../config.ts";
import { debug } from "../debug/debugState.ts";
import type { World } from "../game/world.ts";

/**
 * Cámara 2D de encuadre estilo Smash.
 *
 * Cada frame construye una caja objetivo (en coords de mundo) que contiene:
 *   - el encuadre base centrado en la isla, y
 *   - al jugador,
 * con un margen alrededor. Luego elige el centro (el de esa caja) y el zoom
 * necesario para que la caja quepa justo en el viewport. Así:
 *   - sobre la isla la cámara está "en reposo" (encuadre base),
 *   - al alejarte, la caja crece hacia ti -> el centro se desplaza un poco y el
 *     zoom baja, dejándote al filo de la pantalla cuando tocas la blast zone.
 *
 * El viewport lógico es VIEW.width x VIEW.height; el canvas real (pantalla
 * completa) se escala para encajarlo.
 */
export class Camera {
  /** Centro de la cámara, en coordenadas de mundo (suavizado). */
  private readonly focus: { x: number; y: number } = {
    x: WORLD.centerX,
    y: WORLD.groundY,
  };
  /** Zoom actual (suavizado) y objetivo. */
  private zoom: number = 1;
  private targetZoom: number = 1;

  /** Boost de zoom de pausa (1 = sin boost). Se suaviza aparte. */
  private pauseBoost = 1;
  private targetPauseBoost = 1;

  /** ¿Pausado? En pausa el foco se desplaza hacia el jugador. */
  private paused = false;

  /** Tamaño real del canvas en píxeles de pantalla. */
  private screenW: number = VIEW.width;
  private screenH: number = VIEW.height;
  /** Escala para encajar el viewport lógico en el canvas real. */
  private fit = 1;

  resize(screenW: number, screenH: number): void {
    this.screenW = screenW;
    this.screenH = screenH;
    this.fit = Math.min(screenW / VIEW.width, screenH / VIEW.height);
  }

  /** Activa/desactiva el zoom extra de pausa y el reencuadre hacia el jugador. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.targetPauseBoost = paused ? CAMERA.pauseZoomBoost : 1;
  }

  /**
   * Override cinemático: en vez del encuadre automático, la cámara persigue
   * (suavizado) un punto de mundo y un zoom concretos. Lo usa la intro para
   * recorrer a los jugadores. Llamar a clearCinematic() para volver al auto.
   */
  private cinematic: { x: number; y: number; zoom: number } | null = null;

  focusOn(x: number, y: number, zoom: number): void {
    this.cinematic = { x, y, zoom };
  }

  clearCinematic(): void {
    this.cinematic = null;
  }

  /** Avanza solo el suavizado del override cinemático (sin tocar el auto). */
  updateCinematic(): void {
    if (!this.cinematic) return;
    this.focus.x += (this.cinematic.x - this.focus.x) * CAMERA.smooth;
    this.focus.y += (this.cinematic.y - this.focus.y) * CAMERA.smooth;
    this.zoom += (this.cinematic.zoom - this.zoom) * CAMERA.zoomSmooth;
    this.targetZoom = this.zoom;
    this.pauseBoost += (1 - this.pauseBoost) * 0.12;
  }

  /**
   * Coloca la cámara directamente en su objetivo (sin suavizar), útil al
   * iniciar para no ver un "viaje" de la cámara en el primer frame.
   */
  snapTo(world: World): void {
    const box = this.computeTargetBox(world);
    this.focus.x = box.cx;
    this.focus.y = box.cy;
    this.zoom = this.zoomForBox(box.halfW, box.halfH);
    this.targetZoom = this.zoom;
  }

  /**
   * Actualiza la cámara (una vez por frame de render; es puramente visual).
   */
  follow(world: World): void {
    // Durante un override cinemático, la intro conduce la cámara.
    if (this.cinematic) {
      this.updateCinematic();
      return;
    }

    const box = this.computeTargetBox(world);

    // Centro objetivo. Al pausar lo desplazamos hacia el jugador principal
    // (reencuadre); al despausar vuelve al centro del encuadre normal.
    let targetX = box.cx;
    let targetY = box.cy;
    if (this.paused) {
      const p = world.player;
      const px = p.pos.x + p.width / 2;
      const py = p.pos.y + p.height / 2;
      const t = CAMERA.pauseFocusLerp;
      targetX = box.cx + (px - box.cx) * t;
      targetY = box.cy + (py - box.cy) * t;
    }

    // Suavizado de posición hacia el centro objetivo.
    this.focus.x += (targetX - this.focus.x) * CAMERA.smooth;
    this.focus.y += (targetY - this.focus.y) * CAMERA.smooth;

    // Zoom objetivo: el que hace que la caja quepa justo en pantalla.
    this.targetZoom = this.zoomForBox(box.halfW, box.halfH);
    this.zoom += (this.targetZoom - this.zoom) * CAMERA.zoomSmooth;

    // Boost de pausa suavizado.
    this.pauseBoost += (this.targetPauseBoost - this.pauseBoost) * 0.12;
  }

  /**
   * Caja objetivo en mundo: centro (cx, cy) y semiejes (halfW, halfH) que
   * contienen el encuadre base de la isla y a TODOS los combatientes vivos,
   * con margen. Así en versus la cámara encuadra a ambos jugadores.
   */
  private computeTargetBox(world: World): {
    cx: number;
    cy: number;
    halfW: number;
    halfH: number;
  } {
    const baseCx = WORLD.centerX;
    const baseCy = WORLD.groundY + CAMERA.baseCenterOffsetY;

    // Bordes del encuadre base (isla en reposo).
    let left = baseCx - CAMERA.baseHalfWidth;
    let right = baseCx + CAMERA.baseHalfWidth;
    let top = baseCy - CAMERA.baseHalfHeight;
    let bottom = baseCy + CAMERA.baseHalfHeight;

    // Expandimos la caja para incluir a cada combatiente vivo (su centro).
    for (const f of world.fighters) {
      if (!f.alive || f.isDead) continue;
      const p = f.player;
      const px = p.pos.x + p.width / 2;
      const py = p.pos.y + p.height / 2;
      left = Math.min(left, px - CAMERA.margin);
      right = Math.max(right, px + CAMERA.margin);
      top = Math.min(top, py - CAMERA.margin);
      bottom = Math.max(bottom, py + CAMERA.margin);
    }

    return {
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
      halfW: (right - left) / 2,
      halfH: (bottom - top) / 2,
    };
  }

  /**
   * Zoom que hace que una caja de semiejes (halfW, halfH) quepa justo en el
   * viewport lógico. Tomamos el eje más restrictivo y aplicamos topes.
   */
  private zoomForBox(halfW: number, halfH: number): number {
    const zx = VIEW.width / 2 / halfW;
    const zy = VIEW.height / 2 / halfH;
    const z = Math.min(zx, zy);
    return clamp(z, CAMERA.minZoom, CAMERA.maxZoom);
  }

  /**
   * Aplica la transformación de cámara al contexto. Tras esto, dibujar en
   * coordenadas de mundo aparece bien colocado. El llamante hace save/restore.
   */
  apply(ctx: CanvasRenderingContext2D): void {
    // povZoom es el ajuste del jugador en Opciones (multiplicador global).
    const scale = this.fit * this.zoom * this.pauseBoost * debug.povZoom;
    ctx.translate(this.screenW / 2, this.screenH / 2);
    ctx.scale(scale, scale);
    ctx.translate(-this.focus.x, -this.focus.y);
  }

  get screenWidth(): number {
    return this.screenW;
  }
  get screenHeight(): number {
    return this.screenH;
  }
  /** Zoom lógico actual (sin el factor de encaje a pantalla ni pausa). */
  get currentZoom(): number {
    return this.zoom;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
