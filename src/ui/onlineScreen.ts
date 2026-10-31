import { PeerConnection } from "../net/peer.ts";

/**
 * Pantalla de ONLINE (crear/unirse a una sala y establecer el P2P). De momento
 * valida la conexión P2P: cuando el canal está abierto, muestra "conectado" y
 * hace un intercambio de prueba. La partida en lockstep se engancha en el
 * siguiente paso (de ahí el callback onReady con el PeerConnection y el rol).
 */
export interface OnlineScreenCallbacks {
  onBack: () => void;
  /** El P2P está listo: entrega el peer y el rol para arrancar la partida. */
  onReady?: (peer: PeerConnection, role: "host" | "guest") => void;
}

export class OnlineScreen {
  private readonly root: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly codeEl: HTMLDivElement;
  private readonly formEl: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private peer: PeerConnection | null = null;

  constructor(private readonly cb: OnlineScreenCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "online-screen";
    this.root.className = "select-screen";

    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Jugar online";
    this.root.appendChild(title);

    const hint = document.createElement("p");
    hint.className = "select-hint";
    hint.textContent =
      "Crea una sala y pásale el código a un amigo, o únete con el código que te den.";
    this.root.appendChild(hint);

    // Formulario: crear sala / unirse por código.
    this.formEl = document.createElement("div");
    this.formEl.className = "online-form";

    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "menu-btn online-create";
    createBtn.textContent = "Crear sala";
    createBtn.addEventListener("click", () => this.host());
    this.formEl.appendChild(createBtn);

    const joinRow = document.createElement("div");
    joinRow.className = "online-join-row";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "online-code-input";
    this.input.placeholder = "CÓDIGO";
    this.input.maxLength = 5;
    this.input.addEventListener("input", () => {
      this.input.value = this.input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "menu-btn online-join";
    joinBtn.textContent = "Unirse";
    joinBtn.addEventListener("click", () => this.join());
    joinRow.appendChild(this.input);
    joinRow.appendChild(joinBtn);
    this.formEl.appendChild(joinRow);

    this.root.appendChild(this.formEl);

    // Código de la sala creada (para compartir).
    this.codeEl = document.createElement("div");
    this.codeEl.className = "online-code";
    this.root.appendChild(this.codeEl);

    // Estado de la conexión.
    this.statusEl = document.createElement("div");
    this.statusEl.className = "online-status";
    this.root.appendChild(this.statusEl);

    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = document.createElement("button");
    back.className = "menu-btn select-back";
    back.textContent = "‹ Atrás";
    back.addEventListener("click", () => {
      this.teardown();
      this.cb.onBack();
    });
    actions.appendChild(back);
    this.root.appendChild(actions);

    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add("open");
    this.reset();
  }

  hide(): void {
    this.root.classList.remove("open");
  }

  private reset(): void {
    this.teardown();
    this.formEl.style.display = "";
    this.codeEl.textContent = "";
    this.codeEl.style.display = "none";
    this.setStatus("");
    this.input.value = "";
  }

  private teardown(): void {
    this.peer?.close();
    this.peer = null;
  }

  private host(): void {
    this.startPeer();
    this.formEl.style.display = "none";
    this.setStatus("Creando sala…");
    this.peer!.host();
  }

  private join(): void {
    const code = this.input.value.trim().toUpperCase();
    if (code.length < 4) {
      this.setStatus("Introduce un código válido.");
      return;
    }
    this.startPeer();
    this.formEl.style.display = "none";
    this.setStatus("Uniéndote a la sala…");
    this.peer!.join(code);
  }

  private startPeer(): void {
    this.peer = new PeerConnection({
      onRoomCode: (code) => {
        this.codeEl.style.display = "block";
        this.codeEl.innerHTML = `Código de la sala:<br><strong>${code}</strong>`;
        this.setStatus("Esperando a que se una tu amigo…");
      },
      onConnected: (role) => {
        this.setStatus("¡Conectado! P2P establecido ✓");
        // En el siguiente paso aquí se lanzará la partida en lockstep.
        this.cb.onReady?.(this.peer!, role);
      },
      onClosed: (reason) => this.setStatus(`Conexión cerrada (${reason}).`),
      onError: (reason) => {
        const msg =
          reason === "not-found"
            ? "No existe ninguna sala con ese código."
            : reason === "full"
              ? "Esa sala ya está llena."
              : `No se pudo conectar (${reason}).`;
        this.setStatus(msg);
        this.formEl.style.display = "";
        this.codeEl.style.display = "none";
      },
    });
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }
}
