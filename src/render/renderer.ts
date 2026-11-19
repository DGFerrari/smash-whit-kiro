import * as THREE from "three";
import { BLAST_ZONE, DEPTH, TEXTURES, WORLD, type SurfaceTexture } from "../engine/config.ts";
import type { Player } from "../engine/entities/player.ts";
import type { Platform } from "../engine/physics/platform.ts";
import { Camera } from "./camera.ts";
import type { World, DeathEffect } from "../engine/game/world.ts";
import { getStage, type StageTheme } from "../engine/game/stages.ts";
import { debug } from "../debug/debugState.ts";
import { drawPercentHud, hudTokens, type PercentEntry } from "../ui/percentHud.ts";
import { StageScene } from "./stages/stageScene.ts";
import { FAR_LAYER } from "./post/postPipeline.ts";
import { getTexture } from "./textures.ts";
import { getQualityManager, type ResolvedQuality } from "./quality/qualityManager.ts";
import { VfxSystem } from "./vfx/vfxSystem.ts";
import { ProjectileLayer } from "./vfx/projectileLayer.ts";
import { platformLayout } from "./stages/platformLayout.ts";
import { getStageVisual } from "./stages/stageDefs.ts";
import { PostPipeline } from "./post/postPipeline.ts";
import { createFallbackCharacter, type FallbackCharacter } from "./characters/fallbackModel.ts";
import { createGltfCharacter, isCharacterModelReady } from "./characters/modelLibrary.ts";
import { playerVisualState, selectAnimState } from "./characters/animator.ts";
import type { CharacterId } from "../engine/game/characters.ts";

/**
 * Renderer 3D (Three.js / WebGL).
 *
 * La jugabilidad sigue siendo 2D en el plano Z=0; aquí solo DIBUJAMOS en 3D:
 * cada entidad 2D (rectángulo) se representa con una caja con algo de
 * profundidad, y la cámara en perspectiva da el efecto 2.5D.
 *
 * Conversión de coordenadas: el mundo 2D tiene Y hacia ABAJO, la escena 3D
 * hacia ARRIBA, así que `sceneY = -worldY` (via Camera.worldToSceneY). X y
 * tamaños se mantienen 1:1 con las unidades de física.
 *
 * El HUD, los stats y el FPS se dibujan en un CANVAS 2D superpuesto (#hud),
 * reutilizando el código 2D existente; el canvas 3D (#game) solo lleva el mundo.
 */
/** Paso final de render reemplazable (p. ej. por un compositor de post-proceso). */
export type RenderStep = (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) => void;

const defaultRenderStep: RenderStep = (r, s, c) => r.render(s, c);

/** Objetos retenidos de un combatiente (se crean una vez y se actualizan por frame). */
interface FighterVisual {
  /** Raíz posicionada en el centro del combatiente (punto de anclaje de modelos futuros). */
  root: THREE.Group;
  body: THREE.Mesh;
  plainMat: THREE.MeshStandardMaterial;
  texturedMat: THREE.MeshStandardMaterial | null;
  eye: THREE.Mesh;
  chargeBg: THREE.Mesh;
  chargeFg: THREE.Mesh;
  chargeFgMat: THREE.MeshBasicMaterial;
  shield: THREE.Mesh;
  cpuEdges: THREE.LineSegments;
  hitboxEdges: THREE.LineSegments;
  stunLabel: THREE.Sprite;
  resLabels: [THREE.Sprite, THREE.Sprite];
  /** En coordenadas de mundo (no cuelgan de `root`). */
  attack: THREE.Mesh;
  attackMat: THREE.MeshStandardMaterial;
  respawn: THREE.Mesh;
  /** Personaje 3D estilizado (Modelo_Respaldo procedimental). */
  model: FallbackCharacter | null;
  modelId: CharacterId | null;
  /** ¿El modelo actual es el GLTF (no el procedimental)? */
  modelGltf: boolean;
}

/** Rayo de muerte reutilizable (pool). */
interface DeathVisual {
  group: THREE.Group;
  positions: THREE.BufferAttribute;
  halo: THREE.Line;
  haloMat: THREE.LineBasicMaterial;
  core: THREE.Line;
  coreMat: THREE.LineBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  flash: THREE.Mesh;
  flashMat: THREE.MeshBasicMaterial;
}

const DEATH_SEGMENTS = 14;
const WHITE = new THREE.Color(1, 1, 1);

/** Tema de plataformas de la Sala de Pruebas (sobre fondo oscuro). */
const TRAINING_THEME: StageTheme = {
  solidSide: 0x16244a,
  solidTop: 0x2a4a8a,
  oneWay: 0x3a6fd0,
  background: 0x060d24,
};

export class Renderer {
  private readonly _three: THREE.WebGLRenderer;
  private readonly _scene: THREE.Scene;

  /** Renderer WebGL (punto de enganche para post-proceso). */
  get three(): THREE.WebGLRenderer {
    return this._three;
  }
  /** Escena raíz. */
  get scene(): THREE.Scene {
    return this._scene;
  }

  /** Un `Group` raíz por índice de combatiente (hook para modelos/VFX). */
  readonly fighterRoots: THREE.Group[] = [];
  /** Grupo de efectos visuales (hook para el sistema de VFX). */
  readonly vfxGroup = new THREE.Group();

  private renderStep: RenderStep = defaultRenderStep;
  private readonly fighterVisuals: FighterVisual[] = [];
  private readonly deathPool: DeathVisual[] = [];
  private readonly deathGroup = new THREE.Group();
  private readonly textMats = new Map<string, THREE.SpriteMaterial>();
  private blastZone!: THREE.LineSegments;

