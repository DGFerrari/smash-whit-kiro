/**
 * Transición entre menús: un BLOQUE inclinado del color del menú elegido
 * barre la pantalla de izquierda a derecha (de derecha a izquierda al volver),
 * con el icono y el nombre del destino en el centro.
 *
 *  - `cover(theme, dir)`: el bloque entra hasta tapar la pantalla.
 *  - `reveal()`: sigue su camino y destapa la pantalla nueva.
 *
 * Usa Web Animations (sin coste de layout: solo `transform`/`opacity`). Con
 * Movimiento_Reducido es un fundido. Sin `Element.animate` (jsdom) resuelve al
 * instante.
 */
import "./menuSweep.css";

export type SweepIcon =
  | "swords"
  | "map"
  | "globe"
  | "users"
  | "play"
  | "trophy"
  | "gift"
  | "cap"
  | "target"
  | "home"
  | "bag";

export interface SweepTheme {
  /** Color CSS del bloque (acepta `var(--color-…)`). */
  color: string;
  icon: SweepIcon;
  label: string;
}

export type SweepDir = "forward" | "back";

/** Temas de cada destino (mismos acentos que los modos del menú principal). */
export const SWEEP: Record<
  "versus" | "stage" | "online" | "lobby" | "replays" | "ranking" | "gacha" | "inventory" | "tutorial" | "menu",
  SweepTheme
> = {
  versus: { color: "var(--color-secondary)", icon: "swords", label: "Batalla" },
  stage: { color: "var(--color-secondary)", icon: "map", label: "Escenario" },
  online: { color: "var(--color-primary)", icon: "globe", label: "Multiplayer" },
  lobby: { color: "var(--color-primary)", icon: "users", label: "Sala" },
  replays: { color: "var(--color-focus)", icon: "play", label: "Repeticiones" },
  ranking: { color: "var(--color-primary)", icon: "trophy", label: "Clasificación" },
  gacha: { color: "var(--color-danger)", icon: "gift", label: "Gacha" },
  inventory: { color: "var(--color-success)", icon: "bag", label: "Inventario" },
  tutorial: { color: "var(--color-secondary)", icon: "cap", label: "Tutorial" },
  menu: { color: "var(--color-primary)", icon: "home", label: "Menú principal" },
};

/**
 * Vuelta al menú principal desde una sección: conserva el color de la sección
 * que se deja, pero muestra la casa y "Menú principal".
 */
export function toMenuTheme(from: SweepTheme = SWEEP.menu): SweepTheme {
  return { color: from.color, icon: SWEEP.menu.icon, label: SWEEP.menu.label };
}

/** Trazos SVG (viewBox 24×24, línea) de cada icono. */
const ICON_PATHS: Record<SweepIcon, string> = {
  swords: "M4 4l10 10M20 4L10 14M6 15l3 3M18 15l-3 3M4 20l3-3M20 20l-3-3",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  globe: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c-4 4-4 14 0 18M12 3c4 4 4 14 0 18",
  users: "M9 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM2.5 20c0-4.5 13-4.5 13 0M17 6.5a2.5 2.5 0 1 1 0 5M17.5 14c2.5.3 4 1.8 4 5",
  play: "M8 5l11 7-11 7z",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6",
  gift: "M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-2-5-6-4-4 0M12 9c2-5 6-4 4 0",
  cap: "M2 9l10-5 10 5-10 5zM6 11v5c3 3 9 3 12 0v-5M22 9v5",
  target: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10zM12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z",
  home: "M3 11l9-8 9 8M5 9.5V21h14V9.5M10 21v-6h4v6",
  bag: "M5 9h14l-1.2 11.5a1.5 1.5 0 0 1-1.5 1.5H7.7a1.5 1.5 0 0 1-1.5-1.5zM9 9V7a3 3 0 0 1 6 0v2M9 14h6",
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Curva muy suave (ease-in-out quart) para entrada y salida. */
const EASE = "cubic-bezier(0.76, 0, 0.24, 1)";
export const SWEEP_COVER_MS = 420;
export const SWEEP_REVEAL_MS = 460;

export function sweepIcon(icon: SweepIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "kb-sweep__icon");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICON_PATHS[icon]);
  svg.appendChild(path);
  return svg;
}

