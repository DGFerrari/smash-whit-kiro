import * as THREE from "three";
import { BLAST_ZONE, DEPTH, TEXTURES, WORLD, type SurfaceTexture } from "../config.ts";
import type { Player } from "../entities/player.ts";
import type { Platform } from "../physics/platform.ts";
import { Camera } from "./camera.ts";
import type { World, DeathEffect } from "../game/world.ts";
import { debug } from "../debug/debugState.ts";
import { drawPercentHud, type PercentEntry } from "../ui/percentHud.ts";
import { Background3D } from "./background.ts";
import { getTexture } from "./textures.ts";

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
export class Renderer {
  private readonly three: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;

  /** Canvas 2D superpuesto para HUD/overlays y su contexto. */
  private readonly hudCanvas: HTMLCanvasElement;
  private readonly hud: CanvasRenderingContext2D;

  private fps = 0;
  private lastFrameTime = performance.now();

  /** Fondo neón por capas (planos a distintas Z) y grupo de escena. */
  private readonly background: Background3D;

  /** Contenedores que se reconstruyen por frame (dinámicos). */
  private readonly dynamicGroup = new THREE.Group();
  /** Escenario (plataformas/suelo + grid de training); se rehace por mundo. */
  private readonly stageGroup = new THREE.Group();
  private stageBuiltFor: World | null = null;

  /** Reutilizamos geometrías/materiales base para no recrearlos por frame. */
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly sphereGeo = new THREE.SphereGeometry(1, 20, 16);

