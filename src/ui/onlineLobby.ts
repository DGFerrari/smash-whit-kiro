import { CHARACTERS, SELECTABLE_CHARACTERS, type CharacterId } from "../engine/game/characters.ts";
import { STAGES, SELECTABLE_STAGES, type StageId } from "../engine/game/stages.ts";
import type { PeerConnection } from "../net/peer.ts";
import { decodeLobby, encodeLobby, type LobbyMsg } from "../net/onlineProtocol.ts";

/**
 * LOBBY online (2 jugadores): selección de personaje compartida y, luego, de
 * mapa. Sincronizado por el canal P2P:
 *  - Cada jugador elige SU personaje y se difunde (ves el del rival, no lo editas).
 *  - El HOST controla la fase (personajes -> mapa) y elige el mapa; el guest lo
 *    ve en vivo y no puede tocar.
 *  - El HOST pulsa "¡A luchar!" y difunde la config: ambos arrancan la partida.
 *
 * La UI muestra 4 tarjetas (P1 host, P2 guest, P3/P4 vacías) de cara a soportar
 * más jugadores en el futuro, aunque hoy el P2P es de 2.
 */
export interface OnlineLobbyCallbacks {
  onBack: () => void;
  /** Arrancar la partida con la config acordada (lo disparan ambos). */
  onStart: (seed: number, characters: CharacterId[], stage: StageId) => void;
}

type Phase = "characters" | "stage";

export class OnlineLobby {
  private readonly root: HTMLDivElement;
  private readonly cardsEl: HTMLDivElement;
  private readonly portraitsEl: HTMLDivElement;
  private readonly stageGridEl: HTMLDivElement;
  private readonly charsPhaseEl: HTMLDivElement;
  private readonly stagePhaseEl: HTMLDivElement;
  private readonly nextBtn: HTMLButtonElement;

  private peer: PeerConnection | null = null;
  private role: "host" | "guest" = "host";
  private phase: Phase = "characters";

  /** Personaje elegido por cada jugador (índice 0 = host, 1 = guest). */
  private picks: Array<CharacterId | null> = [null, null];
  private stage: StageId = SELECTABLE_STAGES[0];

