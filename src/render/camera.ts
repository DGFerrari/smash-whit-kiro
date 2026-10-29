import * as THREE from "three";
import { CAMERA, VIEW, WORLD } from "../config.ts";
import { debug } from "../debug/debugState.ts";
import type { World } from "../game/world.ts";

/**
 * Cámara de encuadre estilo Smash, ahora en 3D (perspectiva) sobre Three.js.
 *
 * La LÓGICA de encuadre es idéntica a la versión 2D: cada frame calculamos una
 * caja objetivo (en coords de MUNDO 2D) que contiene el encuadre base y a los
 * combatientes, y de ahí sacamos un centro (cx, cy) y un "zoom". La diferencia
 * es cómo se traduce eso a una cámara 3D:
 *
 *  - El mundo 2D tiene Y hacia ABAJO; en 3D usamos Y hacia ARRIBA. La
 *    conversión es (x, y) mundo -> (x, -y) en 3D. Esta clase expone
 *    `worldToSceneY` para que el renderer coloque todo coherentemente.
 *  - El "ancho visible" que antes daba el zoom se mantiene: colocamos la
 *    PerspectiveCamera a la distancia necesaria para que ese ancho encaje en el
 *    FOV, y la elevamos/retranqueamos un poco para dar perspectiva (2.5D).
 */

/** Grados a radianes. */
const DEG = Math.PI / 180;

export class Camera {
  readonly three: THREE.PerspectiveCamera;

  /** Centro de la cámara, en coordenadas de MUNDO 2D (suavizado). */
  private readonly focus: { x: number; y: number } = {
    x: WORLD.centerX,
    y: WORLD.groundY,
  };
  /** Zoom actual (suavizado) y objetivo. Misma semántica que la versión 2D. */
  private zoom = 1;
  private targetZoom = 1;

  private pauseBoost = 1;
  private targetPauseBoost = 1;
  private paused = false;

  private screenW: number = VIEW.width;
  private screenH: number = VIEW.height;

  private cinematic: { x: number; y: number; zoom: number } | null = null;

  constructor() {
    this.three = new THREE.PerspectiveCamera(CAMERA.fov3d, 1, 1, 20000);
  }

  /** Convierte una Y de mundo (abajo+) a Y de escena 3D (arriba+). */
  static worldToSceneY(worldY: number): number {
    return -worldY;
  }

  resize(screenW: number, screenH: number): void {
    this.screenW = screenW;
    this.screenH = screenH;
    this.three.aspect = screenW / Math.max(1, screenH);
    this.three.updateProjectionMatrix();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.targetPauseBoost = paused ? CAMERA.pauseZoomBoost : 1;
  }

  focusOn(x: number, y: number, zoom: number): void {
    this.cinematic = { x, y, zoom };
  }

  /** Congela la cámara donde está (foco y zoom actuales). */
  freeze(): void {
    this.cinematic = { x: this.focus.x, y: this.focus.y, zoom: this.zoom };
  }

  clearCinematic(): void {
    this.cinematic = null;
  }

  private updateCinematic(): void {
    if (!this.cinematic) return;
    this.focus.x += (this.cinematic.x - this.focus.x) * CAMERA.smooth;
    this.focus.y += (this.cinematic.y - this.focus.y) * CAMERA.smooth;
    this.zoom += (this.cinematic.zoom - this.zoom) * CAMERA.zoomSmooth;
    this.targetZoom = this.zoom;
    this.pauseBoost += (1 - this.pauseBoost) * 0.12;
  }

  /** Coloca la cámara directamente en su objetivo (sin suavizar). */
  snapTo(world: World): void {
    const box = this.computeTargetBox(world);
    this.focus.x = box.cx;
    this.focus.y = box.cy;
    this.zoom = this.zoomForBox(box.halfW, box.halfH);
    this.targetZoom = this.zoom;
    this.applyToThree();
  }

  /** Actualiza la cámara (una vez por frame de render; puramente visual). */
  follow(world: World): void {
    if (this.cinematic) {
      this.updateCinematic();
      this.applyToThree();
      return;
    }

    const box = this.computeTargetBox(world);

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

    this.focus.x += (targetX - this.focus.x) * CAMERA.smooth;
    this.focus.y += (targetY - this.focus.y) * CAMERA.smooth;

    this.targetZoom = this.zoomForBox(box.halfW, box.halfH);
    this.zoom += (this.targetZoom - this.zoom) * CAMERA.zoomSmooth;

    this.pauseBoost += (this.targetPauseBoost - this.pauseBoost) * 0.12;

    this.applyToThree();
  }

  /**
   * Traduce el estado de encuadre (foco + zoom) a la PerspectiveCamera 3D.
   *
   * "Ancho visible" del mundo = VIEW.width / (zoom · pauseBoost · pov). A partir
   * de ahí, la distancia de cámara es la que hace que ese ancho llene el FOV
   * horizontal. Añadimos un retranqueo + elevación fijos para el toque 2.5D, y
   * apuntamos a un punto ligeramente por encima del foco.
   */
  private applyToThree(): void {
    const effZoom = this.zoom * this.pauseBoost * debug.povZoom;
    const visibleWidth = VIEW.width / effZoom;

    // FOV horizontal a partir del vertical y el aspecto.
    const vFov = this.three.fov * DEG;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.three.aspect);
    // Distancia para que `visibleWidth` quepa en el FOV horizontal.
    const dist = visibleWidth / 2 / Math.tan(hFov / 2);

    // Punto objetivo en escena (recuerda: Y de mundo va hacia abajo).
    const targetX = this.focus.x;
    const targetY = -this.focus.y;
    const targetZ = 0;

    // Retranqueo (profundidad) y una ligera elevación para la perspectiva.
    const pitch = CAMERA.pitch3d * DEG;
    const camZ = dist * Math.cos(pitch);
    const camY = targetY + dist * Math.sin(pitch);

    this.three.position.set(targetX, camY, camZ);
    this.three.lookAt(targetX, targetY, targetZ);
    this.three.updateMatrixWorld();
  }

  private computeTargetBox(world: World): {
    cx: number;
    cy: number;
    halfW: number;
    halfH: number;
  } {
    const baseCx = WORLD.centerX;
    const baseCy = WORLD.groundY + CAMERA.baseCenterOffsetY;

    let left = baseCx - CAMERA.baseHalfWidth;
    let right = baseCx + CAMERA.baseHalfWidth;
    let top = baseCy - CAMERA.baseHalfHeight;
    let bottom = baseCy + CAMERA.baseHalfHeight;

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

  private zoomForBox(halfW: number, halfH: number): number {
    const zx = VIEW.width / 2 / halfW;
    const zy = VIEW.height / 2 / halfH;
    const z = Math.min(zx, zy);
    return clamp(z, CAMERA.minZoom, CAMERA.maxZoom);
  }

  get screenWidth(): number {
    return this.screenW;
  }
  get screenHeight(): number {
    return this.screenH;
  }
  get currentZoom(): number {
    return this.zoom;
  }
  get focusX(): number {
    return this.focus.x;
  }
  get focusY(): number {
    return this.focus.y;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
