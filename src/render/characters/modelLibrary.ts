/**
 * Cargador y biblioteca de modelos GLTF de personajes (R11.1, R12).
 *
 * - Los bytes se descargan con el AssetLoader (progreso real en la pantalla
 *   de carga, caché en memoria y límite de 60 s) y se interpretan con
 *   `GLTFLoader.parseAsync`.
 * - Un único `console.error` por personaje con id, ruta y motivo (R12.3).
 * - Mientras un modelo no está listo (o si falla), el renderer usa el
 *   Modelo_Respaldo procedimental (R12.1).
 * - Cada instancia clona el esqueleto (SkeletonUtils) para que dos jugadores
 *   con el mismo personaje se animen por separado.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CharacterId } from "../../engine/game/characters.ts";
import type { AssetLoader } from "../../assets/assetLoader.ts";
import { CHARACTER_MODELS, modelAssetId, type CharacterModelAsset } from "./characterAssets.ts";
import { getCharacterVisual } from "./characterDefs.ts";
import { ANIM_STATES, CROSSFADE_SECONDS, resolveClipPlan, type AnimState } from "./animator.ts";
import { createStylizedUniforms, setHitTint, stylizeModel, type StylizedUniforms } from "./materials.ts";
import type { FallbackCharacter } from "./fallbackModel.ts";

interface ModelTemplate {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Escala para que la altura del cuerpo sea 1 y desplazamiento para pies en 0. */
  scale: number;
  offsetY: number;
}

const templates = new Map<CharacterId, ModelTemplate>();
const pending = new Map<CharacterId, Promise<boolean>>();
const reported = new Set<CharacterId>();

/** ¿Hay modelo GLTF para este personaje? (el saco no tiene). */
export function hasCharacterModel(id: CharacterId): boolean {
  return CHARACTER_MODELS[id] !== undefined;
}

/** ¿Está ya interpretado y listo para instanciarse? */
export function isCharacterModelReady(id: CharacterId): boolean {
  return templates.has(id);
}

function reportOnce(id: CharacterId, path: string, reason: string, err?: unknown): void {
  if (reported.has(id)) return;
  reported.add(id);
  console.error(`[models] no se pudo cargar el modelo de "${id}" (${path}): ${reason}`, err ?? "");
}

/**
 * Asegura que el modelo de `id` esté cargado. Resuelve `true` si queda listo y
 * `false` si no hay modelo o falló (en ese caso se usa el respaldo). Nunca
 * rechaza. Reutiliza los bytes ya cacheados por el AssetLoader.
 */
export function ensureCharacterModel(id: CharacterId, loader: AssetLoader): Promise<boolean> {
  if (templates.has(id)) return Promise.resolve(true);
  const existing = pending.get(id);
  if (existing) return existing;
  const asset = CHARACTER_MODELS[id];
  if (!asset) return Promise.resolve(false);

  const p = (async (): Promise<boolean> => {
    const assetId = modelAssetId(id);
    let data = loader.cached(assetId);
    if (!data) {
      const handle = loader.load([{ id: assetId, url: asset.url, kind: "gltf", sizeHint: asset.sizeHint }]);
      const out = (await handle.done).get(assetId);
      if (!out || out.status !== "loaded") {
        reportOnce(id, asset.url, out?.status === "failed" ? out.reason : "network");
        return false;
      }
      data = out.data;
    }
    try {
      const gltf = await new GLTFLoader().parseAsync(data, "");
      templates.set(id, buildTemplate(gltf.scene, gltf.animations, asset));
      return true;
    } catch (err) {
      reportOnce(id, asset.url, "parse", err);
      return false;
    }
  })();
  pending.set(id, p);
  return p;
}

/** Precarga en segundo plano de todos los modelos (no bloquea). */
export function prefetchCharacterModels(loader: AssetLoader): void {
  for (const id of Object.keys(CHARACTER_MODELS) as CharacterId[]) void ensureCharacterModel(id, loader);
}

