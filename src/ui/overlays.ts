/**
 * Overlays de presentación en DOM, por encima del canvas:
 *  - LoadingScreen: transición dinámica entre menú y partida.
 *  - Countdown: el 3·2·1·GO! de la intro.
 *  - KOFlash: destello blanco del KO dramático.
 *
 * Son ligeros y desacoplados: el loop/app los enciende y apaga.
 */

/**
 * Transición de carga estilo IRIS (barrido circular de dibujos animados).
 *
 * Es un velo negro a pantalla completa con un AGUJERO circular transparente en
 * el centro, cuyo radio animamos:
 *  - cover(): el agujero se cierra (radio grande -> 0), tapando la pantalla de
 *    FUERA hacia DENTRO. Se usa para ocultar la escena actual.
 *  - reveal(): el agujero se abre (radio 0 -> grande), destapando la nueva
 *    escena de DENTRO hacia FUERA.
 *
 * El radio se aplica con un radial-gradient (transparente dentro, negro fuera),
 * animado por requestAnimationFrame para un control fino del easing.
 */
export class LoadingScreen {
  private readonly root: HTMLDivElement;
  /** Anillo de progreso visible mientras la pantalla está tapada. */
  private readonly ring: SVGCircleElement;
  private readonly ringCircumference: number;
  private raf = 0;
  /** Radio que cubre de sobra la pantalla (diagonal). */
  private get maxRadius(): number {
    return Math.hypot(window.innerWidth, window.innerHeight) / 2 + 40;
  }

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "loading-screen";
    this.setRadius(this.maxRadius); // empieza totalmente abierto (invisible)

    // Anillo de progreso circular (SVG) centrado. Visible solo durante fill().
    const R = 34;
    this.ringCircumference = 2 * Math.PI * R;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "loading-ring");
    svg.setAttribute("viewBox", "0 0 80 80");
    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("class", "loading-ring-track");
    track.setAttribute("cx", "40");
    track.setAttribute("cy", "40");
    track.setAttribute("r", String(R));
    this.ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    this.ring.setAttribute("class", "loading-ring-fill");
    this.ring.setAttribute("cx", "40");
    this.ring.setAttribute("cy", "40");
    this.ring.setAttribute("r", String(R));
    this.ring.style.strokeDasharray = String(this.ringCircumference);
    this.setRingProgress(0);
    svg.appendChild(track);
    svg.appendChild(this.ring);
    this.root.appendChild(svg);

    document.body.appendChild(this.root);
  }

  private setRingProgress(p: number): void {
    // offset = circunferencia * (1 - progreso): a 0 el anillo está vacío.
    const clamped = Math.max(0, Math.min(1, p));
    this.ring.style.strokeDashoffset = String(
      this.ringCircumference * (1 - clamped),
    );
  }

  /**
   * Con la pantalla tapada (tras cover), llena el anillo de progreso de 0 a 1
   * en `duration` ms. Representa visualmente la carga antes de revelar.
   */
  fill(duration = 500): Promise<void> {
    this.root.classList.add("filling");
    this.setRingProgress(0);
    cancelAnimationFrame(this.raf);
    const start = performance.now();
    return new Promise<void>((resolve) => {
      const tick = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        this.setRingProgress(t);
        if (t < 1) {
          this.raf = requestAnimationFrame(tick);
        } else {
          this.root.classList.remove("filling");
          resolve();
        }
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  /** Aplica el radio del agujero transparente centrado. */
  private setRadius(r: number): void {
    const px = Math.max(0, r);
    // Dentro del radio: transparente; justo fuera: negro. El pequeño solape
    // (px+1) evita un borde dentado.
    this.root.style.background = `radial-gradient(circle at 50% 50%, rgba(7,10,18,0) ${px}px, rgba(7,10,18,1) ${px + 1}px)`;
  }

  /** Cierra el iris (tapa la pantalla). Promesa al terminar. */
  cover(duration = 450): Promise<void> {
    this.root.classList.add("open");
    return this.animate(this.maxRadius, 0, duration);
  }

  /** Abre el iris (destapa la pantalla) y oculta el overlay al acabar. */
  reveal(duration = 550): Promise<void> {
    this.root.classList.add("open");
    return this.animate(0, this.maxRadius, duration).then(() => {
      this.root.classList.remove("open");
    });
  }

  private animate(from: number, to: number, duration: number): Promise<void> {
    cancelAnimationFrame(this.raf);
    const start = performance.now();
    return new Promise<void>((resolve) => {
      const tick = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        const eased = easeInOut(t);
        this.setRadius(from + (to - from) * eased);
        if (t < 1) {
          this.raf = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      this.raf = requestAnimationFrame(tick);
    });
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
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
