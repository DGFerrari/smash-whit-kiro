import { describe, expect, it, vi } from "vitest";
import {
  createQualityManager,
  detectDefaultPreset,
  prefersReducedMotion,
  readGpuRenderer,
  resolveQuality,
  STORAGE_WARNING_TEXT,
  type HardwareInfo,
} from "./qualityManager";
import {
  defaultVisualPrefs,
  PRESETS,
  serializeVisualPrefs,
  VISUAL_PREFS_KEY,
} from "./visualPrefs";

class MemStorage implements Storage {
  private m = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error("QuotaExceeded");
    this.m.set(k, v);
  }
}

const GOOD_HW: HardwareInfo = { gpuRenderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)", logicalCores: 8 };
const noop = () => {};

describe("detectDefaultPreset", () => {
  it("medio con GPU identificada y ≥ 4 núcleos, incluso en GPU potente", () => {
    expect(detectDefaultPreset(GOOD_HW)).toBe("medio");
    expect(detectDefaultPreset({ gpuRenderer: "NVIDIA GeForce RTX 4090", logicalCores: 32 })).toBe("medio");
  });
  it("bajo con GPU no identificable o < 4 núcleos", () => {
    expect(detectDefaultPreset({ gpuRenderer: null, logicalCores: 8 })).toBe("bajo");
    expect(detectDefaultPreset({ gpuRenderer: "", logicalCores: 8 })).toBe("bajo");
    expect(detectDefaultPreset({ gpuRenderer: "Google SwiftShader", logicalCores: 8 })).toBe("bajo");
    expect(detectDefaultPreset({ ...GOOD_HW, logicalCores: 3 })).toBe("bajo");
    expect(detectDefaultPreset({ ...GOOD_HW, logicalCores: 0 })).toBe("bajo");
  });
});

describe("lectores inyectables", () => {
  it("readGpuRenderer usa la extensión de depuración o RENDERER", () => {
    const withExt = {
      RENDERER: 1,
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 2 }),
      getParameter: (p: number) => (p === 2 ? "AMD Radeon Vega 8" : "WebKit WebGL"),
    };
    expect(readGpuRenderer(withExt)).toBe("AMD Radeon Vega 8");
    const noExt = { ...withExt, getExtension: () => null };
    expect(readGpuRenderer(noExt)).toBe("WebKit WebGL");
    expect(readGpuRenderer(null)).toBeNull();
  });
  it("prefersReducedMotion es false sin soporte o si lanza", () => {
    expect(prefersReducedMotion(null)).toBe(false);
    expect(prefersReducedMotion(() => { throw new Error("x"); })).toBe(false);
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
  });
});

describe("resolveQuality", () => {
  it("aplica recortes de Movimiento_Reducido sin alterar las preferencias", () => {
    const p = defaultVisualPrefs("alto", true);
    const q = resolveQuality(p);
    expect(q.controls.cameraShake).toBe("desactivado");
    expect(q.controls.speedLines).toBe("desactivado");
    expect(q.impactLensFlares).toBe(false);
    expect(q.flashLimiter).toBe(true);
    expect(q.controls.bloom).toBe("alto");
    expect(p.controls.cameraShake).toBe("alto");

    const off = resolveQuality(defaultVisualPrefs("alto", false));
    expect(off.controls.cameraShake).toBe("alto");
    expect(off.impactLensFlares).toBe(true);
    expect(off.flashLimiter).toBe(false);
  });
});

describe("createQualityManager", () => {
  it("sin preferencias: preset por hardware, prefers-reduced-motion y sobrescritura", () => {
    const storage = new MemStorage();
    const attr = vi.fn();
    const qm = createQualityManager({
      storage,
      hardware: { gpuRenderer: null, logicalCores: 8 },
      matchMedia: () => ({ matches: true }),
      onReducedMotionAttr: attr,
      onStorageWarning: noop,
    });
    expect(qm.get().preset).toBe("bajo");
    expect(qm.get().reducedMotion).toBe(true);
    expect(attr).toHaveBeenCalledWith(true);
    expect(storage.getItem(VISUAL_PREFS_KEY)).not.toBeNull();
  });

  it("con preferencias guardadas: ignora prefers-reduced-motion y el hardware", () => {
    const storage = new MemStorage();
    storage.setItem(VISUAL_PREFS_KEY, serializeVisualPrefs(defaultVisualPrefs("alto", false)));
    const hardware = vi.fn(() => GOOD_HW);
    const qm = createQualityManager({
      storage,
      hardware,
      matchMedia: () => ({ matches: true }),
      onReducedMotionAttr: noop,
      onStorageWarning: noop,
    });
    expect(qm.get().preset).toBe("alto");
    expect(qm.get().reducedMotion).toBe(false);
    expect(hardware).not.toHaveBeenCalled();
  });

  it("setControl → personalizado; volver a coincidir → preset; selectPreset restablece", () => {
    const qm = createQualityManager({
      storage: new MemStorage(),
      hardware: GOOD_HW,
      matchMedia: null,
      onReducedMotionAttr: noop,
      onStorageWarning: noop,
    });
    const seen: string[] = [];
    const unsub = qm.subscribe((q) => seen.push(q.preset));

    qm.setControl("bloom", "alto");
    expect(qm.get().preset).toBe("personalizado");
    expect(qm.get().controls.bloom).toBe("alto");
    qm.setControl("bloom", PRESETS.medio.bloom);
    expect(qm.get().preset).toBe("medio");
    qm.setControl("renderScale", 50);
    qm.selectPreset("bajo");
    expect(qm.get().controls).toEqual(PRESETS.bajo);
    expect(seen).toEqual(["personalizado", "medio", "personalizado", "bajo"]);

    unsub();
    qm.selectPreset("alto");
    expect(seen).toHaveLength(4);
  });

  it("setReducedMotion notifica síncronamente y actualiza el atributo", () => {
    const attr = vi.fn();
    const qm = createQualityManager({
      storage: new MemStorage(),
      hardware: GOOD_HW,
      matchMedia: null,
      onReducedMotionAttr: attr,
      onStorageWarning: noop,
    });
    const cb = vi.fn();
    qm.subscribe(cb);
    qm.setReducedMotion(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].controls.cameraShake).toBe("desactivado");
    expect(attr).toHaveBeenLastCalledWith(true);
    expect(qm.getPreferences().controls.cameraShake).toBe("medio");
  });

  it("aviso no bloqueante una sola vez si falla el almacenamiento", () => {
    const storage = new MemStorage();
    storage.failWrites = true;
    const warn = vi.fn();
    const qm = createQualityManager({
      storage,
      hardware: GOOD_HW,
      matchMedia: null,
      onReducedMotionAttr: noop,
      onStorageWarning: warn,
    });
    qm.setControl("dof", "alto");
    qm.flush();
    qm.selectPreset("bajo");
    qm.flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(STORAGE_WARNING_TEXT);
    expect(qm.get().preset).toBe("bajo"); // sigue aplicando en memoria
  });

  it("sin almacenamiento: avisa una vez y funciona en memoria", () => {
    const warn = vi.fn();
    const qm = createQualityManager({
      storage: null,
      hardware: GOOD_HW,
      matchMedia: null,
      onReducedMotionAttr: noop,
      onStorageWarning: warn,
    });
    qm.setReducedMotion(true);
    qm.flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(qm.get().reducedMotion).toBe(true);
  });
});
