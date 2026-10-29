/**
 * Overlays de presentación en DOM, por encima del canvas:
 *  - LoadingScreen: transición dinámica entre menú y partida.
 *  - Countdown: el 3·2·1·GO! de la intro.
 *  - KOFlash: destello blanco del KO dramático.
 *
 * Son ligeros y desacoplados: el loop/app los enciende y apaga.
 */

/**
 * Pantalla de carga estilo "iris" (Looney Tunes): un velo oscuro cubre la
 * pantalla y, abajo a la derecha, un CÍRCULO se va llenando de abajo a arriba
 * indicando el progreso de carga. Al llegar al 100% el iris se cierra/abre y
 * resuelve la promesa.
 */
export class LoadingScreen {
  private readonly root: HTMLDivElement;
  /** Relleno que sube dentro del círculo (altura 0%..100%). */
  private readonly fill: HTMLDivElement;
  private raf = 0;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "loading-screen";

    // Círculo abajo a la derecha (el "iris").
    const circle = document.createElement("div");
    circle.className = "loading-iris";

    this.fill = document.createElement("div");
    this.fill.className = "loading-iris-fill";
    circle.appendChild(this.fill);

    const ring = document.createElement("div");
    ring.className = "loading-iris-ring";
    circle.appendChild(ring);

    const label = document.createElement("div");
    label.className = "loading-iris-label";
    label.textContent = "That's all folks… cargando";
    circle.appendChild(label);

    this.root.appendChild(circle);
    document.body.appendChild(this.root);
  }

  /**
   * Muestra la pantalla de carga durante `duration` ms; el círculo se llena de
   * abajo a arriba y la promesa resuelve al terminar.
   */
  show(duration = 900): Promise<void> {
    this.root.classList.add("open");
    this.fill.style.height = "0%";
    const start = performance.now();
    cancelAnimationFrame(this.raf);

    return new Promise<void>((resolve) => {
      const tick = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        // Curva con un pequeño "tirón" al final para que se sienta dinámica.
        const eased = t < 0.9 ? t * 0.85 : 0.765 + (t - 0.9) * 2.35;
        this.fill.style.height = `${Math.min(100, eased * 100)}%`;
        if (t < 1) {
          this.raf = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  hide(): void {
    this.root.classList.remove("open");
  }
}

/** Texto grande centrado para la cuenta atrás de la intro. */
export class Countdown {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private last: string | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "countdown";
    this.text = document.createElement("div");
    this.text.className = "countdown-text";
    this.root.appendChild(this.text);
    document.body.appendChild(this.root);
  }

  /** Muestra el texto (o lo oculta con null). Reinicia la animación al cambiar. */
  set(value: string | null): void {
    if (value === this.last) return;
    this.last = value;
    if (value === null) {
      this.root.classList.remove("open");
      return;
    }
    this.text.textContent = value;
    this.text.classList.toggle("go", value === "GO!");
    this.root.classList.add("open");
    // Reinicia la animación de "pop".
    this.text.classList.remove("pop");
    void this.text.offsetWidth;
    this.text.classList.add("pop");
  }

  destroy(): void {
    this.root.remove();
  }
}

/** Destello blanco a pantalla completa para el KO dramático. */
export class KOFlash {
  private readonly root: HTMLDivElement;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "ko-flash";
    document.body.appendChild(this.root);
  }

  /** Intensidad [0..1]. 0 lo apaga. */
  set(intensity: number): void {
    this.root.style.opacity = String(Math.min(1, Math.max(0, intensity)) * 0.85);
  }

  destroy(): void {
    this.root.remove();
  }
}
