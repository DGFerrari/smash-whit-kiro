import type { GameMode } from "../game/world.ts";

/**
 * Menú principal del juego. Pantalla inicial donde se elige el modo de juego:
 *  - Entrenamiento: un jugador + un dummy de pruebas.
 *  - Versus local: dos jugadores humanos en el mismo teclado.
 *
 * Es un overlay DOM a pantalla completa. Al elegir un modo, llama a onPlay con
 * el modo elegido; la capa de app (main.ts) se encarga de arrancar la partida.
 */
export interface MainMenuCallbacks {
  onPlay: (mode: GameMode) => void;
}

export class MainMenu {
  private readonly root: HTMLDivElement;

  constructor(private readonly cb: MainMenuCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "main-menu";

    const panel = document.createElement("div");
    panel.className = "menu-panel";

    const title = document.createElement("h1");
    title.className = "menu-title";
    title.textContent = "smash-B";
    panel.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "menu-subtitle";
    subtitle.textContent = "Platform fighter 2D";
    panel.appendChild(subtitle);

    panel.appendChild(
      this.menuButton("Entrenamiento", "Pega a un dummy para practicar.", () =>
        this.cb.onPlay("training"),
      ),
    );
    panel.appendChild(
      this.menuButton(
        "Versus local",
        "Dos jugadores en el mismo teclado. Gana el último con vidas.",
        () => this.cb.onPlay("versus"),
      ),
    );

    this.root.appendChild(panel);
    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add("open");
  }

  hide(): void {
    this.root.classList.remove("open");
  }

  private menuButton(
    label: string,
    hint: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-btn";

    const name = document.createElement("span");
    name.className = "menu-btn-label";
    name.textContent = label;
    btn.appendChild(name);

    const sub = document.createElement("span");
    sub.className = "menu-btn-hint";
    sub.textContent = hint;
    btn.appendChild(sub);

    btn.addEventListener("click", onClick);
    return btn;
  }
}

/**
 * Pantalla de fin de partida (versus). Muestra quién ganó y permite revancha
 * o volver al menú principal.
 */
export interface MatchOverCallbacks {
  onRematch: () => void;
  onMenu: () => void;
}

export class MatchOverScreen {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;

  constructor(private readonly cb: MatchOverCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "match-over";

    const panel = document.createElement("div");
    panel.className = "menu-panel";

    this.titleEl = document.createElement("h1");
    this.titleEl.className = "menu-title";
    panel.appendChild(this.titleEl);

    const rematch = document.createElement("button");
    rematch.type = "button";
    rematch.className = "menu-btn";
    rematch.textContent = "Revancha";
    rematch.addEventListener("click", () => this.cb.onRematch());
    panel.appendChild(rematch);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "menu-btn";
    menu.textContent = "Menú principal";
    menu.addEventListener("click", () => this.cb.onMenu());
    panel.appendChild(menu);

    this.root.appendChild(panel);
    document.body.appendChild(this.root);
  }

  show(winnerLabel: string, winnerColor: string): void {
    this.titleEl.textContent = `¡Gana ${winnerLabel}!`;
    this.titleEl.style.color = winnerColor;
    this.root.classList.add("open");
  }

  hide(): void {
    this.root.classList.remove("open");
  }
}
