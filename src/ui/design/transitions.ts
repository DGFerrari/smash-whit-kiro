/**
 * Screen enter/exit transitions (R2.8, R2.9, R9.8).
 *
 * - Exactly one transition is active at a time. Starting a new one first
 *   calls `finish()` on the previous: its animations are finished, its final
 *   state is applied and an outgoing screen is removed from the DOM, so only
 *   the target screen remains visible.
 * - Entry lasts `--dur-base`, exit `--dur-fast` (both 150–400 ms, clamped).
 * - With reduced motion (`data-reduced-motion` on <html>, set by the quality
 *   manager) slide/scale/skew are replaced by a pure opacity fade.
 * - When an entry completes, the `onShown` hook runs so the menu navigator can
 *   focus the first enabled control (R4.9). The hook is injectable to keep this
 *   module free of a dependency on the navigator.
 * - When `Element.animate` is unavailable (e.g. jsdom) the final state is
 *   applied synchronously.
 */

export type ShownHook = (el: HTMLElement) => void;

export interface ShowOptions {
  /** Container to append `next` to if it is not already attached. */
  parent?: Element;
  /** Called once the screen is fully shown; overrides the global hook. */
  onShown?: ShownHook;
}

export interface HideOptions {
  /** Called once the screen has been removed from the DOM. */
  onHidden?: (el: HTMLElement) => void;
}

const MIN_MS = 150;
const MAX_MS = 700;
const FALLBACK_IN_MS = 460;
const FALLBACK_OUT_MS = 380;
const FALLBACK_EASE = "cubic-bezier(0.45, 0, 0.2, 1)";

interface ActiveTransition {
  animations: Animation[];
  finalize: () => void;
}

let active: ActiveTransition | null = null;
let globalShownHook: ShownHook | null = null;

/** Registers the default hook run after every completed entry (e.g. navigator focus). */
export function setShownHook(hook: ShownHook | null): void {
  globalShownHook = hook;
}

/** True while an enter or exit transition is running. */
export function isTransitionActive(): boolean {
  return active !== null;
}

/** Ends the current transition immediately in its final state (R2.9). */
export function finish(): void {
  const current = active;
  if (!current) return;
  active = null;
  for (const anim of current.animations) {
    try {
      anim.finish();
      // Drop the forwards fill so the element falls back to its own styles.
      anim.cancel();
    } catch {
      // Infinite or detached animations can throw; final state is applied below.
    }
  }
  current.finalize();
}

/** Plays the entry transition for `next`, attaching it to `parent` if given. */
export function show(next: HTMLElement, opts: ShowOptions = {}): Promise<void> {
  finish();
  if (opts.parent && next.parentNode !== opts.parent) opts.parent.appendChild(next);
  const hook = opts.onShown ?? globalShownHook;

  const reduced = isReducedMotion();
  const keyframes: Keyframe[] = reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        // Entrada muy suave: fundido con un leve acercamiento, sin rebote.
        { opacity: 0, transform: "translateY(10px) scale(0.985)" },
        { opacity: 1, transform: "none" },
      ];

  return run(next, keyframes, readDuration("--dur-screen-in", FALLBACK_IN_MS), () => {
    next.style.removeProperty("opacity");
    next.style.removeProperty("transform");
    hook?.(next);
  });
}

/** Plays the exit transition for `current` and removes it from the DOM. */
export function hide(current: HTMLElement, opts: HideOptions = {}): Promise<void> {
  finish();
  const reduced = isReducedMotion();
  const keyframes: Keyframe[] = reduced
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "scale(1.012)" },
      ];

  return run(current, keyframes, readDuration("--dur-screen-out", FALLBACK_OUT_MS), () => {
    current.remove();
    current.style.removeProperty("opacity");
    current.style.removeProperty("transform");
    opts.onHidden?.(current);
  });
}

function run(
  el: HTMLElement,
  keyframes: Keyframe[],
  duration: number,
  onDone: () => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finalize = (): void => {
      if (done) return;
      done = true;
      if (active === entry) active = null;
      onDone();
      resolve();
    };
    const entry: ActiveTransition = { animations: [], finalize };

    if (typeof el.animate !== "function" || !el.isConnected) {
      finalize();
      return;
    }

    let anim: Animation;
    try {
      anim = el.animate(keyframes, {
        duration,
        easing: readToken("--ease-smooth") || FALLBACK_EASE,
        fill: "forwards",
      });
    } catch {
      finalize();
      return;
    }
    entry.animations.push(anim);
    active = entry;

    const settle = (): void => {
      // Drop the forwards fill so the screen falls back to its own styles.
      if (done) return;
      try {
        anim.cancel();
      } catch {
        /* ignore */
      }
      finalize();
    };
    anim.onfinish = settle;
    anim.oncancel = () => finalize();
  });
}

function isReducedMotion(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-reduced-motion");
}

function readToken(name: string): string {
  if (typeof getComputedStyle !== "function") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Reads a duration token (`220ms` / `0.22s`) and clamps it to 150–700 ms. */
export function readDuration(name: string, fallback: number): number {
  const raw = readToken(name);
  const m = /^(-?[\d.]+)\s*(ms|s)?$/i.exec(raw);
  let ms = fallback;
  if (m) {
    const n = Number.parseFloat(m[1]!);
    if (Number.isFinite(n)) ms = m[2]?.toLowerCase() === "s" ? n * 1000 : n;
  }
  return Math.min(MAX_MS, Math.max(MIN_MS, ms));
}
