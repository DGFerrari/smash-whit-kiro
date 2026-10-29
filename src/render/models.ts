import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AnimState, CharacterModel } from "../game/characters.ts";

/**
 * Carga y gestión de modelos 3D (glTF/glb) de los personajes.
 *
 *  - `preload(url)`: carga un .glb una vez (cacheado por URL). Devuelve promesa.
 *  - `createInstance(model)`: clona el modelo cacheado (con su esqueleto) para
 *    una instancia concreta de combatiente; devuelve un FighterModel listo para
 *    colocar, orientar y animar.
 *
 * Clonar con SkeletonUtils.clone es lo correcto para mallas con huesos (skinned)
 * cuando quieres varias instancias del mismo modelo (p. ej. P1 y P2 iguales).
 */

interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedModel>>();

/** Carga (y cachea) un .glb por URL. */
export function preloadModel(url: string): Promise<LoadedModel> {
  const existing = cache.get(url);
  if (existing) return existing;
  const p = new Promise<LoadedModel>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve({ scene: gltf.scene as THREE.Group, animations: gltf.animations }),
      undefined,
      (err) => reject(err),
    );
  });
  cache.set(url, p);
  return p;
}

/**
 * Una instancia de modelo para un combatiente: su objeto en escena, su mixer de
 * animación y el mapa de clips por estado. Sabe colocarse en coords de mundo,
 * orientarse según el facing y cambiar de animación con fundido.
 */
export class FighterModel {
  readonly root: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimState, THREE.AnimationAction>();
  private current: AnimState | null = null;

  constructor(
    loaded: LoadedModel,
    private readonly spec: CharacterModel,
    tintColor: number | null,
  ) {
    // Clonamos la escena (respetando el esqueleto) para esta instancia.
    this.root = cloneSkeleton(loaded.scene) as THREE.Group;
    this.root.scale.setScalar(spec.scale);

    // Sombras y tinte opcional.
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (tintColor !== null) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat && "color" in mat) {
            // Clonamos el material para no teñir otras instancias.
            const m = mat.clone();
            m.color = new THREE.Color(tintColor);
            mesh.material = m;
          }
        }
      }
    });

    // Mixer + acciones a partir del mapa de clips del personaje.
    this.mixer = new THREE.AnimationMixer(this.root);
    const byName = new Map(loaded.animations.map((c) => [c.name, c]));
    const clips = spec.clips ?? {};
    for (const [state, clipName] of Object.entries(clips) as [AnimState, string][]) {
      const clip = byName.get(clipName);
      if (clip) this.actions.set(state, this.mixer.clipAction(clip));
    }
    // Si no hay "idle" mapeado pero el modelo trae alguna animación, usamos la
    // primera como idle para que al menos no se quede totalmente congelado.
    if (!this.actions.has("idle") && loaded.animations.length > 0) {
      this.actions.set("idle", this.mixer.clipAction(loaded.animations[0]));
    }
  }

  /**
   * Coloca el modelo en coordenadas de ESCENA (Y ya invertida por el renderer)
   * y lo orienta según el facing del jugador (1 derecha, -1 izquierda).
   */
  place(sceneX: number, sceneY: number, facing: 1 | -1): void {
    const offY = this.spec.offsetY ?? 0;
    this.root.position.set(sceneX, sceneY - offY, 0);
    // Orientamos girando sobre Y: comparamos el facing con el "forward" nativo.
    const forward = this.spec.forwardX ?? 1;
    const faceRight = facing === forward;
    this.root.rotation.y = faceRight ? 0 : Math.PI;
  }

  /** Cambia la animación activa (con fundido) si el estado cambió. */
  setState(state: AnimState): void {
    if (state === this.current) return;
    const next = this.actions.get(state) ?? this.actions.get("idle");
    if (!next) {
      this.current = state;
      return;
    }
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset().setEffectiveWeight(1).play();
    if (prev && prev !== next) {
      next.crossFadeFrom(prev, 0.15, false);
    }
    this.current = state;
  }

  /** Avanza las animaciones. `dt` en segundos (tiempo real del frame). */
  update(dt: number): void {
    this.mixer.update(dt);
  }

  /** Libera recursos del mixer (al quitar la instancia). */
  dispose(): void {
    this.mixer.stopAllAction();
  }
}