  constructor(canvas: HTMLCanvasElement) {
    // Marcamos las geometrías compartidas para que clearGroup no las libere.
    markShared(this.boxGeo);
    markShared(this.sphereGeo);

    this.three = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.scene.add(this.dynamicGroup);
    this.scene.add(this.stageGroup);

    this.setupLights();
    this.background = new Background3D(this.scene);

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
    // Luz ambiental suave + direccional para dar volumen a las cajas.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(-300, 600, 800);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(400, -200, 500);
    this.scene.add(fill);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.three.setPixelRatio(dpr);
    this.three.setSize(w, h, false);

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

    // Escenario + fondo según el modo (se construye una vez por mundo).
    this.ensureStage(world);
    this.background.setMode(world.stage);
    this.background.update(camera);
    this.scene.background = new THREE.Color(
      world.stage === "trainingGrid" ? 0xf3f5f8 : 0x0a0f24,
    );

    // Reconstruimos los objetos dinámicos (combatientes, ataques, efectos).
    this.rebuildDynamic(world, alpha);

    this.three.render(this.scene, camera.three);

    // --- HUD 2D superpuesto ---
    this.hud.clearRect(0, 0, w, h);

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
      }));
      drawPercentHud(this.hud, entries, w, h);

      // Cronómetro del 1vs1 (arriba centrado).
      if (Number.isFinite(world.timeLeft)) {
        this.drawTimer(this.hud, world.timeLeft, w);
      }
    }

    // Stats/FPS son herramientas de dev: respetan sus propios toggles aunque la
    // UI de juego esté oculta, salvo que el llamante fuerce hideHud (menú).
    if (!hideHud && debug.showStats) this.drawStats(this.hud, world.player, camera);
    if (!hideHud && debug.showFps) this.drawFps(this.hud);
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

    ctx.save();
    ctx.font = "800 30px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tw = ctx.measureText(text).width + 36;
    const x = screenW / 2;
    const y = 14;
    // Fondo redondeado.
    ctx.fillStyle = "rgba(10, 14, 22, 0.75)";
    this.roundRect(ctx, x - tw / 2, y, tw, 42, 10);
    ctx.fill();
    ctx.fillStyle = timeLeft <= 10 ? "#ff5d5d" : "#f1f4fa";
    ctx.fillText(text, x, y + 7);
    ctx.restore();
  }

  private roundRect(
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

  // ---------------------------------------------------------------------------
  // Escenario (estático por mundo)
  // ---------------------------------------------------------------------------

  private ensureStage(world: World): void {
    if (this.stageBuiltFor === world) return;
    this.stageBuiltFor = world;
    this.clearGroup(this.stageGroup);

    for (const p of world.platforms) this.addPlatformMesh(p);

    if (world.stage === "trainingGrid") this.addTrainingGrid();
  }

  private addPlatformMesh(p: Platform): void {
    const { x, y, w, h } = p.box;
    const depth = p.oneWay ? DEPTH.platformOneWay : DEPTH.platformSolid;
    const cx = x + w / 2;

    if (p.oneWay) {
      // Plataforma atravesable: una sola caja (sin tapa superpuesta).
      const mat = this.surfaceMaterial({
        color: 0x7fb2ff,
        texture: TEXTURES.oneWay,
        surfaceW: w,
        surfaceH: h,
        transparent: true,
        opacity: 0.55,
      });
      const mesh = new THREE.Mesh(this.boxGeo, mat);
      mesh.scale.set(w, h, depth);
      mesh.position.set(cx, -(y + h / 2), 0);
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
      color: 0x3a4a66,
      texture: TEXTURES.solidSide,
      surfaceW: w,
      surfaceH: bodyH,
      roughness: 0.85,
      metalness: 0.1,
    });
    const body = new THREE.Mesh(this.boxGeo, bodyMat);
    body.scale.set(w, bodyH, depth);
    // El cuerpo empieza justo DEBAJO de la tapa.
    body.position.set(cx, -(y + capH + bodyH / 2), 0);
    this.stageGroup.add(body);

    // Tapa superior (donde te apoyas). Ocupa solo la franja superior.
    const capMat = this.surfaceMaterial({
      color: 0x5b7fa6,
      texture: TEXTURES.solidTop,
      surfaceW: w,
      surfaceH: depth, // la cara superior mira a w x depth
      roughness: 0.9,
      metalness: 0.05,
    });
    const cap = new THREE.Mesh(this.boxGeo, capMat);
    // Un pelín MÁS ancha en Z para que no coincida el borde con el cuerpo.
    cap.scale.set(w, capH, depth + 0.5);
    cap.position.set(cx, -(y + capH / 2), 0);
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

    this.stageGroup.add(this.lineSegments(minor, 0x9aa5be, 0.35));
    this.stageGroup.add(this.lineSegments(major, 0x5a6e8c, 0.6));

    // Eje central (x = 0).
    this.stageGroup.add(
      this.lineSegments([0, sy(top), z, 0, sy(groundY), z], 0x3c5078, 0.8),
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

  private rebuildDynamic(world: World, alpha: number): void {
    this.clearGroup(this.dynamicGroup);

    // Plataformas temporales de reaparición (parpadean).
    for (const f of world.fighters) {
      if (f.respawnPlatform && f.respawnPlatformBlinkOn) {
        this.addRespawnPlatform(f.respawnPlatform);
      }
    }

    // Blast zone (debug): marco de líneas.
    if (debug.showBlastZone) this.addBlastZone();

    // Combatientes vivos + ataques + escudos.
    for (const f of world.fighters) {
      if (!f.alive || f.isDead) continue;
      this.addFighter(f.player, alpha, f.color, f.index);
      this.addShield(f.player, alpha);
      this.addAttack(f.player);
    }

    // Efectos de muerte (rayos).
    for (const e of world.deathEffects) this.addDeathEffect(e);
  }

  private addFighter(
    player: Player,
    alpha: number,
    baseColor: string,
    index: number,
  ): void {
    const rx = lerp(player.prevPos.x, player.pos.x, alpha);
    const ry = lerp(player.prevPos.y, player.pos.y, alpha);
    const cx = rx + player.width / 2;
    const cy = -(ry + player.height / 2);

    // Color según estado (mismas reglas que la versión 2D).
    let colorHex: string;
    let emissive = 0x000000;
    if (player.furyActive) {
      const hue = ((performance.now() / 1000) * 0.9) % 1;
      colorHex = hslHex(hue, 0.95, 0.62);
      emissive = Number("0x" + hslHex(hue, 0.9, 0.4).slice(1));
    } else if (player.dodging) {
      colorHex = "#c8e6ff";
    } else if (player.hitFlash > 0) {
      colorHex = "#ffffff";
    } else if (debug.showStateColors && player.wallSliding) {
      colorHex = "#6bffb0";
    } else {
      colorHex = baseColor;
    }

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      emissive: new THREE.Color(emissive),
      emissiveIntensity: player.furyActive ? 0.8 : 0,
      roughness: 0.45,
      metalness: 0.15,
      transparent: player.dodging,
      opacity: player.dodging ? 0.55 : 1,
    });
    // Textura opcional del combatiente (solo cuando no hay tinte de estado que
    // deba dominar: furia/flash/esquiva usan color plano para leerse bien).
    const tex = TEXTURES.fighters[index];
    const plainState =
      !player.furyActive && !player.dodging && player.hitFlash <= 0;
    if (tex && plainState) {
      mat.map = getTexture(tex);
      mat.color.set(0xffffff);
    }
    const mesh = new THREE.Mesh(this.boxGeo, mat);
    mesh.scale.set(player.width, player.height, DEPTH.fighter);
    mesh.position.set(cx, cy, 0);
    this.dynamicGroup.add(mesh);

    // "Ojo" que marca el facing: una pequeña caja oscura al frente.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0d1017 });
    const eye = new THREE.Mesh(this.boxGeo, eyeMat);
    eye.scale.set(6, 6, 4);
    const eyeX =
      player.facing === 1 ? rx + player.width - 9 : rx + 9;
    eye.position.set(eyeX, -(ry + 15), DEPTH.fighter / 2 + 1);
    this.dynamicGroup.add(eye);

    // Barra de carga del fuerte sobre la cabeza (dos cajas finas).
    if (player.charging) {
      const ratio = player.chargeRatio;
      const barW = player.width;
      const by = -(ry - 14 + 3);
      const bg = new THREE.Mesh(
        this.boxGeo,
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }),
      );
      bg.scale.set(barW, 6, 2);
      bg.position.set(rx + barW / 2, by, DEPTH.fighter / 2 + 2);
      this.dynamicGroup.add(bg);

      const fg = new THREE.Mesh(
        this.boxGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(chargeColor(ratio)) }),
      );
      fg.scale.set(Math.max(0.01, barW * ratio), 6, 3);
      fg.position.set(rx + (barW * ratio) / 2, by, DEPTH.fighter / 2 + 3);
      this.dynamicGroup.add(fg);
    }

    // Etiquetas de dev (stun / recursos) como sprites.
    if (debug.showStun && (player.stunned || player.attacking)) {
      const label = player.stunned ? "STUN" : "ATK";
      const col = player.stunned ? "#ff53d0" : "#ffd84d";
      this.dynamicGroup.add(
        this.textSprite(label, cx, -(ry - 12), DEPTH.fighter / 2 + 2, col),
      );
    }
    if (debug.showResources && (player.outOfJumps || player.outOfHeavy)) {
      const labels: string[] = [];
      if (player.outOfJumps) labels.push("SIN SALTO");
      if (player.outOfHeavy) labels.push("SIN FUERTE");
      labels.forEach((t, i) => {
        this.dynamicGroup.add(
          this.textSprite(
            t,
            cx,
            -(ry + player.height + 16 + i * 16),
            DEPTH.fighter / 2 + 2,
            "#ff6b6b",
          ),
        );
      });
    }

    if (debug.showHitboxes) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(this.boxGeo),
        new THREE.LineBasicMaterial({ color: 0x50ff8c }),
      );
      edges.scale.set(player.width, player.height, DEPTH.fighter);
      edges.position.set(cx, cy, 0);
      this.dynamicGroup.add(edges);
    }
  }

  private addShield(player: Player, alpha: number): void {
    const radius = player.shieldRadius;
    if (radius <= 0) return;
    const cx = lerp(player.prevPos.x, player.pos.x, alpha) + player.width / 2;
    const cy = -(lerp(player.prevPos.y, player.pos.y, alpha) + player.height / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x78c8ff,
      transparent: true,
      opacity: 0.32,
      roughness: 0.2,
      metalness: 0.4,
    });
    const mesh = new THREE.Mesh(this.sphereGeo, mat);
    mesh.scale.setScalar(radius);
    mesh.position.set(cx, cy, 0);
    this.dynamicGroup.add(mesh);
  }

  private addAttack(player: Player): void {
    const atk = player.attack;
    if (!atk || !atk.hitbox) return;
    const { x, y, w, h } = atk.hitbox;
    const color = atk.def.kind === "light" ? "#7df9ff" : chargeColor(atk.charge);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(this.boxGeo, mat);
    mesh.scale.set(w, h, DEPTH.attack);
    mesh.position.set(x + w / 2, -(y + h / 2), 0);
    this.dynamicGroup.add(mesh);
  }

  private addRespawnPlatform(p: Platform): void {
    const { x, y, w, h } = p.box;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xb4d2ff,
      transparent: true,
      opacity: 0.4,
    });
    const mesh = new THREE.Mesh(this.boxGeo, mat);
    mesh.scale.set(w, h, DEPTH.platformOneWay);
    mesh.position.set(x + w / 2, -(y + h / 2), 0);
    this.dynamicGroup.add(mesh);
  }

  private addBlastZone(): void {
    const x = BLAST_ZONE.left;
    const y = BLAST_ZONE.top;
    const w = BLAST_ZONE.right - BLAST_ZONE.left;
    const h = BLAST_ZONE.bottom - BLAST_ZONE.top;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.boxGeo),
      new THREE.LineBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.85 }),
    );
    edges.scale.set(w, h, 1);
    edges.position.set(x + w / 2, -(y + h / 2), 0);
    this.dynamicGroup.add(edges);
  }

  /** Rayo de muerte: polilínea en zigzag que cae sobre el punto, en 3D. */
  private addDeathEffect(e: DeathEffect): void {
    const prog = 1 - e.life / e.maxLife;
    const fall = Math.min(1, prog / 0.35);
    const fade = prog < 0.35 ? 1 : 1 - (prog - 0.35) / 0.65;

    const topWY = e.y - 620;
    const tipWY = topWY + (e.y - topWY) * easeOut(fall);

    const segments = 14;
    const verts: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const wy = topWY + (tipWY - topWY) * s;
      const amp = 26 * (1 - s) + 6;
      const jitter = Math.sin((i * 12.9898 + e.seed) * 43.233);
      const x = e.x + (jitter - Math.trunc(jitter)) * 2 * amp - amp;
      verts.push(x, -wy, 5);
    }

    // Halo de color (grueso aproximado con línea) + núcleo blanco.
    this.dynamicGroup.add(this.polyline(verts, e.color, fade * 0.6));
    this.dynamicGroup.add(this.polyline(verts, "#ffffff", fade));

    // Destello en el impacto.
    if (fall >= 1) {
      const flashR = 46 * easeOut(Math.min(1, (prog - 0.35) / 0.4));
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(flashR * 0.85, flashR, 24),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(e.color),
          transparent: true,
          opacity: fade,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.set(e.x, -e.y, 6);
      this.dynamicGroup.add(ring);

      const core = new THREE.Mesh(
        this.sphereGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: fade }),
      );
      core.scale.setScalar(14 * fade);
      core.position.set(e.x, -e.y, 6);
      this.dynamicGroup.add(core);
    }
  }

  private polyline(verts: number[], color: string, opacity: number): THREE.Line {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
    });
    return new THREE.Line(geo, mat);
  }

  /** Crea un sprite de texto (números del grid, etiquetas de dev). */
  private textSprite(
    text: string,
    x: number,
    y: number,
    z: number,
    color = "#3c5078",
  ): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.font = "bold 40px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
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

/** HSL (0..1) a hex #rrggbb. */
function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(c * 255);
  };
  const toHex = (v: number): string => v.toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
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

function disposeMaterial(m: THREE.Material): void {
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
