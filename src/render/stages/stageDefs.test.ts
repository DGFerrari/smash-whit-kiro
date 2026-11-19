import { describe, expect, it } from "vitest";
import { STAGE_VISUALS, getStageVisual } from "./stageDefs.ts";
import { PROP_COUNT_BY_LEVEL } from "./animatedProps.ts";

const IDS = Object.keys(STAGE_VISUALS) as (keyof typeof STAGE_VISUALS)[];

describe("Definiciones de escenario", () => {
  it("cubre los cuatro escenarios con ≥ 6 props (nivel alto) y ≥ 1 capa lejana", () => {
    expect(IDS.sort()).toEqual(["neonIsland", "sunsetIsland", "training", "voidIsland"]);
    for (const id of IDS) {
      const d = STAGE_VISUALS[id];
      expect(d.props.length).toBeGreaterThanOrEqual(PROP_COUNT_BY_LEVEL.alto);
      expect(d.layers.length).toBeGreaterThanOrEqual(1);
      expect(new Set(d.props.map((p) => p.id)).size).toBe(d.props.length);
    }
  });

  it("cada escenario tiene fondo y luz principal propios", () => {
    const bgs = new Set(IDS.map((id) => STAGE_VISUALS[id].background));
    const keys = new Set(IDS.map((id) => STAGE_VISUALS[id].key.color));
    expect(bgs.size).toBe(IDS.length);
    expect(keys.size).toBe(IDS.length);
  });

  it("id desconocido cae al escenario por defecto", () => {
    expect(getStageVisual(undefined).id).toBe("neonIsland");
  });
});
