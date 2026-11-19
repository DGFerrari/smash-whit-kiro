// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { finish, hide, isTransitionActive, readDuration, setShownHook, show } from "./transitions.ts";

/** Minimal Web Animations stand-in: records calls, finishes on demand. */
class FakeAnimation {
  onfinish: (() => void) | null = null;
  oncancel: (() => void) | null = null;
  finished = false;
  cancelled = false;
  constructor(
    readonly keyframes: Keyframe[],
    readonly options: KeyframeAnimationOptions,
  ) {}
  finish(): void {
    this.finished = true;
    queueMicrotask(() => this.onfinish?.());
  }
  cancel(): void {
    this.cancelled = true;
  }
}

let created: FakeAnimation[] = [];
function installAnimate(): void {
  created = [];
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (
    kf: Keyframe[],
    opts: KeyframeAnimationOptions,
  ) {
    const a = new FakeAnimation(kf, opts);
    created.push(a);
    return a;
  };
}

afterEach(() => {
  finish();
  setShownHook(null);
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  document.documentElement.removeAttribute("data-reduced-motion");
  document.documentElement.style.cssText = "";
  document.body.innerHTML = "";
});

describe("transitions", () => {
  it("applies final state synchronously when Element.animate is unavailable", async () => {
    const onShown = vi.fn();
    const a = document.createElement("section");
    const p = show(a, { parent: document.body, onShown });
    expect(onShown).toHaveBeenCalledWith(a);
    expect(isTransitionActive()).toBe(false);
    await p;

    hide(a);
    expect(a.isConnected).toBe(false);
  });

  it("finishes the running transition before starting a new one (only target remains)", () => {
    installAnimate();
    const outgoing = document.createElement("section");
    const incoming = document.createElement("section");
    document.body.append(outgoing);

    void hide(outgoing);
    expect(isTransitionActive()).toBe(true);
    const onShown = vi.fn();
    void show(incoming, { parent: document.body, onShown });

    expect(created[0]!.finished).toBe(true);
    expect(outgoing.isConnected).toBe(false);
    expect(incoming.isConnected).toBe(true);
    expect(isTransitionActive()).toBe(true);
    expect(onShown).not.toHaveBeenCalled();

    finish();
    expect(onShown).toHaveBeenCalledWith(incoming);
    expect(isTransitionActive()).toBe(false);
  });

  it("uses --dur-screen-in for entry and --dur-screen-out for exit with motion keyframes", () => {
    installAnimate();
    const el = document.createElement("div");
    void show(el, { parent: document.body });
    void hide(el);
    // Sin tokens cargados (jsdom) usa los valores suaves por defecto.
    expect(created[0]!.options.duration).toBe(460);
    expect(created[1]!.options.duration).toBe(380);
    expect(created[0]!.keyframes.some((k) => typeof k.transform === "string" && k.transform !== "none")).toBe(true);
  });

  it("with reduced motion only fades opacity and notifies the shown hook", async () => {
    installAnimate();
    document.documentElement.setAttribute("data-reduced-motion", "");
    const hook = vi.fn();
    setShownHook(hook);
    const el = document.createElement("div");
    const p = show(el, { parent: document.body });
    for (const kf of created[0]!.keyframes) {
      expect(Object.keys(kf).filter((k) => k !== "offset")).toEqual(["opacity"]);
    }
    created[0]!.finish();
    await p;
    expect(hook).toHaveBeenCalledWith(el);
  });

  it("clamps duration tokens to 150–700 ms", () => {
    const root = document.documentElement.style;
    root.setProperty("--dur-x", "1s");
    expect(readDuration("--dur-x", 220)).toBe(700);
    root.setProperty("--dur-x", "50ms");
    expect(readDuration("--dur-x", 220)).toBe(150);
    root.setProperty("--dur-x", "0.3s");
    expect(readDuration("--dur-x", 220)).toBe(300);
    expect(readDuration("--missing", 220)).toBe(220);
  });
});
