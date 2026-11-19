import { button } from "./design/components.ts";
import "./pauseMenu.css";

/**
 * Menú de pausa para partidas ONLINE. A diferencia del de un jugador, NO
 * congela el juego: en online el lockstep sigue corriendo para todos, así que
 * este overlay es solo un menú superpuesto (puedes seguir recibiendo golpes
 * mientras está abierto). Se abre/cierra con Escape y ofrece reanudar (cerrar)
 * y un botón específico para SALIR de la partida online.
 *
 * Usa el mismo estilo de diálogo que la pausa local (`pauseMenu.css`).
 */
export interface OnlinePauseCallbacks {
  /** Salir de la partida online y volver al menú (cierra la sala/conexión). */
  onQuit: () => void;
  /** ¿Se puede abrir ahora? (p.ej. no durante la cuenta atrás). Por defecto sí. */
  canOpen?: () => boolean;
}

export class OnlinePauseMenu {
  private readonly root: HTMLDivElement;
  private open = false;
  private active = false;

  constructor(private readonly cb: OnlinePauseCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "online-pause";
    this.root.className = "online-pause";

    const scrim = document.createElement("div");
    scrim.className = "online-pause-scrim kb-pause__scrim";
    this.root.appendChild(scrim);

    const panel = document.createElement("div");
    panel.className = "kb-pause-online__dialog";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");

    const title = document.createElement("h2");
    title.className = "kb-pause-online__title";
    title.id = "kb-online-pause-title";
    title.textContent = "Pausa";
    panel.setAttribute("aria-labelledby", title.id);
    panel.appendChild(title);

    const note = document.createElement("p");
    note.className = "kb-pause-online__note";
    note.textContent =
      "En online el juego NO se detiene: sigues en la partida mientras este menú está abierto.";
    panel.appendChild(note);

    panel.appendChild(
      button({
        label: "Continuar",
        variant: "primary",
        onActivate: () => this.setOpen(false),
      }),
    );

    panel.appendChild(
      button({
        label: "Salir de la partida online",
        variant: "danger",
        onActivate: () => {
          this.setOpen(false);
          this.cb.onQuit();
        },
      }),
    );

    this.root.appendChild(panel);
    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKey);
  }

  /** Activa/desactiva el menú (p.ej. mientras dura la partida online). */
  setActive(value: boolean): void {
    this.active = value;
    if (!value) this.setOpen(false);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Quita el overlay del DOM y desengancha el listener. */
  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.active || e.key !== "Escape") return;
    e.preventDefault();
    if (this.open) {
      this.setOpen(false);
    } else {
      if (this.cb.canOpen && !this.cb.canOpen()) return;
      this.setOpen(true);
    }
  };

  private setOpen(value: boolean): void {
    if (value === this.open) return;
    this.open = value;
    // Sin mover el foco: el juego sigue y las teclas deben llegar a la partida.
    this.root.classList.toggle("open", this.open);
  }
}
