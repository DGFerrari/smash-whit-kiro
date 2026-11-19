// @vitest-environment jsdom
// Humo de infraestructura: confirma que el opt-in por archivo a jsdom funciona
// y que fast-check está disponible para las pruebas de propiedades.
import { describe, expect, it } from "vitest";
import fc from "fast-check";

describe("infraestructura de pruebas del cliente", () => {
  it("expone un DOM cuando el archivo declara @vitest-environment jsdom", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    el.focus();
    expect(document.activeElement).toBe(el);
  });

  it("fast-check ejecuta propiedades", () => {
    fc.assert(fc.property(fc.integer(), (n) => n + 0 === n), { numRuns: 100 });
  });
});