  constructor(private readonly cb: OnlineLobbyCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "online-lobby";
    this.root.className = "select-screen";

    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Sala online";
    this.root.appendChild(title);

    // --- Fase personajes ---
    this.charsPhaseEl = document.createElement("div");
    this.charsPhaseEl.className = "lobby-phase";

    this.cardsEl = document.createElement("div");
    this.cardsEl.className = "lobby-cards";
    this.charsPhaseEl.appendChild(this.cardsEl);

    const pick = document.createElement("p");
    pick.className = "select-hint";
    pick.textContent = "Elige tu personaje:";
    this.charsPhaseEl.appendChild(pick);

    this.portraitsEl = document.createElement("div");
    this.portraitsEl.className = "lobby-portraits";
    for (const id of SELECTABLE_CHARACTERS) {
      const def = CHARACTERS[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lobby-portrait";
      btn.style.setProperty("--c", def.color);
      btn.style.background = `linear-gradient(150deg, ${def.color}, ${shade(def.color, 0.6)})`;
      btn.dataset.char = id;
      btn.textContent = def.name;
      btn.addEventListener("click", () => this.chooseCharacter(id));
      this.portraitsEl.appendChild(btn);
    }
    this.charsPhaseEl.appendChild(this.portraitsEl);
    this.root.appendChild(this.charsPhaseEl);

    // --- Fase mapa ---
    this.stagePhaseEl = document.createElement("div");
    this.stagePhaseEl.className = "lobby-phase";
    this.stagePhaseEl.style.display = "none";

    const stageHint = document.createElement("p");
    stageHint.className = "select-hint";
    stageHint.textContent = "Escenario (lo elige el anfitrión):";
    this.stagePhaseEl.appendChild(stageHint);

    this.stageGridEl = document.createElement("div");
    this.stageGridEl.className = "lobby-stages";
    for (const id of SELECTABLE_STAGES) {
      const def = STAGES[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lobby-stage";
      btn.dataset.stage = id;
      btn.style.background = stageGradient(id);
      const name = document.createElement("span");
      name.className = "lobby-stage-name";
      name.textContent = def.name;
      btn.appendChild(name);
      btn.addEventListener("click", () => this.chooseStage(id));
      this.stageGridEl.appendChild(btn);
    }
    this.stagePhaseEl.appendChild(this.stageGridEl);
    this.root.appendChild(this.stagePhaseEl);

    // --- Acciones ---
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

    this.nextBtn = document.createElement("button");
    this.nextBtn.className = "menu-btn select-go";
    this.nextBtn.textContent = "Siguiente ›";
    this.nextBtn.addEventListener("click", () => this.onNext());
    actions.appendChild(this.nextBtn);
    this.root.appendChild(actions);

    document.body.appendChild(this.root);
  }

  /** Abre el lobby con el peer ya conectado. */
  open(peer: PeerConnection, role: "host" | "guest"): void {
    this.peer = peer;
    this.role = role;
    this.phase = "characters";
    this.picks = [null, null];
    this.stage = SELECTABLE_STAGES[0];

    peer.setMessageHandler((data) => this.onMessage(data));
    peer.setClosedHandler(() => {
      this.teardown();
      this.cb.onBack();
    });

    this.root.classList.add("open");
    this.render();
  }

  hide(): void {
    this.root.classList.remove("open");
  }

  private teardown(): void {
    this.peer?.close();
    this.peer = null;
  }

  // --- Lógica de selección --------------------------------------------------

  private myIndex(): number {
    return this.role === "host" ? 0 : 1;
  }

  private chooseCharacter(id: CharacterId): void {
    this.picks[this.myIndex()] = id;
    this.send({ t: "pick", character: id });
    this.render();
  }

  private chooseStage(id: StageId): void {
    if (this.role !== "host") return; // solo el host elige mapa
    this.stage = id;
    this.send({ t: "stage", stage: id });
    this.render();
  }

  /** Botón "Siguiente/A luchar" (solo activo para el host). */
  private onNext(): void {
    if (this.role !== "host") return;
    if (this.phase === "characters") {
      // Ambos deben tener personaje.
      if (!this.picks[0] || !this.picks[1]) return;
      this.phase = "stage";
      this.send({ t: "phase", phase: "stage" });
      this.render();
    } else {
      // Arrancar la partida: difundimos semilla + config y lanzamos.
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const characters = [this.picks[0] as CharacterId, this.picks[1] as CharacterId];
      this.send({ t: "start", seed, characters, stage: this.stage });
      this.cb.onStart(seed, characters, this.stage);
    }
  }

  // --- Mensajes del peer ----------------------------------------------------

  private onMessage(data: string): void {
    const msg = decodeLobby(data);
    if (!msg) return;
    switch (msg.t) {
      case "pick":
        // El rival eligió su personaje (índice opuesto al mío).
        this.picks[this.role === "host" ? 1 : 0] = msg.character;
        this.render();
        break;
      case "phase":
        this.phase = msg.phase;
        this.render();
        break;
      case "stage":
        this.stage = msg.stage;
        this.render();
        break;
      case "start":
        this.cb.onStart(msg.seed, msg.characters, msg.stage);
        break;
      default:
        break;
    }
  }

  private send(msg: LobbyMsg): void {
    this.peer?.send(encodeLobby(msg));
  }

  // --- Render ---------------------------------------------------------------

  private render(): void {
    this.charsPhaseEl.style.display = this.phase === "characters" ? "" : "none";
    this.stagePhaseEl.style.display = this.phase === "stage" ? "" : "none";

    // Tarjetas de jugador (4 slots; P1 host, P2 guest, P3/P4 vacíos).
    this.cardsEl.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const card = document.createElement("div");
      card.className = "lobby-card";
      const occupied = i < 2;
      const label = document.createElement("div");
      label.className = "lobby-card-label";
      label.textContent = `P${i + 1}`;
      card.appendChild(label);

      const who = document.createElement("div");
      who.className = "lobby-card-who";
      if (!occupied) {
        card.classList.add("empty");
        who.textContent = "vacío";
      } else {
        who.textContent =
          i === this.myIndex() ? "Tú" + (this.role === "host" ? " (anfitrión)" : "") : "Rival";
        const pick = this.picks[i];
        const ch = document.createElement("div");
        ch.className = "lobby-card-char";
        if (pick) {
          ch.textContent = CHARACTERS[pick].name;
          ch.style.color = CHARACTERS[pick].color;
          card.style.borderColor = CHARACTERS[pick].color;
        } else {
          ch.textContent = "eligiendo…";
        }
        card.appendChild(who);
        card.appendChild(ch);
      }
      if (!occupied) card.appendChild(who);
      this.cardsEl.appendChild(card);
    }

    // Resalta mi personaje elegido en la fila de retratos.
    const mine = this.picks[this.myIndex()];
    for (const btn of Array.from(this.portraitsEl.children) as HTMLButtonElement[]) {
      btn.classList.toggle("selected", btn.dataset.char === mine);
    }

    // Resalta el mapa elegido; deshabilita la elección si no eres host.
    for (const btn of Array.from(this.stageGridEl.children) as HTMLButtonElement[]) {
      btn.classList.toggle("selected", btn.dataset.stage === this.stage);
      btn.disabled = this.role !== "host";
    }

    // Botón Siguiente/Luchar: solo el host; el guest ve un texto de espera.
    if (this.role === "host") {
      this.nextBtn.style.display = "";
      if (this.phase === "characters") {
        this.nextBtn.textContent = "Siguiente ›";
        this.nextBtn.disabled = !this.picks[0] || !this.picks[1];
      } else {
        this.nextBtn.textContent = "¡A luchar! ›";
        this.nextBtn.disabled = false;
      }
    } else {
      this.nextBtn.style.display = "none";
    }
  }
}

/** Oscurece un color hex #rrggbb por un factor f (0..1). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

/** Degradado de miniatura de un escenario (como en la selección local). */
function stageGradient(id: StageId): string {
  const def = STAGES[id];
  const bg = `#${def.theme.background.toString(16).padStart(6, "0")}`;
  const top = `#${def.theme.solidTop.toString(16).padStart(6, "0")}`;
  return `linear-gradient(160deg, ${bg} 55%, ${top} 55%)`;
}
