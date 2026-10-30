import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";

import type { ReplayData } from "../../../src/engine/game/replay.ts";
import { validateMatch, MatchValidationError } from "./validate.ts";

/**
 * Prueba del validador de partidas: re-simula replays reales y comprueba que el
 * cálculo de resultado/monedas es coherente y determinista (mismo replay =>
 * mismo resultado).
 */

const here = dirname(fileURLToPath(import.meta.url));

function loadReplay(name: string): ReplayData {
  const path = resolve(here, "../../../src/replays", name);
  return JSON.parse(readFileSync(path, "utf-8")) as ReplayData;
}

describe("validateMatch", () => {
  it("rechaza un replay sin jugador humano (solo CPU)", () => {
    const data = loadReplay("menu1.json"); // 4 CPUs
    expect(() => validateMatch(data)).toThrow(MatchValidationError);
  });

  it("valida un replay con un humano y calcula resultado + monedas", () => {
    // Tomamos un replay real y marcamos el primer slot como humano, para
    // ejercitar el camino feliz (los inputs grabados son los mismos; solo
    // cambia a quién se le atribuye el resultado).
    const data = loadReplay("menu1.json");
    const withHuman: ReplayData = {
      ...data,
      controllers: ["human", ...(data.controllers ?? []).slice(1)] as ("human" | "cpu")[],
    };

    const a = validateMatch(withHuman);
    const b = validateMatch(withHuman);

    // Determinista: dos validaciones del mismo replay dan lo mismo.
    expect(b).toEqual(a);
    // Coherencia básica de los campos.
    expect(a.fighterIndex).toBe(0);
    expect(["S", "A", "B", "C", "D"]).toContain(a.grade);
    expect(a.coins).toBeGreaterThanOrEqual(0);
    expect(a.kills).toBeGreaterThanOrEqual(0);
    expect(a.deaths).toBeGreaterThanOrEqual(0);
    expect(typeof a.won).toBe("boolean");
  });
});