function buildTemplate(scene: THREE.Object3D, animations: THREE.AnimationClip[], asset: CharacterModelAsset): ModelTemplate {
  // Oculta los accesorios no elegidos.
  const keep = new Set(asset.keepNodes);
  const accessories = new Set(asset.accessoryNodes);
  scene.traverse((o) => {
    if (accessories.has(o.name) && !keep.has(o.name)) o.visible = false;
  });
  // Altura según el cuerpo (sin armas ni sombreros), en la pose de reposo.
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || accessories.has(o.name)) return;
    if (!/(Body|Head|Leg|Arm)/.test(o.name)) return;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    box.union(b);
  });
  const h = box.isEmpty() ? 1 : box.max.y - box.min.y;
  const scale = h > 0 ? 1 / h : 1;
  return { scene, animations, scale, offsetY: box.isEmpty() ? 0 : -box.min.y * scale };
}

// ---------------------------------------------------------------------------
// Instancias
// ---------------------------------------------------------------------------

const ONE_SHOT = new Set<AnimState>(["light", "heavy", "dodge", "stun"]);
const INSTANT = new Set<AnimState>(["light", "heavy", "dodge"]);
const FACING_YAW = 1.05;
const YAW_SPEED = (2 * FACING_YAW) / 0.08;

/**
 * Crea una instancia animable del modelo GLTF con la misma interfaz que el
 * Modelo_Respaldo (el renderer los trata igual). `null` si no está listo.
 */
export function createGltfCharacter(id: CharacterId): FallbackCharacter | null {
  const tpl = templates.get(id);
  const asset = CHARACTER_MODELS[id];
  if (!tpl || !asset) return null;
  const def = getCharacterVisual(id);

  const root = new THREE.Group();
  root.name = `kb-gltf-${id}`;
  const holder = new THREE.Group();
  holder.scale.setScalar(tpl.scale);
  holder.position.y = tpl.offsetY;
  root.add(holder);
  const model = cloneSkinned(tpl.scene);
  holder.add(model);

  const rim = new THREE.Color(def.dominantColor).lerp(new THREE.Color(1, 1, 1), 0.55);
  const uniforms: StylizedUniforms = createStylizedUniforms({ rimColor: rim, rimPower: 2.4, rimStrength: 0.85 });
  // Clona los materiales (el tinte de golpe es por instancia) y los estiliza.
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    m.frustumCulled = false;
  });
  stylizeModel(model, {}, uniforms);

  const mixer = new THREE.AnimationMixer(model);
  const byName = new Map(tpl.animations.map((c) => [c.name, c] as const));
  const plan = resolveClipPlan([...byName.keys()], asset.clips);
  const actions = new Map<AnimState, THREE.AnimationAction>();
  for (const s of ANIM_STATES) {
    const choice = plan[s];
    const clip = choice ? byName.get(choice.clip) : undefined;
    if (!clip) continue;
    // Estados con el mismo clip (jump/fall/wallSlide) comparten acción.
    const a = mixer.clipAction(clip);
    if (ONE_SHOT.has(s)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    a.timeScale = asset.timeScale[s] ?? 1;
    actions.set(s, a);
  }

  let current: AnimState | null = null;
  let yaw = FACING_YAW;

  const play = (next: AnimState): void => {
    if (next === current) return;
    const from = current ? actions.get(current) : undefined;
    const to = actions.get(next);
    current = next;
    if (!to) return;
    if (from === to) {
      if (INSTANT.has(next)) to.reset().play();
      return;
    }
    to.reset();
    to.setEffectiveTimeScale(asset.timeScale[next] ?? 1);
    to.setEffectiveWeight(1).play();
    if (!from || INSTANT.has(next)) {
      for (const a of actions.values()) if (a !== to) a.stop();
    } else {
      from.crossFadeTo(to, CROSSFADE_SECONDS, false);
    }
  };

  return {
    id,
    root,
    rig: null,
    uniforms,
    dominantColor: def.dominantColor,
    update(state, dt) {
      play(state);
      mixer.update(Math.max(0, dt));
    },
    setFacing(facing, dt) {
      const goal = facing * FACING_YAW;
      const step = YAW_SPEED * Math.max(0, dt);
      const d = goal - yaw;
      yaw = Math.abs(d) <= step ? goal : yaw + Math.sign(d) * step;
      root.rotation.y = yaw;
    },
    setHitTint(amount, color) {
      setHitTint(uniforms, amount, color);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
      });
    },
  };
}
