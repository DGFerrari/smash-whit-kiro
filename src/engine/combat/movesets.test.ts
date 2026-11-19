import { describe, expect, it } from "vitest";
import { SELECTABLE_CHARACTERS } from "../game/characters.ts";
import { World } from "../game/world.ts";
import { LEGACY_MOVESET, MOVESETS, getMoveset } from "./movesets.ts";

const DIRS = ["neutral", "side", "up", "down"] as const;

describe("sets de movimientos", () => {
  it("los 12 personajes tienen set propio con nombre y parte del cuerpo en los 8 movimientos", () => {
    const names = new Set<string>();
    for (const id of SELECTABLE_CHARACTERS) {
      const m = MOVESETS[id];
      expect(m, id).toBeDefined();
      for (const d of DIRS) {
        for (const def of [m!.light[d], m!.heavy[d]]) {
          expect(def.name, `${id} ${def.kind} ${d}`).toBeTruthy();
          expect(def.limb).toBeTruthy();
          expect(def.startup).toBeGreaterThan(0);
          expect(def.damage).toBeGreaterThan(0);
          expect(def.knockbackUp).toBeGreaterThanOrEqual(0);
          expect(def.knockbackUp).toBeLessThanOrEqual(1);
          names.add(def.name!);
        }
        expect(m!.light[d].kind).toBe("light");
        expect(m!.heavy[d].kind).toBe("heavy");
        expect(m!.light[d].dir).toBe(d);
      }
    }
    // Cada personaje tiene nombres de movimiento propios.
    expect(names.size).toBe(SELECTABLE_CHARACTERS.length * 8);
  });

  it("los replays antiguos (motor v1) usan el set común", () => {
    expect(getMoveset("kael", true)).toBe(LEGACY_MOVESET);
    const old = new World("versus", 1234, { characters: ["kael", "red"], engineVersion: 1 });
    expect(old.fighters[0].player.moveset).toBe(LEGACY_MOVESET);
    const now = new World("versus", 1234, { characters: ["kael", "red"] });
    expect(now.fighters[0].player.moveset).toBe(MOVESETS.kael);
  });

  it("el saco de entrenamiento usa el set común", () => {
    expect(getMoveset("sandbag")).toBe(LEGACY_MOVESET);
  });
});