export class MenuSweep {
  private readonly root: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly band: HTMLDivElement;
  private readonly badge: HTMLDivElement;
  private readonly iconSlot: HTMLDivElement;
  private readonly labelEl: HTMLSpanElement;
  private running: Animation[] = [];

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "kb-sweep";
    this.root.setAttribute("aria-hidden", "true");
    this.track = document.createElement("div");
    this.track.className = "kb-sweep__track";
    this.band = document.createElement("div");
    this.band.className = "kb-sweep__band";
    this.track.appendChild(this.band);
    this.badge = document.createElement("div");
    this.badge.className = "kb-sweep__badge";
    this.iconSlot = document.createElement("div");
    this.iconSlot.className = "kb-sweep__icon-wrap";
    this.labelEl = document.createElement("span");
    this.labelEl.className = "kb-sweep__label";
    this.badge.append(this.iconSlot, this.labelEl);
    this.root.append(this.track, this.badge);
    document.body.appendChild(this.root);
  }

  private get reduced(): boolean {
    return document.documentElement.hasAttribute("data-reduced-motion");
  }

  private stopAll(): void {
    for (const a of this.running) {
      try {
        a.cancel();
      } catch {
        /* ignore */
      }
    }
    this.running = [];
  }

  private play(el: HTMLElement, frames: Keyframe[], duration: number, delay = 0): Promise<void> {
    if (typeof el.animate !== "function") return Promise.resolve();
    const a = el.animate(frames, { duration, delay, easing: EASE, fill: "forwards" });
    this.running.push(a);
    return new Promise((resolve) => {
      a.onfinish = () => resolve();
      a.oncancel = () => resolve();
    });
  }

  /** El bloque entra y tapa la pantalla. */
  async cover(theme: SweepTheme, dir: SweepDir = "forward"): Promise<void> {
    this.stopAll();
    this.root.style.setProperty("--sweep-color", theme.color);
    this.root.classList.toggle("is-back", dir === "back");
    this.iconSlot.replaceChildren(sweepIcon(theme.icon));
    this.labelEl.textContent = theme.label;
    this.root.classList.add("open");
    if (this.reduced) {
      await Promise.all([
        this.play(this.band, [{ opacity: 0, transform: "none" }, { opacity: 1, transform: "none" }], 260),
        this.play(this.badge, [{ opacity: 0 }, { opacity: 1 }], 260),
      ]);
      return;
    }
    await Promise.all([
      this.play(this.band, [{ transform: "translateX(-118%)" }, { transform: "translateX(0)" }], SWEEP_COVER_MS),
      this.play(
        this.badge,
        [
          { opacity: 0, transform: "translate(-50%, -50%) scale(0.6) rotate(-8deg)" },
          { opacity: 1, transform: "translate(-50%, -50%) scale(1) rotate(0deg)" },
        ],
        SWEEP_COVER_MS * 0.7,
        SWEEP_COVER_MS * 0.35,
      ),
    ]);
  }

  /** El bloque sigue su camino y destapa la pantalla nueva. */
  async reveal(): Promise<void> {
    if (this.reduced) {
      await Promise.all([
        this.play(this.band, [{ opacity: 1 }, { opacity: 0 }], 300),
        this.play(this.badge, [{ opacity: 1 }, { opacity: 0 }], 300),
      ]);
    } else {
      await Promise.all([
        this.play(this.band, [{ transform: "translateX(0)" }, { transform: "translateX(118%)" }], SWEEP_REVEAL_MS, 60),
        this.play(
          this.badge,
          [
            { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
            { opacity: 0, transform: "translate(-50%, -50%) scale(1.25)" },
          ],
          SWEEP_REVEAL_MS * 0.55,
        ),
      ]);
    }
    this.stopAll();
    this.root.classList.remove("open");
  }
}
