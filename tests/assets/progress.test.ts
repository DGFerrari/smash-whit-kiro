import { describe, it, expect } from "vitest";

import {
  ProgressTracker,
  computeLoadProgress,
  formatBytesText,
  formatRemainingText,
} from "../../src/assets/progress.ts";

describe("computeLoadProgress", () => {
  it("devuelve 100 con un grupo vacío", () => {
    expect(computeLoadProgress([]).percent).toBe(100);
  });

  it("usa bytes cuando todos los tamaños se conocen (R15.3)", () => {
    const p = computeLoadProgress([
      { id: "a", bytesTotal: 300, bytesLoaded: 100, done: false },
      { id: "b", bytesTotal: 700, bytesLoaded: 0, done: false },
    ]);
    expect(p.percent).toBe(10);
    expect(p.bytesTotal).toBe(1000);
  });

  it("usa recuento si algún tamaño es desconocido (R15.4)", () => {
    const p = computeLoadProgress([
      { id: "a", bytesTotal: null, bytesLoaded: 500, done: true },
      { id: "b", bytesTotal: 100, bytesLoaded: 99, done: false },
      { id: "c", bytesTotal: 100, bytesLoaded: 0, done: false },
    ]);
    expect(p.bytesTotal).toBeNull();
    expect(p.percent).toBe(33);
  });

  it("topa en 99 hasta terminar y no decrece respecto al anterior", () => {
    const almost = computeLoadProgress([
      { id: "a", bytesTotal: 1000, bytesLoaded: 1000, done: false },
    ]);
    expect(almost.percent).toBe(99);
    const lower = computeLoadProgress(
      [{ id: "a", bytesTotal: 1000, bytesLoaded: 10, done: false }],
      50,
    );
    expect(lower.percent).toBe(50);
  });
});

describe("ProgressTracker", () => {
  it("cuenta fallidos y caché como procesados con sus bytes totales (R15.9, R15.12)", () => {
    const t = new ProgressTracker([
      { id: "a", bytesTotal: 400 },
      { id: "b", bytesTotal: 600 },
    ]);
    t.markCached("a");
    expect(t.snapshot()).toMatchObject({ assetsDone: 1, bytesLoaded: 400, percent: 40 });
    t.addBytes("b", 100);
    t.fail("b");
    expect(t.snapshot()).toMatchObject({ assetsDone: 2, bytesLoaded: 1000, percent: 100 });
  });

  it("mantiene la monotonía cuando un Content-Length tardío cambia el denominador (R15.7)", () => {
    const t = new ProgressTracker([{ id: "a", bytesTotal: 100 }, { id: "b" }]);
    t.complete("a");
    expect(t.snapshot().percent).toBe(50);
    t.setTotal("b", 10_000);
    expect(t.snapshot().percent).toBe(50);
  });

  it("timeout marca los pendientes como fallidos y llega a 100 (R15.10)", () => {
    const t = new ProgressTracker([{ id: "a", bytesTotal: 100 }, { id: "b" }]);
    t.addBytes("a", 30);
    expect(t.timeout()).toEqual(["a", "b"]);
    expect(t.snapshot().percent).toBe(100);
    t.addBytes("a", 1000); // llegada tardía ignorada
    expect(t.snapshot().bytesLoaded).toBe(100);
  });
});

describe("formato", () => {
  it("formatea megabytes con un decimal y coma (R15.5)", () => {
    const p = computeLoadProgress([
      { id: "a", bytesTotal: 30_000_000, bytesLoaded: 12_400_000, done: false },
    ]);
    expect(formatBytesText(p)).toBe("12,4 MB / 30,0 MB");
    expect(formatRemainingText(p)).toBe("1 recurso restante");
  });

  it("omite MB con tamaños desconocidos y cuenta los restantes", () => {
    const p = computeLoadProgress([
      { id: "a", bytesTotal: null, bytesLoaded: 0, done: false },
      { id: "b", bytesTotal: 10, bytesLoaded: 0, done: false },
    ]);
    expect(formatBytesText(p)).toBeNull();
    expect(formatRemainingText(p)).toBe("2 recursos restantes");
  });
});
