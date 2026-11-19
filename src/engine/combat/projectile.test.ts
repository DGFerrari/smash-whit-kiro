import { describe, it, expect } from "vitest";

import { FIXED_DT } from "../config.ts";
import { World } from "../game/world.ts";
import { createInputState, type InputState } from "../core/inputState.ts";

/**
 * Proyectiles (motor v3): Kaito lanza un kunai con el ligero neutro contra el
 * saco de entrenamiento. Comprobamos que el proyectil nace, que acaba
 * desapareciendo y que la simulación es determinista.
 */
function run(): { spawned: boolean; remaining: number; sandbagDamage: number } {
  const world = new World("training", 1234, { characters: ["kaito", "sandbag"] });
  let spawned = false;
  for (let step = 0; step < 240; step++) {
    const input: InputState = createInputState();
    // Ligero neutro cada 20 pasos (flanco de subida).
    input.lightPressed = step % 20 === 10;
    world.step([input, createInputState()], FIXED_DT);
    if (world.projectiles.length > 0) spawned = true;
  }
  // Dejamos que los proyectiles en vuelo terminen su vida.
  for (let step = 0; step < 120; step++) {
    world.step([createInputState(), createInputState()], FIXED_DT);
  }
  return {
    spawned,
    remaining: world.projectiles.length,
    sandbagDamage: world.fighters[1].player.damage,
  };
}

describe("proyectiles", () => {
  it("el kunai nace, caduca y la simulación es determinista", () => {
    const a = run();
    const b = run();
    expect(a.spawned).toBe(true);
    expect(a.remaining).toBe(0);
    expect(b).toEqual(a);
  });
});