  // Materiales compartidos de los objetos retenidos.
  private readonly eyeMat = new THREE.MeshBasicMaterial({ color: 0x0d1017 });
  private readonly chargeBgMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.5,
  });
  private readonly shieldMat = new THREE.MeshStandardMaterial({
    color: 0x78c8ff,
    transparent: true,
    opacity: 0.32,
    roughness: 0.2,
    metalness: 0.4,
  });
  private readonly respawnMat = new THREE.MeshBasicMaterial({
    color: 0xb4d2ff,
    transparent: true,
    opacity: 0.4,
  });
  private readonly cpuEdgeMat = new THREE.LineBasicMaterial({ color: 0x9aa5be });
  private readonly hitboxEdgeMat = new THREE.LineBasicMaterial({ color: 0x50ff8c });
  private readonly unitRingGeo = new THREE.RingGeometry(0.85, 1, 24);

  // Rig de 3 luces a nivel de escena (sin luces por combatiente).
  private readonly keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  private readonly fillLight = new THREE.DirectionalLight(0x88aaff, 0.5);
  private readonly rimLight = new THREE.DirectionalLight(0xcfe4ff, 1.2);

  private contextLost = false;
  private renderErrorLogged = false;
  private renderScale = 100;

  /** Sistema de efectos de combate (partículas, ondas, líneas, aura…). */
  private readonly vfx = new VfxSystem();
  /** Proyectiles del World. */
  private readonly projectileLayer = new ProjectileLayer();
  /** Cámara del frame actual (para orientar halos). */
  private lastCamera: THREE.Camera | null = null;
  /** Postprocesado (bloom/DOF/destellos); se crea con la primera cámara. */
  private post: PostPipeline | null = null;
  private postCamera: THREE.Camera | null = null;
  private quality: ResolvedQuality;
  private lastRenderTime = performance.now();
  /** dt del frame de render en segundos (para animar modelos). */
  private frameDt = 1 / 60;

  /** Canvas 2D superpuesto para HUD/overlays y su contexto. */
  private readonly hudCanvas: HTMLCanvasElement;
  private readonly hud: CanvasRenderingContext2D;

  private fps = 0;
  private lastFrameTime = performance.now();

  /** Sistema_Escenarios: cielo, capas lejanas, props animados y luces intensas. */
  private readonly stageScene = new StageScene();
  private readonly ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
  /** Escenario + pipeline para los que se colocaron los destellos de lente. */
  private flaresFor: { stage: string; post: PostPipeline } | null = null;

  /** Contenedores que se reconstruyen por frame (dinámicos). */
  private readonly dynamicGroup = new THREE.Group();
  /** Escenario (plataformas/suelo + grid de training); se rehace por mundo. */
  private readonly stageGroup = new THREE.Group();
  private stageBuiltFor: World | null = null;

  /** Reutilizamos geometrías/materiales base para no recrearlos por frame. */
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly sphereGeo = new THREE.SphereGeometry(1, 20, 16);
  /** Aristas de la caja unitaria, compartidas (EdgesGeometry es cara de crear). */
  private readonly edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  /** Color de fondo cacheado (se re-set al cambiar de escenario, no por frame). */
  private readonly bgColor = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    // Marcamos las geometrías compartidas para que clearGroup no las libere.
    markShared(this.boxGeo);
    markShared(this.sphereGeo);
    markShared(this.edgesGeo);
    markShared(this.unitRingGeo);

    this._three = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this._three.toneMapping = THREE.ACESFilmicToneMapping;
    this._three.toneMappingExposure = 1.1;
    this._three.outputColorSpace = THREE.SRGBColorSpace;

    // Escala de render del Gestor_Calidad (se aplica al cambiar).
    const qm = getQualityManager();
    this.quality = qm.get();
    this.renderScale = Number(this.quality.controls.renderScale) || 100;
    this.vfx.applyQuality(this.quality);
    qm.subscribe((q) => {
      this.quality = q;
      this.vfx.applyQuality(q);
      this.post?.apply(q);
      this.stageScene.setLevel(q.controls.bgAnimations);
      const next = Number(q.controls.renderScale) || 100;
      if (next === this.renderScale) return;
      this.renderScale = next;
      this.applyPixelRatio();
      this.syncPostSize();
    });
    this.applyPixelRatio();

    // Pérdida/restauración del contexto WebGL: no detiene la simulación.
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.warn("[renderer] contexto WebGL perdido; se omite el render 3D");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      this.renderErrorLogged = false;
      // Forzamos reconstrucción del escenario por si algún recurso no se restauró.
      this.stageBuiltFor = null;
    });

    this._scene = new THREE.Scene();
    this._scene.add(this.dynamicGroup);
    this._scene.add(this.stageGroup);
    this._scene.add(this.vfxGroup);
    this.vfxGroup.add(this.deathGroup);
    this.vfxGroup.add(this.vfx.group);
    this.vfxGroup.add(this.projectileLayer.group);
    this.vfx.onHeavyImpact = (x, y, z, c) => this.post?.spawnImpactFlare(x, y, z, c);

    this.setupLights();
    this.setupStaticDebug();
    this._scene.add(this.stageScene.group);

    // Canvas 2D del HUD.
    const hudCanvas = document.querySelector<HTMLCanvasElement>("#hud");
    if (!hudCanvas) throw new Error("No se encontró el canvas #hud en el HTML");
    this.hudCanvas = hudCanvas;
    const hudCtx = hudCanvas.getContext("2d");
    if (!hudCtx) throw new Error("No se pudo obtener el contexto 2D del HUD");
    this.hud = hudCtx;

    this.resize();
  }

  private setupLights(): void {
    // Ambiente tenue + rig de 3 luces: clave, relleno (más débil) y contraluz
    // (rim) detrás de los personajes respecto a la cámara (se recoloca por frame).
    this._scene.add(this.ambientLight);
    this.keyLight.position.set(-300, 600, 800);
    this.fillLight.position.set(400, -200, 500);
    this.rimLight.position.set(0, 400, -800);
    for (const l of [this.keyLight, this.fillLight, this.rimLight]) {
      this._scene.add(l);
      this._scene.add(l.target);
    }
  }

  /** Recoloca el contraluz detrás del plano de juego, opuesto a la cámara. */
  private updateRim(cam: THREE.Camera): void {
    const p = cam.position;
    this.rimLight.target.position.set(p.x, p.y, 0);
    this.rimLight.position.set(p.x * 0.5, p.y + 500, -Math.max(400, p.z));
  }

  /** Objetos de debug estáticos (blast zone) creados una sola vez. */
  private setupStaticDebug(): void {
    const x = BLAST_ZONE.left;
    const y = BLAST_ZONE.top;
    const w = BLAST_ZONE.right - BLAST_ZONE.left;
    const h = BLAST_ZONE.bottom - BLAST_ZONE.top;
    this.blastZone = new THREE.LineSegments(
      this.edgesGeo,
      new THREE.LineBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.85 }),
    );
    this.blastZone.scale.set(w, h, 1);
    this.blastZone.position.set(x + w / 2, -(y + h / 2), 0);
    this.blastZone.visible = false;
    this.dynamicGroup.add(this.blastZone);
  }

  /** Reemplaza el paso final de render (`null` ⇒ `three.render(scene, cam)`). */
  setRenderStep(fn: RenderStep | null): void {
    this.renderStep = fn ?? defaultRenderStep;
  }

  /** Luces de la escena según el escenario (paleta e iluminación propias, R10.4). */
  private applyStageLighting(): void {
    const def = this.stageScene.current;
    if (!def) return;
    this.keyLight.color.set(def.key.color);
    this.keyLight.intensity = def.key.intensity;
    this.fillLight.color.set(def.fill.color);
    this.fillLight.intensity = def.fill.intensity;
    this.rimLight.color.set(def.rim.color);
    this.rimLight.intensity = def.rim.intensity;
    this.ambientLight.intensity = def.ambient;
    this.bgColor.set(def.background);
    this._scene.background = this.bgColor;
  }

  /** Destellos de lente en las luces intensas del escenario actual (R7.5). */
  private syncStageFlares(post: PostPipeline, stage: string): void {
    if (this.flaresFor && this.flaresFor.stage === stage && this.flaresFor.post === post) return;
    post.clearLensflares();
    for (const l of this.stageScene.intenseLights) post.attachLensflare(l.obj, l.color);
    this.flaresFor = { stage, post };
  }

  private syncPostSize(): void {
    if (!this.post) return;
    this.post.setSize(window.innerWidth, window.innerHeight, this._three.getPixelRatio());
  }

  /** Postprocesado ligado a la cámara actual (se rehace si cambia la cámara). */
  private ensurePost(cam: THREE.Camera): PostPipeline | null {
    if (this.post && this.postCamera === cam) return this.post;
    try {
      this.post?.dispose();
      this.post = new PostPipeline(this._three, this._scene, cam);
      this.postCamera = cam;
      this.post.apply(this.quality);
      this.syncPostSize();
    } catch (err) {
      console.error("[renderer] postprocesado no disponible; render directo", err);
      this.post = null;
      this.postCamera = cam;
    }
    return this.post;
  }

  private applyPixelRatio(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._three.setPixelRatio(dpr * (this.renderScale / 100));
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.applyPixelRatio();
    this._three.setSize(w, h, false);
    this.syncPostSize();

    // El canvas HUD se dimensiona por píxeles reales y trabajamos en CSS px.
    this.hudCanvas.width = Math.floor(w * dpr);
    this.hudCanvas.height = Math.floor(h * dpr);
    this.hudCanvas.style.width = w + "px";
    this.hudCanvas.style.height = h + "px";
    this.hud.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get cssWidth(): number {
    return window.innerWidth;
  }
  get cssHeight(): number {
    return window.innerHeight;
  }

  render(world: World, camera: Camera, alpha: number, hideHud = false): void {
    const w = this.cssWidth;
    const h = this.cssHeight;
    this.updateFps();
    const nowMs = performance.now();
    const dtMs = Math.min(100, Math.max(0, nowMs - this.lastRenderTime));
    this.lastRenderTime = nowMs;
    this.frameDt = dtMs / 1000;

    // Mundo 3D: cualquier fallo se registra una vez y se omite el frame; la
    // simulación (que vive fuera del renderer) no se ve afectada.
    if (!this.contextLost) {
      try {
        // Escenario: plataformas + cielo/capas/props del Sistema_Escenarios.
        this.ensureStage(world);
        if (this.stageScene.setStage(world.stageId, this.quality.controls.bgAnimations, this.quality.reducedMotion)) {
          this.applyStageLighting();
        }
        this.stageScene.update(camera, nowMs / 1000, this.quality.reducedMotion);
        camera.three.layers.enable(FAR_LAYER);

        // Actualizamos los objetos retenidos (combatientes, ataques, efectos).
        this.lastCamera = camera.three;
        this.updateDynamic(world, alpha);
        this.updateRim(camera.three);
        this.vfx.update(world, alpha, dtMs, camera.three);

        // Vibración de cámara: se suma solo durante este render y se deshace.
        const cam = camera.three;
        const shake = this.vfx.shake();
        cam.position.add(shake);
        cam.updateMatrixWorld();
        const post = this.renderStep === defaultRenderStep ? this.ensurePost(cam) : null;
        if (post) this.syncStageFlares(post, world.stageId);
        if (post) {
          post.update(this.frameDt);
          post.render(this.frameDt);
        } else {
          this.renderStep(this._three, this._scene, cam);
        }
        cam.position.sub(shake);
        cam.updateMatrixWorld();
      } catch (err) {
        if (!this.renderErrorLogged) {
          this.renderErrorLogged = true;
          console.error("[renderer] error al renderizar; se omite el frame", err);
        }
      }
    }

    // --- HUD 2D superpuesto ---
    this.hud.clearRect(0, 0, w, h);

    // Destello a pantalla completa (golpes muy fuertes / KO), ya limitado por
    // el Sistema_VFX con Movimiento_Reducido.
    if (!hideHud && this.vfx.screenFlash > 0.01) {
      this.hud.save();
      this.hud.globalAlpha = Math.min(0.6, this.vfx.screenFlash);
      this.hud.fillStyle = this.vfx.screenFlashColor;
      this.hud.fillRect(0, 0, w, h);
      this.hud.restore();
    }

    // La UI del juego se oculta si lo pide el llamante (fondo del menú) o si el
    // jugador la desactivó en Opciones.
    const showUi = !hideHud && debug.showGameUi;
    if (showUi) {
      const entries: PercentEntry[] = world.fighters.map((f) => ({
        label: f.label,
        color: f.color,
        damage: f.player.damage,
        lives: Number.isFinite(f.lives) ? f.lives : -1,
        anim: f.hudAnim,
        fury: f.player.furyMeter,
        furyActive: f.player.furyActive,
        furyRemaining: f.player.furyRemaining,
        characterId: f.characterId,
      }));
      drawPercentHud(this.hud, entries, w, h);

      // Cronómetro del 1vs1 (arriba centrado).
      if (Number.isFinite(world.timeLeft)) {
        this.drawTimer(this.hud, world.timeLeft, w);
      }
    }

    // Flechas indicadoras de cada jugador (siempre por encima de todo). No se
    // dibujan en el fondo del menú (hideHud).
    if (!hideHud) this.drawFighterIndicators(this.hud, world, camera, alpha, w, h);

    // Stats/FPS son herramientas de dev: respetan sus propios toggles aunque la
    // UI de juego esté oculta, salvo que el llamante fuerce hideHud (menú).
    if (!hideHud && debug.showStats) this.drawStats(this.hud, world.player, camera);
    if (!hideHud && debug.showFps) this.drawFps(this.hud);
  }

  /**
   * Flecha/indicador por jugador, dibujada en el HUD (siempre por encima):
   *  - Si el jugador está EN pantalla: un pequeño triángulo sobre su cabeza con
   *    su color (para localizarlo aunque algo lo tape).
   *  - Si está FUERA de pantalla: una flecha pegada al borde, apuntando hacia
   *    él, para saber por dónde se fue.
   */
  private drawFighterIndicators(
    ctx: CanvasRenderingContext2D,
    world: World,
    camera: Camera,
    alpha: number,
    w: number,
    h: number,
  ): void {
    const margin = 36;
    for (const f of world.fighters) {
      if (!f.alive || f.isDead) continue;
      const p = f.player;
      const wx = lerp(p.prevPos.x, p.pos.x, alpha) + p.width / 2;
      const wyHead = lerp(p.prevPos.y, p.pos.y, alpha) - 6; // justo sobre la cabeza
      const wyCenter = lerp(p.prevPos.y, p.pos.y, alpha) + p.height / 2;

      const head = camera.project(wx, wyHead);
      if (head.onScreen) {
        this.drawHeadMarker(ctx, head.sx, head.sy, f.color);
        continue;
      }

      // Fuera de pantalla: proyectamos el centro y, aunque caiga fuera, usamos
      // su dirección respecto al centro de pantalla para clavar la flecha al
      // borde apuntando hacia el jugador.
      const c = camera.project(wx, wyCenter);
      const cxp = w / 2;
      const cyp = h / 2;
      let dx = c.sx - cxp;
      let dy = c.sy - cyp;
      // Si el punto quedó "detrás" de la cámara, invertimos para que apunte bien.
      if (c.sy === 0 && c.sx === 0) {
        dx = 0;
        dy = -1;
      }
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      // Clamp a un rectángulo interior (con margen) en la dirección (dx,dy).
      const halfW = w / 2 - margin;
      const halfH = h / 2 - margin;
      const scale = Math.min(
        halfW / Math.max(1e-3, Math.abs(dx)),
        halfH / Math.max(1e-3, Math.abs(dy)),
      );
      const ex = cxp + dx * scale;
      const ey = cyp + dy * scale;
      this.drawEdgeArrow(ctx, ex, ey, Math.atan2(dy, dx), f.color, f.label);
    }
  }

  /** Triángulo pequeño sobre la cabeza del jugador (en pantalla). */
  private drawHeadMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    color: string,
  ): void {
    const size = 11;
    const y = sy - 14;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, y + size); // punta hacia abajo
    ctx.lineTo(sx - size, y - size);
    ctx.lineTo(sx + size, y - size);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Flecha pegada al borde apuntando hacia un jugador fuera de pantalla. */
  private drawEdgeArrow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    color: string,
    label: string,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    // Etiqueta del jugador junto a la flecha (sin rotar).
    ctx.fillStyle = color;
    ctx.font = `700 14px ${hudTokens().fontText}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, -Math.cos(angle) * 26, -Math.sin(angle) * 26);
    // Flecha (triángulo) apuntando en 'angle'.
    ctx.rotate(angle);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    const s = 16;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s, -s * 0.7);
    ctx.lineTo(-s, s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Reloj mm:ss arriba centrado; se pone rojo en los últimos 10 s. */
  private drawTimer(
    ctx: CanvasRenderingContext2D,
    timeLeft: number,
    screenW: number,
  ): void {
    const total = Math.max(0, Math.ceil(timeLeft));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    const text = `${mm}:${ss.toString().padStart(2, "0")}`;

    const tk = hudTokens();
    ctx.save();
    ctx.font = `italic 400 30px ${tk.fontDisplay}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tw = ctx.measureText(text).width + 40;
    const x = screenW / 2;
    const y = 14;
    // Placa inclinada con borde de token.
    const s = 10;
    ctx.beginPath();
    ctx.moveTo(x - tw / 2 + s, y);
    ctx.lineTo(x + tw / 2, y);
    ctx.lineTo(x + tw / 2 - s, y + 42);
    ctx.lineTo(x - tw / 2, y + 42);
    ctx.closePath();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = tk.surface;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = timeLeft <= 10 ? tk.danger : tk.border;
    ctx.stroke();
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = tk.bg;
    ctx.strokeText(text, x, y + 7);
    ctx.fillStyle = timeLeft <= 10 ? tk.danger : tk.text;
    ctx.fillText(text, x, y + 7);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Escenario (estático por mundo)
  // ---------------------------------------------------------------------------

  private ensureStage(world: World): void {
    if (this.stageBuiltFor === world) return;
    this.stageBuiltFor = world;
    this.clearGroup(this.stageGroup);

    const theme = getStage(world.stageId).theme;
    const rim = new THREE.Color(getStageVisual(world.stageId).rimColor).getHex();
    for (const p of world.platforms) {
      try {
        // La Sala de Pruebas tiene suelo de borde a borde: un tono oscuro de laboratorio.
        this.addStyledPlatform(p, world.stage === "trainingGrid" ? TRAINING_THEME : theme, rim);
      } catch (err) {
        console.error("[renderer] plataforma estilizada falló; se usa la caja simple", err);
        this.addPlatformMesh(p, theme);
      }
    }

    if (world.stage === "trainingGrid") this.addTrainingGrid();
  }

  /**
   * Plataforma estilizada a partir de su caja de colisión (platformLayout):
   * tapa, cuerpo, bordes emisivos (brillan con el bloom) y bajos escalonados.
   * Los bordes superior/izquierdo/derecho coinciden con la colisión en z = 0.
   */
  private addStyledPlatform(p: Platform, theme: StageTheme, rimColor: number): void {
    const parts = platformLayout(p.box, p.oneWay);
    const w = p.box.w;
    const capMat = this.surfaceMaterial({
      color: p.oneWay ? theme.oneWay : theme.solidTop,
      texture: p.oneWay ? TEXTURES.oneWay : TEXTURES.solidTop,
      surfaceW: w,
      surfaceH: 40,
      roughness: 0.75,
      metalness: 0.1,
    });
    const bodyMat = this.surfaceMaterial({
      color: p.oneWay ? theme.oneWay : theme.solidSide,
      texture: p.oneWay ? TEXTURES.oneWay : TEXTURES.solidSide,
      surfaceW: w,
      surfaceH: p.box.h,
      roughness: 0.85,
      metalness: 0.12,
    });
    const underMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.solidSide).multiplyScalar(0.55),
      roughness: 0.95,
      metalness: 0.05,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: rimColor,
      emissive: rimColor,
      emissiveIntensity: 2.2,
      roughness: 0.3,
      metalness: 0.2,
      toneMapped: false,
    });
    for (const part of parts) {
      const mat =
        part.role === "rim" ? rimMat : part.role === "cap" ? capMat : part.role === "under" ? underMat : bodyMat;
      const mesh = new THREE.Mesh(this.boxGeo, mat);
      mesh.scale.set(part.w, part.h, part.d);
      mesh.position.set(part.cx, part.cy, part.cz);
      this.stageGroup.add(mesh);
    }
  }

  /** Respaldo: cajas simples (si la versión estilizada fallara). */
  private addPlatformMesh(p: Platform, theme: StageTheme): void {
    const { x, y, w, h } = p.box;
    const depth = p.oneWay ? DEPTH.platformOneWay : DEPTH.platformSolid;
    const cx = x + w / 2;
    // Desplazamos la plataforma HACIA ATRÁS en Z para que su cara frontal no
    // quede delante del jugador (que vive en Z=0) al trepar por las paredes.
    const zBack = -DEPTH.platformBack;

    if (p.oneWay) {
      // Plataforma atravesable: una sola caja de color SÓLIDO (sin
      // transparencia) para que se vea nítida y no se funda con el fondo.
      const mat = this.surfaceMaterial({
        color: theme.oneWay,
        texture: TEXTURES.oneWay,
        surfaceW: w,
        surfaceH: h,
      });
      const mesh = new THREE.Mesh(this.boxGeo, mat);
      mesh.scale.set(w, h, depth);
      mesh.position.set(cx, -(y + h / 2), zBack);
      this.stageGroup.add(mesh);
      return;
    }

    // Isla sólida: dividimos en CUERPO y TAPA, SIN solaparse (cada una ocupa su
    // franja de altura). Antes la tapa se dibujaba encima del cuerpo casi en el
    // mismo plano y eso causaba el z-fighting (franjas parpadeantes).
    const capH = 8; // alto de la tapa superior (hierba/borde donde pisas)
    const bodyH = h - capH;

    // Cuerpo (laterales).
    const bodyMat = this.surfaceMaterial({
      color: theme.solidSide,
      texture: TEXTURES.solidSide,
      surfaceW: w,
      surfaceH: bodyH,
      roughness: 0.85,
      metalness: 0.1,
    });
    const body = new THREE.Mesh(this.boxGeo, bodyMat);
    body.scale.set(w, bodyH, depth);
    body.position.set(cx, -(y + capH + bodyH / 2), zBack);
    this.stageGroup.add(body);

    // Tapa superior (donde te apoyas). Ocupa solo la franja superior.
    const capMat = this.surfaceMaterial({
      color: theme.solidTop,
      texture: TEXTURES.solidTop,
      surfaceW: w,
      surfaceH: depth,
      roughness: 0.9,
      metalness: 0.05,
    });
    const cap = new THREE.Mesh(this.boxGeo, capMat);
    cap.scale.set(w, capH, depth + 0.5);
    cap.position.set(cx, -(y + capH / 2), zBack);
    this.stageGroup.add(cap);
  }

  /**
   * Crea un material de superficie con color base y, si se indica, textura.
   * Añade polygonOffset como red de seguridad anti z-fighting entre superficies
   * contiguas (cuerpo/tapa), y configura el tiling de la textura.
   */
  private surfaceMaterial(opts: {
    color: number;
    texture: SurfaceTexture | null;
    surfaceW: number;
    surfaceH: number;
    roughness?: number;
    metalness?: number;
    transparent?: boolean;
    opacity?: number;
  }): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: opts.color,
      roughness: opts.roughness ?? 0.8,
      metalness: opts.metalness ?? 0.1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      // Red de seguridad: empuja ligeramente la profundidad de este polígono.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    if (opts.texture) {
      // Si no se especifica repeat, derivamos un tiling de la textura a partir
      // del tamaño de la superficie para que no salga estirada.
      const repeat =
        opts.texture.repeat ??
        ([Math.max(1, Math.round(opts.surfaceW / 128)), Math.max(1, Math.round(opts.surfaceH / 128))] as [number, number]);
      mat.map = getTexture({ ...opts.texture, repeat });
      // Con textura, el color base multiplica; lo dejamos blanco para no teñir.
      mat.color.set(0xffffff);
    }
    return mat;
  }

  /**
   * Rejilla + numeración de distancias del escenario de entrenamiento, en 3D
   * sobre el plano Z=0. Usamos LineSegments para la cuadrícula y sprites de
   * texto para los números.
   */
  private addTrainingGrid(): void {
    const GRID = 100;
    const LABEL = 200;
    const left = BLAST_ZONE.left;
    const right = BLAST_ZONE.right;
    const top = BLAST_ZONE.top;
    const groundY = WORLD.groundY;
    const z = -10; // ligeramente detrás del plano de juego

    const minor: number[] = [];
    const major: number[] = [];

    const sy = (wy: number): number => -wy;

    for (let x = Math.ceil(left / GRID) * GRID; x <= right; x += GRID) {
      const arr = x % LABEL === 0 ? major : minor;
      arr.push(x, sy(top), z, x, sy(groundY), z);
    }
    for (let y = groundY; y >= top; y -= GRID) {
      const dist = groundY - y;
      const arr = dist % LABEL === 0 ? major : minor;
      arr.push(left, sy(y), z, right, sy(y), z);
    }

    // Rejilla holográfica (Sala de Pruebas, fondo oscuro).
    this.stageGroup.add(this.lineSegments(minor, 0x2f6fc0, 0.35));
    this.stageGroup.add(this.lineSegments(major, 0x4fb4ff, 0.6));

    // Eje central (x = 0).
    this.stageGroup.add(
      this.lineSegments([0, sy(top), z, 0, sy(groundY), z], 0x8fe6ff, 0.85),
    );

    // Números de distancia en X (sobre el suelo).
    for (let x = Math.ceil(left / LABEL) * LABEL; x <= right; x += LABEL) {
      if (x === 0) continue;
      this.stageGroup.add(
        this.textSprite(String(Math.abs(x)), x, sy(groundY) + 22, z + 1),
      );
    }
    // Números de altura en Y (columna central).
    for (let y = groundY - LABEL; y >= top; y -= LABEL) {
      const dist = groundY - y;
      this.stageGroup.add(this.textSprite(String(dist), 34, sy(y), z + 1));
    }
  }

  private lineSegments(
    verts: number[],
    color: number,
    opacity: number,
  ): THREE.LineSegments {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return new THREE.LineSegments(geo, mat);
  }

  // ---------------------------------------------------------------------------
  // Objetos dinámicos (por frame)
  // ---------------------------------------------------------------------------

  /** Actualiza el grafo retenido a partir del World (solo lectura). */
  private updateDynamic(world: World, alpha: number): void {
    this.blastZone.visible = debug.showBlastZone;

    // Ocultamos todo y mostramos lo que se actualice este frame.
    for (const v of this.fighterVisuals) {
      v.root.visible = false;
      v.attack.visible = false;
      v.respawn.visible = false;
    }

    for (const f of world.fighters) {
      const v = this.getFighterVisual(f.index);

      // Plataformas temporales de reaparición (parpadean).
      if (f.respawnPlatform && f.respawnPlatformBlinkOn) {
        const { x, y, w, h } = f.respawnPlatform.box;
        v.respawn.visible = true;
        v.respawn.scale.set(w, h, DEPTH.platformOneWay);
        v.respawn.position.set(x + w / 2, -(y + h / 2), 0);
      }

      if (!f.alive || f.isDead) continue;
      this.ensureModel(v, f.characterId);
      this.updateFighter(v, f.player, alpha, f.color, f.cpu);
      this.updateAttack(v, f.player);
    }

    // Proyectiles (lanzas, bolas de fuego, flechas…).
    this.projectileLayer.update(world.projectiles, alpha, this.lastCamera ?? new THREE.Camera(), performance.now() / 1000);

    // Efectos de muerte (rayos) desde un pool reutilizable.
    const effects = world.deathEffects;
    for (let i = 0; i < effects.length; i++) {
      this.updateDeathEffect(this.getDeathVisual(i), effects[i]);
    }
    for (let i = effects.length; i < this.deathPool.length; i++) {
      this.deathPool[i].group.visible = false;
    }
  }

  private getFighterVisual(index: number): FighterVisual {
    const existing = this.fighterVisuals[index];
    if (existing) return existing;

    const root = new THREE.Group();
    root.name = `fighter-${index}`;

    const plainMat = new THREE.MeshStandardMaterial({
      roughness: 0.42,
      metalness: 0.18,
      envMapIntensity: 0.8,
    });
    const tex = TEXTURES.fighters[index];
    const texturedMat = tex
      ? new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: getTexture(tex),
          roughness: 0.42,
          metalness: 0.18,
        })
      : null;
    const body = new THREE.Mesh(this.boxGeo, plainMat);
    root.add(body);

    const eye = new THREE.Mesh(this.boxGeo, this.eyeMat);
    eye.scale.set(6, 6, 4);
    root.add(eye);

    const chargeBg = new THREE.Mesh(this.boxGeo, this.chargeBgMat);
    const chargeFgMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const chargeFg = new THREE.Mesh(this.boxGeo, chargeFgMat);
    root.add(chargeBg, chargeFg);

    const shield = new THREE.Mesh(this.sphereGeo, this.shieldMat);
    root.add(shield);

    const cpuEdges = new THREE.LineSegments(this.edgesGeo, this.cpuEdgeMat);
    const hitboxEdges = new THREE.LineSegments(this.edgesGeo, this.hitboxEdgeMat);
    root.add(cpuEdges, hitboxEdges);

    const mkLabel = (): THREE.Sprite => {
      const s = new THREE.Sprite(this.textMaterial("", "#ffffff"));
      s.scale.set(64, 32, 1);
      root.add(s);
      return s;
    };
    const stunLabel = mkLabel();
    const resLabels: [THREE.Sprite, THREE.Sprite] = [mkLabel(), mkLabel()];

    const attackMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.85,
    });
    const attack = new THREE.Mesh(this.boxGeo, attackMat);
    const respawn = new THREE.Mesh(this.boxGeo, this.respawnMat);
    this.dynamicGroup.add(root, attack, respawn);

    const v: FighterVisual = {
      root,
      body,
      plainMat,
      texturedMat,
      eye,
      chargeBg,
      chargeFg,
      chargeFgMat,
      shield,
      cpuEdges,
      hitboxEdges,
      stunLabel,
      resLabels,
      attack,
      attackMat,
      respawn,
      model: null,
      modelId: null,
      modelGltf: false,
    };
    this.fighterVisuals[index] = v;
    this.fighterRoots[index] = root;
    return v;
  }

  /** Crea (o cambia) el personaje 3D del combatiente si su personaje cambió. */
  private ensureModel(v: FighterVisual, id: CharacterId): void {
    const gltfReady = isCharacterModelReady(id);
    // Se sustituye si cambia el personaje o si el GLTF acaba de quedar listo.
    if (v.modelId === id && v.model && (v.modelGltf || !gltfReady)) return;
    if (v.model) {
      v.model.root.removeFromParent();
      v.model.dispose();
      v.model = null;
    }
    v.modelId = id;
    v.modelGltf = false;
    try {
      const gltf = gltfReady ? createGltfCharacter(id) : null;
      v.modelGltf = gltf !== null;
      v.model = gltf ?? createFallbackCharacter(id);
      v.root.add(v.model.root);
    } catch (err) {
      // Sin modelo: se sigue viendo la caja (respaldo del respaldo).
      console.error(`[renderer] no se pudo crear el personaje "${id}"`, err);
      v.model = null;
    }
  }

  /** Anima el personaje 3D a partir del estado del jugador (solo lectura). */
  private updateModel(v: FighterVisual, player: Player, ph: number): void {
    const m = v.model;
    if (!m) return;
    const s = ph * 1.02;
    m.root.scale.setScalar(s);
    m.root.position.set(0, -ph / 2, 0);
    m.setFacing(player.facing === -1 ? -1 : 1, this.frameDt);
    // Golpe exagerado: parte del cuerpo, dirección e intensidad según la fase.
    const atk = player.attack;
    m.setAttack?.(
      atk
        ? {
            limb: atk.def.limb ?? "fist",
            dir: atk.def.dir,
            heavy: atk.def.kind === "heavy",
            strength: attackEnvelope(atk.phase, atk.phaseStep, atk.def.startup, atk.def.active, atk.def.recovery),
          }
        : null,
    );
    m.update(selectAnimState(playerVisualState(player)), this.frameDt);

    // Tintes de estado (baratos: solo uniforms).
    const u = m.uniforms;
    // Carga al máximo: el personaje late en naranja incandescente.
    const fullCharge = player.charging && player.chargeRatio >= 1;
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * 18);
    if (player.hitFlash > 0) m.setHitTint(0.85, "#ffffff");
    else if (player.dodging) m.setHitTint(0.45, "#c8e6ff");
    else if (fullCharge) m.setHitTint(0.22 + 0.28 * pulse, "#ffb03a");
    else m.setHitTint(0);
    if (fullCharge) {
      u.uRimColor.value.set("#ff7a1a").lerp(WHITE, 0.3 * pulse);
      u.uRimStrength.value = 1.8 + 0.8 * pulse;
    } else if (player.furyActive) {
      const hue = ((performance.now() / 1000) * 0.9) % 1;
      u.uRimColor.value.setHSL(hue, 1, 0.6);
      u.uRimStrength.value = 1.6;
    } else {
      u.uRimColor.value.set(m.dominantColor).lerp(WHITE, 0.55);
      u.uRimStrength.value = 0.85;
    }
  }

  private updateFighter(
    v: FighterVisual,
    player: Player,
    alpha: number,
    baseColor: string,
    isCpu: boolean,
  ): void {
    const pw = player.width;
    const ph = player.height;
    const rx = lerp(player.prevPos.x, player.pos.x, alpha);
    const ry = lerp(player.prevPos.y, player.pos.y, alpha);
    const cx = rx + pw / 2;
    const cy = -(ry + ph / 2);
    const front = DEPTH.fighter / 2;

    v.root.visible = true;
    v.root.position.set(cx, cy, 0);

    // Material según estado (mismas reglas que antes). La textura solo se usa
    // sin tinte de estado dominante (furia/flash/esquiva usan color plano).
    const plainState = !player.furyActive && !player.dodging && player.hitFlash <= 0;
    if (v.texturedMat && plainState) {
      v.body.material = v.texturedMat;
    } else {
      const mat = v.plainMat;
      v.body.material = mat;
      if (player.furyActive) {
        const hue = ((performance.now() / 1000) * 0.9) % 1;
        mat.color.setHSL(hue, 0.95, 0.62, THREE.SRGBColorSpace);
        mat.emissive.setHSL(hue, 0.9, 0.4, THREE.SRGBColorSpace);
        mat.emissiveIntensity = 0.8;
      } else {
        if (player.dodging) mat.color.set("#c8e6ff");
        else if (player.hitFlash > 0) mat.color.set("#ffffff");
        else if (debug.showStateColors && player.wallSliding) mat.color.set("#6bffb0");
        else mat.color.set(baseColor);
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
      if (mat.transparent !== player.dodging) {
        mat.transparent = player.dodging;
        mat.needsUpdate = true;
      }
      mat.opacity = player.dodging ? 0.55 : 1;
    }
    v.body.scale.set(pw, ph, DEPTH.fighter);

    // Con personaje 3D, la caja y el "ojo" se ocultan.
    const hasModel = v.model !== null;
    v.body.visible = !hasModel;
    v.eye.visible = !hasModel;
    this.updateModel(v, player, ph);

    // "Ojo" que marca el facing.
    v.eye.position.set(player.facing === 1 ? pw / 2 - 9 : -(pw / 2 - 9), ph / 2 - 15, front + 1);

    // Barra de carga del fuerte sobre la cabeza.
    v.chargeBg.visible = v.chargeFg.visible = player.charging;
    if (player.charging) {
      const ratio = player.chargeRatio;
      const by = ph / 2 + 11;
      v.chargeBg.scale.set(pw, 6, 2);
      v.chargeBg.position.set(0, by, front + 2);
      v.chargeFgMat.color.set(chargeColor(ratio));
      v.chargeFg.scale.set(Math.max(0.01, pw * ratio), 6, 3);
      v.chargeFg.position.set((pw * ratio) / 2 - pw / 2, by, front + 3);
    }

    // Escudo.
    const radius = player.shieldRadius;
    v.shield.visible = radius > 0;
    if (radius > 0) v.shield.scale.setScalar(radius);

    // Etiquetas de dev (stun / recursos) con materiales cacheados por texto.
    const showStun = debug.showStun && (player.stunned || player.attacking);
    v.stunLabel.visible = showStun;
    if (showStun) {
      v.stunLabel.material = player.stunned
        ? this.textMaterial("STUN", "#ff53d0")
        : this.textMaterial("ATK", "#ffd84d");
      v.stunLabel.position.set(0, ph / 2 + 12, front + 2);
    }
    let li = 0;
    if (debug.showResources) {
      if (player.outOfJumps) this.placeResLabel(v, li++, "SIN SALTO", ph, front);
      if (player.outOfHeavy) this.placeResLabel(v, li++, "SIN FUERTE", ph, front);
    }
    for (; li < v.resLabels.length; li++) v.resLabels[li].visible = false;

    // Borde gris para la CPU.
    v.cpuEdges.visible = isCpu && !hasModel;
    if (isCpu) v.cpuEdges.scale.set(pw + 4, ph + 4, DEPTH.fighter + 2);

    v.hitboxEdges.visible = debug.showHitboxes;
    if (debug.showHitboxes) v.hitboxEdges.scale.set(pw, ph, DEPTH.fighter);
  }

  private placeResLabel(
    v: FighterVisual,
    i: number,
    text: string,
    ph: number,
    front: number,
  ): void {
    const s = v.resLabels[i];
    s.visible = true;
    s.material = this.textMaterial(text, "#ff6b6b");
    s.position.set(0, -(ph / 2 + 16 + i * 16), front + 2);
  }

  private updateAttack(v: FighterVisual, player: Player): void {
    const atk = player.attack;
    if (!atk || !atk.hitbox) return;
    const { x, y, w, h } = atk.hitbox;
    const color = atk.def.kind === "light" ? "#7df9ff" : chargeColor(atk.charge);
    v.attackMat.color.set(color);
    v.attackMat.emissive.set(color);
    // La caja de la hitbox solo se ve como herramienta de depuración: el golpe
    // lo comunica la animación del personaje (extremidad agrandada) y los VFX.
    v.attack.visible = debug.showHitboxes;
    v.attack.scale.set(w, h, DEPTH.attack);
    v.attack.position.set(x + w / 2, -(y + h / 2), 0);
  }

  private getDeathVisual(i: number): DeathVisual {
    const existing = this.deathPool[i];
    if (existing) return existing;
    const group = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(new Float32Array((DEATH_SEGMENTS + 1) * 3), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", positions);
    const haloMat = new THREE.LineBasicMaterial({ transparent: true });
    const coreMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true });
    const halo = new THREE.Line(geo, haloMat);
    const core = new THREE.Line(geo, coreMat);
    halo.frustumCulled = core.frustumCulled = false;
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(this.unitRingGeo, ringMat);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    const flash = new THREE.Mesh(this.sphereGeo, flashMat);
    group.add(halo, core, ring, flash);
    this.deathGroup.add(group);
    const v: DeathVisual = {
      group,
      positions,
      halo,
      haloMat,
      core,
      coreMat,
      ring,
      ringMat,
      flash,
      flashMat,
    };
    this.deathPool[i] = v;
    return v;
  }

  /** Rayo de muerte: polilínea en zigzag que cae sobre el punto, en 3D. */
  private updateDeathEffect(v: DeathVisual, e: DeathEffect): void {
    const prog = 1 - e.life / e.maxLife;
    const fall = Math.min(1, prog / 0.35);
    const fade = prog < 0.35 ? 1 : 1 - (prog - 0.35) / 0.65;

    const topWY = e.y - 620;
    const tipWY = topWY + (e.y - topWY) * easeOut(fall);

    const arr = v.positions.array as Float32Array;
    for (let i = 0; i <= DEATH_SEGMENTS; i++) {
      const s = i / DEATH_SEGMENTS;
      const wy = topWY + (tipWY - topWY) * s;
      const amp = 26 * (1 - s) + 6;
      const jitter = Math.sin((i * 12.9898 + e.seed) * 43.233);
      arr[i * 3] = e.x + (jitter - Math.trunc(jitter)) * 2 * amp - amp;
      arr[i * 3 + 1] = -wy;
      arr[i * 3 + 2] = 5;
    }
    v.positions.needsUpdate = true;

    v.group.visible = true;
    v.haloMat.color.set(e.color);
    v.haloMat.opacity = fade * 0.6;
    v.coreMat.opacity = fade;

    // Destello en el impacto.
    const impact = fall >= 1;
    v.ring.visible = v.flash.visible = impact;
    if (impact) {
      const flashR = 46 * easeOut(Math.min(1, (prog - 0.35) / 0.4));
      v.ring.scale.setScalar(Math.max(0.001, flashR));
      v.ring.position.set(e.x, -e.y, 6);
      v.ringMat.color.set(e.color);
      v.ringMat.opacity = fade;
      v.flash.scale.setScalar(Math.max(0.001, 14 * fade));
      v.flash.position.set(e.x, -e.y, 6);
      v.flashMat.opacity = fade;
    }
  }

  /** Material de sprite de texto cacheado por (texto, color); compartido. */
  private textMaterial(text: string, color: string): THREE.SpriteMaterial {
    const key = `${color}|${text}`;
    let mat = this.textMats.get(key);
    if (mat) return mat;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = color;
      ctx.font = "bold 40px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 64, 32);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false });
    sharedMats.add(mat);
    this.textMats.set(key, mat);
    return mat;
  }

  /** Sprite de texto (números del grid) con material cacheado. */
  private textSprite(
    text: string,
    x: number,
    y: number,
    z: number,
    color = "#8fe6ff",
  ): THREE.Sprite {
    const sprite = new THREE.Sprite(this.textMaterial(text, color));
    sprite.position.set(x, y, z);
    sprite.scale.set(64, 32, 1);
    return sprite;
  }

  private clearGroup(group: THREE.Group): void {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      group.remove(child);
      disposeObject(child);
    }
  }

  // ---------------------------------------------------------------------------
  // HUD 2D (canvas superpuesto) — reutiliza el código 2D de siempre
  // ---------------------------------------------------------------------------

  private updateFps(): void {
    const now = performance.now();
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;
    if (dt > 0) {
      const instant = 1000 / dt;
      this.fps = this.fps === 0 ? instant : this.fps * 0.9 + instant * 0.1;
    }
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
    lines.forEach((line, i) => ctx.fillText(line, x + pad, y + pad + i * lineH));
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
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Intensidad 0..1 del golpe según su fase: sube en la anticipación, pico
 * durante la fase activa y se recoge en la recuperación.
 */
export function attackEnvelope(
  phase: string,
  step: number,
  startup: number,
  active: number,
  recovery: number,
): number {
  if (phase === "startup") return 0.15 + 0.55 * Math.min(1, step / Math.max(1, startup));
  if (phase === "active") return 1;
  if (phase === "recovery") return Math.max(0, 1 - step / Math.max(1, recovery * 0.7));
  void active;
  return 0;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Color de carga: 0 blanco -> amarillo -> rojo. */
function chargeColor(t: number): string {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  if (c < 0.5) {
    const k = c / 0.5;
    const b = Math.round(255 - 255 * k);
    return `rgb(255,255,${b})`;
  }
  const k = (c - 0.5) / 0.5;
  const g = Math.round(255 - 255 * k);
  return `rgb(255,${g},0)`;
}

/** Libera geometrías/materiales/texturas de un objeto al quitarlo de escena. */
function disposeObject(obj: THREE.Object3D): void {
  const anyObj = obj as unknown as {
    geometry?: THREE.BufferGeometry;
    material?: THREE.Material | THREE.Material[];
  };
  if (anyObj.geometry && !sharedGeometry(anyObj.geometry)) {
    anyObj.geometry.dispose();
  }
  const mat = anyObj.material;
  if (Array.isArray(mat)) {
    for (const m of mat) disposeMaterial(m);
  } else if (mat) {
    disposeMaterial(mat);
  }
}

// Materiales compartidos/cacheados (sprites de texto) que no se liberan al limpiar.
const sharedMats = new WeakSet<THREE.Material>();

function disposeMaterial(m: THREE.Material): void {
  if (sharedMats.has(m)) return;
  const anyMat = m as unknown as { map?: THREE.Texture };
  anyMat.map?.dispose();
  m.dispose();
}

// Geometrías compartidas que NO deben liberarse al limpiar el grupo dinámico.
const sharedGeos = new WeakSet<THREE.BufferGeometry>();
function sharedGeometry(geo: THREE.BufferGeometry): boolean {
  return sharedGeos.has(geo);
}
export function markShared(geo: THREE.BufferGeometry): void {
  sharedGeos.add(geo);
}
