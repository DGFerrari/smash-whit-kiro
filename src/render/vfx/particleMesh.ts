/**
 * Adaptador fino Three.js del ParticlePool: un único InstancedMesh (un draw
 * call), quads billboard con mezcla aditiva. No asigna memoria por frame:
 * reutiliza matriz, cuaternión, vectores y color.
 */
import * as THREE from "three";
import type { ParticlePool } from "./particlePool.ts";

export interface ParticleMesh {
  readonly mesh: THREE.InstancedMesh;
  /** Vuelca el estado del pool a las instancias, orientadas hacia la cámara. */
  sync(pool: ParticlePool, camera: THREE.Camera): void;
  dispose(): void;
}

export function createParticleMesh(pool: ParticlePool): ParticleMesh {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, pool.physicalCapacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const col = new THREE.Color();

  // Fuerza la creación de instanceColor una sola vez.
  for (let i = 0; i < pool.physicalCapacity; i++) mesh.setColorAt(i, col.setRGB(0, 0, 0));
  mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);

  let n = 0;
  const write = (slot: number): void => {
    const f = pool.life01(slot);
    const s = pool.size[slot] * (0.4 + 0.6 * f);
    pos.set(pool.px[slot], pool.py[slot], pool.pz[slot]);
    scl.set(s, s, s);
    m.compose(pos, quat, scl);
    mesh.setMatrixAt(n, m);
    // Aditivo: atenuar el color equivale a desvanecer.
    mesh.setColorAt(n, col.setRGB(pool.r[slot] * f, pool.g[slot] * f, pool.b[slot] * f));
    n++;
  };

  return {
    mesh,
    sync(p, camera) {
      camera.getWorldQuaternion(quat);
      n = 0;
      p.forEachAlive(write);
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
