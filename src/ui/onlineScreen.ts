import { OnlineNetwork } from "../net/peer.ts";

/**
 * Pantalla de entrada al ONLINE: crear una sala (serás anfitrión) o unirse con
 * un código. Al establecer la conexión, entrega la red al lobby.
 *
 *  - HOST: entra al lobby en cuanto crea la sala (ya puede esperar a otros ahí).
 *  - GUEST: entra al lobby cuando su canal P2P con el host queda abierto.
 */
export interface OnlineScreenCallbacks {
  onBack: () => void;
  /** La red está lista: entrega el OnlineNetwork y el código de sala. */
  onReady: (net: OnlineNetwork, roomCode: string) => void;
}

export class OnlineScreen {
  private readonly root: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly formEl: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private net: OnlineNetwork | null = null;
  private entered = false;
  /** Código de la sala (lo da el host al crear; el guest lo escribe). */
  private roomCode = "";

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
      "Crea una sala y pásale el código a tus amigos (hasta 4), o únete con el código que te den.";
    this.root.appendChild(hint);

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
    this.entered = false;
    this.roomCode = "";
    this.formEl.style.display = "";
    this.setStatus("");
    this.input.value = "";
  }

  private teardown(): void {
    // Solo cerramos la red si NO hemos entrado al lobby (si entramos, el lobby
    // se hace cargo de ella).
    if (!this.entered) this.net?.close();
    this.net = null;
  }

  private host(): void {
    this.startNet();
    this.formEl.style.display = "none";
    this.setStatus("Creando sala…");
    this.net!.host();
  }

  private join(): void {
    const code = this.input.value.trim().toUpperCase();
    if (code.length < 4) {
      this.setStatus("Introduce un código válido.");
      return;
    }
    this.roomCode = code;
    this.startNet();
    this.formEl.style.display = "none";
    this.setStatus("Uniéndote a la sala…");
    this.net!.join(code);
  }

  private startNet(): void {
    this.net = new OnlineNetwork({
      onRoomCode: (code) => {
        // Host: ya puede entrar al lobby (esperará a otros allí).
        this.roomCode = code;
        this.setStatus(`Sala creada: ${code}`);
        this.enterLobby();
      },
      onPeerConnected: () => {
        // Guest: su canal con el host está listo → al lobby.
        if (this.net && this.net.mySlot !== 0) this.enterLobby();
      },
      onPeerLeft: (slot) => {
        if (slot === 0 && !this.entered) {
          this.setStatus("El anfitrión cerró la sala.");
          this.formEl.style.display = "";
        }
      },
      onError: (reason) => {
        const msg =
          reason === "not-found"
            ? "No existe ninguna sala con ese código."
            : reason === "full"
              ? "Esa sala ya está llena."
              : `No se pudo conectar (${reason}).`;
        this.setStatus(msg);
        this.formEl.style.display = "";
      },
    });
  }

  private enterLobby(): void {
    if (this.entered || !this.net) return;
    this.entered = true;
    this.cb.onReady(this.net, this.roomCode);
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }
}
