/**
 * Cursor de MANO estilo cartoon (inspirado en la mano de Smash), dibujado a
 * mano en SVG (sin assets con copyright). Sigue al ratón y cambia de forma
 * según el estado:
 *   - pointer: mano relajada (puntero por defecto).
 *   - point:   dedo índice señalando (sobre un elemento interactivo).
 *   - press:   puño/clic (mientras se mantiene pulsado).
 *   - grab:    mano abierta agarrando (mientras se arrastra una ficha).
 *
 * Oculta el cursor nativo en todo el documento y dibuja este en su lugar.
 */
export type HandState = "pointer" | "point" | "press" | "grab";

/** SVGs de la mano por estado (24x24 viewBox, blanco con contorno negro). */
const HANDS: Record<HandState, string> = {
  // Puntero: mano cerrada con el pulgar, orientada arriba-izquierda.
  pointer: `<path d="M8 3 q1.5 -1 2.4 0.4 l0.6 5 l0.6 -1.2 q1.2 -1 2 0.4 l0.2 1 l0.6 -0.6 q1.2 -0.6 1.8 0.6 l0.2 1.2 l0.4 -0.2 q1 -0.2 1.2 0.9 l0.1 3 q0.2 3.6 -2.2 5.2 q-2.4 1.6 -5.2 0.6 q-1.6 -0.6 -3 -2.4 l-3 -4 q-0.9 -1.4 0.4 -2.3 q1.1 -0.7 2.1 0.3 l1.4 1.5 l-1.4 -8.3 q-0.3 -1.6 1.3 -2z"/>`,
  // Señalar: índice extendido hacia arriba.
  point: `<path d="M10 2 q1.4 0 1.5 1.6 l0.1 7 l0.7 -0.4 q1.1 -0.5 1.8 0.5 l0.2 1 l0.6 -0.4 q1.1 -0.4 1.6 0.7 l0.2 1 l0.4 -0.1 q1 0 1.1 1 l0.1 2.6 q0.1 3.4 -2.3 4.8 q-2.3 1.4 -5 0.5 q-1.5 -0.6 -2.7 -2.2 l-2 -3 q-0.8 -1.3 0.4 -2.1 q1 -0.6 1.9 0.3 l0.8 0.9 l0 -10.4 q0 -1.6 1.8 -1.6z"/>`,
  // Clic: puño compacto.
  press: `<path d="M7 9 q-1 -2 1 -2.6 q1 -0.3 1.8 0.5 l0.3 0.3 q0.2 -1.6 1.9 -1.4 q1.3 0.2 1.4 1.5 q0.6 -1.1 2 -0.7 q1.2 0.4 1.1 1.8 q1.2 -0.4 1.8 0.8 q0.4 0.9 0.2 2.2 l-0.3 2.4 q-0.4 3.2 -3 4.4 q-2.6 1.2 -5.2 0 q-1.6 -0.8 -2.6 -2.8 z"/>`,
  // Agarrar: mano abierta con dedos separados.
  grab: `<path d="M6 12 l-0.6 -3 q-0.2 -1.4 1.1 -1.6 q1 -0.1 1.3 1 l0.5 2 l-0.4 -4.4 q-0.1 -1.5 1.3 -1.6 q1.2 -0.1 1.4 1.3 l0.4 4 l0.1 -4.8 q0 -1.5 1.4 -1.5 q1.3 0 1.4 1.5 l0.1 4.8 l0.5 -3.8 q0.2 -1.4 1.5 -1.2 q1.2 0.2 1.1 1.6 l-0.4 5.4 q-0.3 3.6 -3 5 q-2.6 1.4 -5.4 0.2 q-1.7 -0.8 -2.6 -2.8 z"/>`,
};

export class HandCursor {
  private readonly root: HTMLDivElement;
  private state: HandState = "pointer";
  private x = -100;
  private y = -100;
  private down = false;
  private grabbing = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "hand-cursor";
    this.render();
    document.body.appendChild(this.root);

    document.body.classList.add("hide-native-cursor");

    window.addEventListener("mousemove", this.onMove, { passive: true });
    window.addEventListener("mousedown", this.onDown, true);
    window.addEventListener("mouseup", this.onUp, true);
    window.addEventListener("mouseover", this.onOver, true);
  }

  /** Marca si estamos agarrando una ficha (lo controla la pantalla de select). */
  setGrabbing(grabbing: boolean): void {
    this.grabbing = grabbing;
    this.refresh();
  }

  private onMove = (e: MouseEvent): void => {
    this.x = e.clientX;
    this.y = e.clientY;
    this.root.style.transform = `translate(${this.x}px, ${this.y}px)`;
  };

  private onDown = (): void => {
    this.down = true;
    this.refresh();
  };

  private onUp = (): void => {
    this.down = false;
    this.refresh();
  };

  private onOver = (e: MouseEvent): void => {
    // ¿El elemento bajo el ratón es interactivo? -> estado "señalar".
    const el = e.target as HTMLElement | null;
    this.overInteractive = !!el?.closest(
      "button, .portrait, .stage-cell, input, label, .mode-row, .replay-btn, .token-chip",
    );
    this.refresh();
  };
  private overInteractive = false;

  /** Decide el estado según prioridad: grab > press > point > pointer. */
  private refresh(): void {
    let next: HandState = "pointer";
    if (this.grabbing) next = "grab";
    else if (this.down) next = "press";
    else if (this.overInteractive) next = "point";
    if (next !== this.state) {
      this.state = next;
      this.render();
    }
  }

  private render(): void {
    this.root.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24">
      <g fill="#ffffff" stroke="#111" stroke-width="1.1" stroke-linejoin="round">
        ${HANDS[this.state]}
      </g>
    </svg>`;
    this.root.style.transform = `translate(${this.x}px, ${this.y}px)`;
  }
}
