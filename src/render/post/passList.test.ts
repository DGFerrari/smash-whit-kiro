import { describe, expect, it } from "vitest";
import { buildPassList, needsComposer, passListKey, BLOOM_THRESHOLD } from "./passList";
import { LEVELS, PRESETS, type Level } from "../quality/visualPrefs";

const q = (bloom: Level, dof: Level, lensFlares: Level, impactLensFlares?: boolean) => ({
  controls: { bloom, dof, lensFlares },
  impactLensFlares,
});

describe("buildPassList", () => {
  it("is empty when everything is off (direct render)", () => {
    const passes = buildPassList(q("desactivado", "desactivado", "desactivado"));
    expect(passes).toEqual([]);
    expect(needsComposer(passes)).toBe(false);
  });

  it("contains bloom/dof/lensflare iff the control is not desactivado (Property 7)", () => {
    for (const bloom of LEVELS)
      for (const dof of LEVELS)
        for (const lf of LEVELS) {
          const kinds = buildPassList(q(bloom, dof, lf)).map((p) => p.kind);
          expect(kinds.includes("bloom")).toBe(bloom !== "desactivado");
          expect(kinds.includes("dof")).toBe(dof !== "desactivado");
          expect(kinds.includes("lensflare")).toBe(lf !== "desactivado");
          const composer = bloom !== "desactivado" || dof !== "desactivado";
          expect(kinds.includes("output")).toBe(composer);
          if (composer) expect(kinds[kinds.length - 1]).toBe("output");
        }
  });

  it("orders dof → bloom → lensflare → output", () => {
    const kinds = buildPassList(q("alto", "medio", "alto")).map((p) => p.kind);
    expect(kinds).toEqual(["dof", "bloom", "lensflare", "output"]);
  });

  it("only lens flares does not need the composer", () => {
    const passes = buildPassList(q("desactivado", "desactivado", "bajo"));
    expect(passes.map((p) => p.kind)).toEqual(["lensflare"]);
    expect(needsComposer(passes)).toBe(false);
  });

  it("scales bloom/dof parameters with level", () => {
    const low = buildPassList(q("bajo", "bajo", "bajo"));
    const high = buildPassList(q("alto", "alto", "alto"));
    const bloomLow = low.find((p) => p.kind === "bloom");
    const bloomHigh = high.find((p) => p.kind === "bloom");
    const dofLow = low.find((p) => p.kind === "dof");
    const dofHigh = high.find((p) => p.kind === "dof");
    if (bloomLow?.kind !== "bloom" || bloomHigh?.kind !== "bloom") throw new Error("bloom");
    if (dofLow?.kind !== "dof" || dofHigh?.kind !== "dof") throw new Error("dof");
    expect(bloomLow.resolutionScale).toBe(0.5);
    expect(bloomLow.strength).toBeCloseTo(0.6);
    expect(bloomHigh.resolutionScale).toBe(1);
    expect(bloomLow.threshold).toBe(BLOOM_THRESHOLD);
    expect(bloomHigh.strength).toBeGreaterThan(bloomLow.strength);
    expect(dofLow.resolutionScale).toBe(0.25);
    expect(dofHigh.resolutionScale).toBe(0.5);
  });

  it("lens flare ghosts only above bajo; impact follows impactLensFlares", () => {
    const lowLf = buildPassList(q("desactivado", "desactivado", "bajo", false))[0];
    const highLf = buildPassList(q("desactivado", "desactivado", "alto", true))[0];
    expect(lowLf).toMatchObject({ kind: "lensflare", ghosts: false, impact: false });
    expect(highLf).toMatchObject({ kind: "lensflare", ghosts: true, impact: true });
  });

  it("presets: bajo renders direct, medio uses half-res bloom without DOF", () => {
    expect(buildPassList({ controls: PRESETS.bajo })).toEqual([]);
    const medio = buildPassList({ controls: PRESETS.medio }).map((p) => p.kind);
    expect(medio).toEqual(["bloom", "lensflare", "output"]);
  });

  it("key is stable for equal inputs and changes otherwise", () => {
    const a = passListKey(buildPassList(q("medio", "desactivado", "bajo")));
    const b = passListKey(buildPassList(q("medio", "desactivado", "bajo")));
    const c = passListKey(buildPassList(q("alto", "desactivado", "bajo")));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
