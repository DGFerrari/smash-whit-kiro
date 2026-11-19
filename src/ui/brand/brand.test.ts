// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createLogo } from "./logo.ts";
import {
  createCharacterPortrait,
  createStagePreview,
} from "./portraits.ts";
import { characterLore, stageLore } from "../../content/lore.ts";

describe("logo", () => {
  it("renders an accessible SVG labelled KiroBrawl", () => {
    const wrap = createLogo();
    const svg = wrap.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("role")).toBe("img");
    expect(svg!.getAttribute("aria-label")).toBe("KiroBrawl");
    expect(wrap.dataset.logo).toBe("svg");
  });

  it("falls back to an h1 with the display font in the same container", () => {
    const wrap = createLogo({ forceFallback: true });
    const h1 = wrap.querySelector("h1");
    expect(wrap.querySelector("svg")).toBeNull();
    expect(h1?.textContent).toBe("KiroBrawl");
    expect(h1?.getAttribute("style")).toContain("var(--font-display)");
    expect(wrap.dataset.logo).toBe("fallback");
  });

  it("uses unique gradient ids per instance", () => {
    const a = createLogo().querySelector("linearGradient")!.id;
    const b = createLogo().querySelector("linearGradient")!.id;
    expect(a).not.toBe(b);
  });
});

describe("character portraits", () => {
  it.each(["blue", "red", "yellow", "green", "sandbag"])("labels %s with its visible name", (id) => {
    const svg = createCharacterPortrait(id);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(characterLore(id).name);
  });

  it("is deterministic per seed", () => {
    const strip = (s: string) => s.replace(/kb-pt-[a-z]+-[0-9a-z]+/g, "ID");
    expect(strip(createCharacterPortrait("red").outerHTML)).toBe(
      strip(createCharacterPortrait("red").outerHTML),
    );
  });
});

describe("stage previews", () => {
  it.each(["neonIsland", "sunsetIsland", "voidIsland", "training"])("renders %s as SVG", (id) => {
    const wrap = createStagePreview(id);
    expect(wrap.dataset.preview).toBe("svg");
    expect(wrap.querySelector("svg")!.getAttribute("aria-label")).toBe(stageLore(id).name);
  });

  it("shows a placeholder with the visible name when the preview fails", () => {
    const wrap = createStagePreview("neonIsland", { forceFallback: true });
    expect(wrap.dataset.preview).toBe("placeholder");
    expect(wrap.querySelector("svg")).toBeNull();
    expect(wrap.textContent).toBe("Distrito Neón");
    const ph = wrap.querySelector('[role="img"]')!;
    expect(ph.getAttribute("aria-label")).toBe("Distrito Neón");
    expect(ph.getAttribute("style")).toContain("var(--color-surface)");
  });

  it("falls back to the placeholder for stages without art", () => {
    const wrap = createStagePreview("futureStage");
    expect(wrap.dataset.preview).toBe("placeholder");
    expect(wrap.textContent).toBe("futureStage");
  });
});
