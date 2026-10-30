import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { FIXED_DT } from "../src/engine/config.ts";
import { World } from "../src/engine/game/world.ts";
import { ReplayPlayer, type ReplayData } from "../src/engine/game/replay.ts";

/**
 * TEST DE DETERMINISMO (red de seguridad de la Fase 1).
 *
 * La simulación debe ser determinista: misma semilla + mismos inputs => mismo
 * estado final, siempre. Esto sostiene los replays y es el requisito del futuro
 * netcode por rollback y de la validación de partidas en servidor.
 *
 * El test reproduce un replay real DOS veces (cada una con un World nuevo) y
 * comprueba que el estado final de todos los combatientes coincide bit a bit.
 * Si algún cambio futuro mete azar sin semilla, tiempo real u orden inestable
 * en la simulación, este test lo caza.
 */

const here = dirname(fileURLToPath(import.meta.url));

function loadReplay(name: string): ReplayData {
  const path = resolve(here, "../src/replays", name);
  return JSON.parse(readFileSync(path, "utf-8")) as ReplayData;
}

/** Snapshot de los campos de SIMULACIÓN de un combatiente (no presentación). */
interface FighterSnapshot {
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  damage: number;
  lives: number;
  dealt: number;
  taken: number;
  kos: number;
  deaths: number;
}

/** Reproduce un replay entero en un World nuevo y devuelve el estado final. */
function simulate(data: ReplayData): FighterSnapshot[] {
  const world = new World(data.mode, data.seed, {
    characters: data.characters,
    controllers: data.controllers,
    cpuDifficulty: data.cpuDifficulties ?? data.cpuDifficulty,
    stage: data.stage,
  });
  const player = new ReplayPlayer(data);

  for (let step = 0; step < player.totalSteps; step++) {
    world.step(player.inputsAt(step), FIXED_DT);
  }

  return world.fighters.map((f) => ({
    posX: f.player.pos.x,
    posY: f.player.pos.y,
    velX: f.player.vel.x,
    velY: f.player.vel.y,
    damage: f.player.damage,
    lives: f.lives,
    dealt: f.player.stats.dealt,
    taken: f.player.stats.taken,
    kos: f.player.stats.kos,
    deaths: f.player.stats.deaths,
  }));
}

describe("determinismo de la simulación", () => {
  const replays = ["menu1.json", "menu2.json", "menu3.json"];

  for (const name of replays) {
    it(`reproduce ${name} de forma idéntica dos veces`, () => {
      const data = loadReplay(name);
      const runA = simulate(data);
      const runB = simulate(data);
      expect(runB).toEqual(runA);
    });
  }
});
