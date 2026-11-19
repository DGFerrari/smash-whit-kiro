import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createFallbackCharacter } from "./fallbackModel.ts";
import { ANIM_STATES } from "./animator.ts";
import { SELECTABLE_CHARACTERS, type CharacterId } from "../../engine/game/characters.ts";

const IDS: CharacterId[] = [...SELECTABLE_CHARACTERS, "sandbag"];

describe("Modelo_Respaldo procedimental", () => {
  it("cada personaje se construye con pies en 0 y altura ≈ 1", () => {
    for (const id of IDS) {
      const c = createFallbackCharacter(id);
      c.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(c.root);
      expect(box.min.y).toBeGreaterThan(-0.06);
      expect(box.min.y).toBeLessThan(0.08);
      expect(box.max.y).toBeGreaterThan(0.75);
      expect(box.max.y).toBeLessThan(1.3);
      c.dispose();
    }
  });

  it("los 12 seleccionables (8 originales + 4 crossover) tienen color dominante distinto", () => {
    expect(SELECTABLE_CHARACTERS).toHaveLength(12);
    const colors = new Set(SELECTABLE_CHARACTERS.map((id) => createFallbackCharacter(id).dominantColor));
    expect(colors.size).toBe(12);
  });

  it("anima todos los estados sin valores no finitos", () => {
    const c = createFallbackCharacter("blue");
    for (const s of ANIM_STATES) {
      for (let i = 0; i < 10; i++) c.update(s, 1 / 60);
      c.root.traverse((o) => {
        expect(Number.isFinite(o.rotation.x)).toBe(true);
        expect(Number.isFinite(o.position.y)).toBe(true);
      });
    }
    c.setFacing(-1, 0.2);
    expect(c.root.rotation.y).toBeLessThan(0);
    c.dispose();
  });
});
