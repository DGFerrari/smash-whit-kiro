import { OnlineNetwork } from "../net/peer.ts";
import { button } from "./design/components.ts";
import { screenNav } from "./nav/screenNav.ts";
import { backHint } from "./nav/keyHints.ts";
import "./online.css";

/**
 * Pantalla de entrada al ONLINE: crear una sala (serás anfitrión) o unirse con
 * un código. Al establecer la conexión, entrega la red al lobby.
 *
 *  - HOST: entra al lobby en cuanto crea la sala (ya puede esperar a otros ahí).
 *  - GUEST: entra al lobby cuando su canal P2P con el host queda abierto.
 *
 * Estilo KiroBrawl (R3.1, R3.4): dos placas inclinadas (crear / unirse) y una
 * línea de estado de conexión con indicador de color (ocupado / error / ok).
 */
export interface OnlineScreenCallbacks {
  onBack: () => void;
  /** La red está lista: entrega el OnlineNetwork y el código de sala. */
  onReady: (net: OnlineNetwork, roomCode: string) => void;
}

/** Tono visual del estado de conexión (solo presentación). */
type StatusTone = "idle" | "busy" | "ok" | "error";

export class OnlineScreen {
  private readonly root: HTMLDivElement;
  private readonly nav = screenNav(() => this.root);
  private readonly statusEl: HTMLDivElement;
  private readonly statusText: HTMLSpanElement;
  private readonly formEl: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private net: OnlineNetwork | null = null;
  private entered = false;
  /** Código de la sala (lo da el host al crear; el guest lo escribe). */
  private roomCode = "";

  constructor(private readonly cb: OnlineScreenCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "online-screen";
    this.root.className = "select-screen kb-online";

    const header = document.createElement("div");
    header.className = "kb-online__header";
    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Jugar online";
    header.appendChild(title);
    const hint = document.createElement("p");
    hint.className = "select-hint";
    hint.textContent =
      "Crea una sala y pásale el código a tus amigos (hasta 4), o únete con el código que te den.";
    header.appendChild(hint);
    this.root.appendChild(header);

    this.formEl = document.createElement("div");
    this.formEl.className = "online-form";

    // Placa "Crear sala".
    const createPlate = document.createElement("section");
    createPlate.className = "kb-online__plate kb-online__plate--host";
    const createTitle = document.createElement("h2");
    createTitle.className = "kb-online__plate-title";
    createTitle.textContent = "Anfitrión";
    const createDesc = document.createElement("p");
    createDesc.className = "kb-online__plate-desc";
    createDesc.textContent = "Abre una sala nueva y comparte su código.";
    const createBtn = button({ label: "Crear sala", onActivate: () => this.host() });
    createBtn.classList.add("online-create");
    createPlate.append(createTitle, createDesc, createBtn);
    this.formEl.appendChild(createPlate);

    // Placa "Unirse".
    const joinPlate = document.createElement("section");
    joinPlate.className = "kb-online__plate kb-online__plate--join";
    const joinTitle = document.createElement("h2");
    joinTitle.className = "kb-online__plate-title";
    joinTitle.textContent = "Invitado";
    const joinDesc = document.createElement("p");
    joinDesc.className = "kb-online__plate-desc";
    joinDesc.textContent = "Escribe el código de la sala de tu amigo.";
    const joinRow = document.createElement("div");
    joinRow.className = "online-join-row";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "online-code-input";
    this.input.placeholder = "CÓDIGO";
    this.input.maxLength = 5;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "Código de sala");
    this.input.addEventListener("input", () => {
      this.input.value = this.input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    const joinBtn = button({ label: "Unirse", variant: "secondary", onActivate: () => this.join() });
    joinBtn.classList.add("online-join");
    joinRow.appendChild(this.input);
    joinRow.appendChild(joinBtn);
    joinPlate.append(joinTitle, joinDesc, joinRow);
    this.formEl.appendChild(joinPlate);

    this.root.appendChild(this.formEl);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "online-status";
    this.statusEl.setAttribute("role", "status");
    this.statusEl.setAttribute("aria-live", "polite");
    const dot = document.createElement("span");
    dot.className = "kb-conn-dot";
    dot.setAttribute("aria-hidden", "true");
    this.statusText = document.createElement("span");
    this.statusText.className = "online-status__text";
    this.statusEl.append(dot, this.statusText);
    this.root.appendChild(this.statusEl);

    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = button({
      label: "‹ Atrás",
      variant: "ghost",
      onActivate: () => {
        this.teardown();
        this.cb.onBack();
      },
    });
    back.classList.add("select-back");
    actions.appendChild(backHint(back));
    this.root.appendChild(actions);

    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add("open");
    this.reset();
    this.nav.mount();
  }

  hide(): void {
    this.root.classList.remove("open");
    this.nav.unmount();
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
    this.setStatus("Creando sala…", "busy");
    this.net!.host();
  }

  private join(): void {
    const code = this.input.value.trim().toUpperCase();
    if (code.length < 4) {
      this.setStatus("Introduce un código válido.", "error");
      return;
    }
    this.roomCode = code;
    this.startNet();
    this.formEl.style.display = "none";
    this.setStatus("Uniéndote a la sala…", "busy");
    this.net!.join(code);
  }

  private startNet(): void {
    this.net = new OnlineNetwork({
      onRoomCode: (code) => {
        // Host: ya puede entrar al lobby (esperará a otros allí).
        this.roomCode = code;
        this.setStatus(`Sala creada: ${code}`, "ok");
        this.enterLobby();
      },
      onPeerConnected: () => {
        // Guest: su canal con el host está listo → al lobby.
        if (this.net && this.net.mySlot !== 0) this.enterLobby();
      },
      onPeerLeft: (slot) => {
        if (slot === 0 && !this.entered) {
          this.setStatus("El anfitrión cerró la sala.", "error");
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
        this.setStatus(msg, "error");
        this.formEl.style.display = "";
      },
    });
  }

  private enterLobby(): void {
    if (this.entered || !this.net) return;
    this.entered = true;
    this.cb.onReady(this.net, this.roomCode);
  }

  private setStatus(text: string, tone: StatusTone = "idle"): void {
    this.statusText.textContent = text;
    this.statusEl.dataset.tone = text ? tone : "idle";
  }
}
