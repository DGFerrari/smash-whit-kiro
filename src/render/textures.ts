import * as THREE from "three";

/**
 * Gestor de texturas para el render 3D.
 *
 * Carga imágenes de forma perezosa y las cachea por URL, de modo que varias
 * superficies que usan la misma textura comparten el mismo objeto Texture
 * (menos memoria y menos trabajo de GPU). Cada superficie puede pedir una
 * repetición (tiling) distinta clonando la textura cacheada.
 *
 * Diseño pensado para que el renderer no tenga que saber de carga asíncrona:
 * `get()` devuelve una Texture al momento (vacía al principio) y, cuando la
 * imagen termina de cargar, Three.js la sube a GPU y se ve sola en el siguiente
 * frame (gracias a needsUpdate).
 *
 * Coloca tus imágenes en `public/textures/` y referencia por ruta absoluta de
 * Vite, p. ej. "/textures/suelo.png". Si la textura no existe o falla, la
 * superficie seguirá mostrándose con su color base (no se rompe nada).
 */

/** Descripción de una textura a aplicar a una superficie. */
export interface TextureSpec {
  /** URL de la imagen (p. ej. "/textures/metal.png"). */
  url: string;
  /** Repeticiones horizontales/verticales (tiling). Por defecto 1x1. */
  repeat?: [number, number];
  /** Filtrado nearest (pixel-art) en vez de lineal. */
  pixelated?: boolean;
}

const loader = new THREE.TextureLoader();

/** Caché por URL de la textura "maestra" ya cargada. */
const cache = new Map<string, THREE.Texture>();

/** Devuelve (y cachea) la textura maestra de una URL. */
function master(url: string): THREE.Texture {
  const existing = cache.get(url);
  if (existing) return existing;

  const tex = loader.load(
    url,
    // onLoad: forzamos actualización por si la Texture ya estaba en un material.
    (t) => {
      t.needsUpdate = true;
    },
    undefined,
    // onError: dejamos la textura vacía; la superficie usará su color base.
    () => {
      console.warn(`[textures] No se pudo cargar: ${url}`);
    },
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  cache.set(url, tex);
  return tex;
}

/**
 * Obtiene una textura lista para asignar a un material, con el tiling/filtrado
 * pedido. Si hay tiling o filtrado específico, clona la maestra (barato: la
 * imagen se comparte) para no pisar la config de otras superficies.
 */
export function getTexture(spec: TextureSpec): THREE.Texture {
  const base = master(spec.url);
  const repeat = spec.repeat ?? [1, 1];
  const needsClone =
    repeat[0] !== 1 || repeat[1] !== 1 || spec.pixelated === true;

  const tex = needsClone ? base.clone() : base;
  if (needsClone) {
    // El clon comparte la imagen; si aún no cargó, se actualizará solo.
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.repeat.set(repeat[0], repeat[1]);
  if (spec.pixelated) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
  }
  return tex;
}
