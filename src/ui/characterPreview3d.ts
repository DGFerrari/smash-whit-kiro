/**
 * Vista previa 3D de un personaje para menús (selección y post-partida).
 *
 * Usa su propio WebGLRenderer pequeño (canvas con fondo transparente) y el
 * Modelo_Respaldo procedimental. Si WebGL no está disponible, no hace nada y
 * debajo queda visible el retrato SVG (R3.6). Solo anima mientras está
 * montada y visible (`start`/`stop`), para no gastar GPU en segundo plano.
 */
import * as THREE from "three";
import type { CharacterId } from "../engine/game/characters.ts";
import type { AnimState } from "../render/characters/animator.ts";
import { createFallbackCharacter, type FallbackCharacter } from "../render/characters/fallbackModel.ts";
import { createGltfCharacter, isCharacterModelReady } from "../render/characters/modelLibrary.ts";

export interface CharacterPreviewOptions {
  /** Animación en bucle (`idle` en selección, `celebrate` en post-partida). */
  state?: AnimState;
  /** Gira lentamente el modelo para lucirlo. */
  turntable?: boolean;
  className?: string;
}

export class CharacterPreview3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private model: FallbackCharacter | null = null;
  private id: CharacterId | null = null;
  private isGltf = false;
  private color: string | undefined;
  private raf = 0;
  private last = 0;
  private yaw = 0;
  private readonly state: AnimState;
  private readonly turntable: boolean;
  private readonly rimLight = new THREE.DirectionalLight(0xffffff, 2.2);

  constructor(opts: CharacterPreviewOptions = {}) {
    this.state = opts.state ?? "idle";
    this.turntable = opts.turntable ?? true;
    this.canvas = document.createElement("canvas");
    this.canvas.className = opts.className ?? "kb-preview3d__canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch {
      // Sin WebGL (o en tests): se queda solo el retrato SVG de debajo.
      this.renderer = null;
      this.canvas.style.display = "none";
    }
    this.camera.position.set(0, 0.62, 2.6);
    this.camera.lookAt(0, 0.5, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-1.5, 2, 2.5);
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.6);
    fill.position.set(2, 0.5, 1);
    this.rimLight.position.set(0.5, 1.5, -2.5);
    this.scene.add(key, fill, this.rimLight);
  }

  /** ¿Hay vista 3D real? (si no, el retrato hace de respaldo). */
  get available(): boolean {
    return this.renderer !== null;
  }

  setCharacter(id: CharacterId, color?: string): void {
    // Si el GLTF acaba de quedar listo, se sustituye el procedimental.
    if (id === this.id && (this.isGltf || !isCharacterModelReady(id))) return;
    this.color = color;
    this.id = id;
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
      this.model = null;
    }
    if (!this.renderer) return;
    try {
      const gltf = isCharacterModelReady(id) ? createGltfCharacter(id) : null;
      this.isGltf = gltf !== null;
      this.model = gltf ?? createFallbackCharacter(id);
      this.scene.add(this.model.root);
      this.rimLight.color.set(color ?? this.model.dominantColor).lerp(new THREE.Color(1, 1, 1), 0.3);
    } catch (err) {
      console.error(`[preview3d] no se pudo crear "${id}"`, err);
      this.model = null;
    }
  }

  start(): void {
    if (!this.renderer || this.raf) return;
    this.last = performance.now();
    const tick = (now: number): void => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.stop();
    this.model?.dispose();
    this.model = null;
    this.renderer?.dispose();
    this.renderer = null;
  }

  private frame(dt: number): void {
    const r = this.renderer;
    if (!r) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.id && !this.isGltf && isCharacterModelReady(this.id)) this.setCharacter(this.id, this.color);
    const m = this.model;
    if (m) {
      m.update(this.state, dt);
      const reduced = document.documentElement.hasAttribute("data-reduced-motion");
      if (this.turntable && !reduced) this.yaw += dt * 0.6;
      m.root.rotation.y = 0.5 + Math.sin(this.yaw) * 0.6;
    }
    r.render(this.scene, this.camera);
  }
}
