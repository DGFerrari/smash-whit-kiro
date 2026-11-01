import { CHARACTERS } from "../engine/game/characters.ts";
import type { OnlineFighterResult } from "../net/onlineProtocol.ts";

/**
 * Pantalla de FIN DE PARTIDA online: texto de victoria + panel con las stats de
 * TODOS los jugadores (estilo podio), la recompensa de monedas del jugador
 * local, y una zona de "espera" donde cada jugador debe pulsar ACEPTAR. Cuando
 * todos han aceptado, el HOST decide: Revancha o Volver al lobby.
 *
 * El flujo de red lo coordina main.ts (host autoritativo); esta clase solo
 * pinta y expone callbacks: onAccept (yo acepto), onRematch / onLobby (host).
 */
export interface OnlinePostMatchCallbacks {
  /** El jugador local pulsa "Aceptar". */
  onAccept: () => void;
  /** Solo host: repetir con la misma gente/config (nueva semilla). */
  onRematch: () => void;
  /** Solo host: volver al lobby de selección. */
  onLobby: () => void;
}

export class OnlinePostMatch {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly podium: HTMLDivElement;
  private readonly rewardEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly acceptBtn: HTMLButtonElement;
  private readonly hostActions: HTMLDivElement;
  private readonly rematchBtn: HTMLButtonElement;
  private readonly lobbyBtn: HTMLButtonElement;

  private isHost = false;
  private mySlot = 0;
  private occupiedSlots: number[] = [];
  /** Tarjeta del podio por slot (para marcar el tick de "aceptado"). */
  private readonly cardBySlot = new Map<number, HTMLElement>();

  constructor(private readonly cb: OnlinePostMatchCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "online-post";
    this.root.className = "select-screen";

    const panel = document.createElement("div");
    panel.className = "menu-panel results-panel show";

    this.titleEl = document.createElement("h1");
    this.titleEl.className = "menu-title";
    panel.appendChild(this.titleEl);

    this.podium = document.createElement("div");
    this.podium.className = "podium";
    panel.appendChild(this.podium);

    // Recompensa (monedas) del jugador local.
    this.rewardEl = document.createElement("div");
    this.rewardEl.className = "match-reward";
    panel.appendChild(this.rewardEl);

    // Estado de aceptación (quién ha aceptado ya).
    this.statusEl = document.createElement("div");
    this.statusEl.className = "online-post-status";
    panel.appendChild(this.statusEl);

    // Botón ACEPTAR (todos).
    const actions = document.createElement("div");
    actions.className = "results-actions";

    this.acceptBtn = document.createElement("button");
    this.acceptBtn.type = "button";
    this.acceptBtn.className = "result-btn result-btn-rematch";
    this.acceptBtn.innerHTML =
      '<span class="result-btn-icon">✓</span><span class="result-btn-text">Aceptar</span><span class="result-btn-sub">Listo para seguir</span>';
    this.acceptBtn.addEventListener("click", () => this.accept());
    actions.appendChild(this.acceptBtn);
    panel.appendChild(actions);

    // Acciones del HOST (ocultas hasta que todos acepten).
    this.hostActions = document.createElement("div");
    this.hostActions.className = "results-actions online-post-host";
    this.hostActions.style.display = "none";

    this.rematchBtn = document.createElement("button");
    this.rematchBtn.type = "button";
    this.rematchBtn.className = "result-btn result-btn-rematch";
    this.rematchBtn.innerHTML =
      '<span class="result-btn-icon">↻</span><span class="result-btn-text">Revancha</span><span class="result-btn-sub">Misma gente</span>';
    this.rematchBtn.addEventListener("click", () => this.cb.onRematch());
    this.hostActions.appendChild(this.rematchBtn);

    this.lobbyBtn = document.createElement("button");
    this.lobbyBtn.type = "button";
    this.lobbyBtn.className = "result-btn result-btn-menu";
    this.lobbyBtn.innerHTML =
      '<span class="result-btn-icon">⟲</span><span class="result-btn-text">Volver al lobby</span><span class="result-btn-sub">Recomponer sala</span>';
    this.lobbyBtn.addEventListener("click", () => this.cb.onLobby());
    this.hostActions.appendChild(this.lobbyBtn);

    panel.appendChild(this.hostActions);

    this.root.appendChild(panel);
    document.body.appendChild(this.root);
  }

  /**
   * Muestra la pantalla con el resultado. `occupiedSlots` son los slots que
   * jugaron (para saber cuántos "aceptar" hacen falta).
   */
  show(
    results: OnlineFighterResult[],
    winnerSlot: number,
    draw: boolean,
    mySlot: number,
    isHost: boolean,
    occupiedSlots: number[],
  ): void {
    this.isHost = isHost;
    this.mySlot = mySlot;
    this.occupiedSlots = occupiedSlots;

    const winner = results.find((r) => r.slot === winnerSlot);
    this.titleEl.textContent = draw ? "¡Empate!" : `¡Gana ${winner?.label ?? "nadie"}!`;
    this.titleEl.style.color = draw ? "#f1f4fa" : winner?.color ?? "#f1f4fa";

    this.buildPodium(results);

    // Recompensa en estado "cargando" hasta que el servidor responda.
    this.rewardEl.className = "match-reward show loading";
    this.rewardEl.replaceChildren();
    const spin = document.createElement("span");
    spin.className = "match-reward-spinner";
    const txt = document.createElement("span");
    txt.textContent = "Guardando resultado…";
    this.rewardEl.append(spin, txt);

    this.acceptBtn.disabled = false;
    this.acceptBtn.classList.remove("disabled");
    this.hostActions.style.display = "none";
    this.setConfirmed([]);

    this.root.classList.add("open");
  }

  hide(): void {
    this.root.classList.remove("open");
  }

  /** Refleja la recompensa de monedas (o un aviso si no puntuó). */
  setReward(message: string, coins: number | null): void {
    this.rewardEl.className = "match-reward show";
    this.rewardEl.replaceChildren();
    if (coins !== null) {
      const amount = document.createElement("span");
      amount.className = "match-reward-coins";
      amount.textContent = `+${coins}`;
      const icon = document.createElement("span");
      icon.className = "match-reward-icon";
      icon.textContent = "🪙";
      const label = document.createElement("span");
      label.textContent = message;
      this.rewardEl.append(amount, icon, label);
    } else {
      const label = document.createElement("span");
      label.className = "match-reward-note";
      label.textContent = message;
      this.rewardEl.appendChild(label);
    }
  }

  /** Pinta quién ha aceptado ya y, si están todos, abre las opciones del host. */
  setConfirmed(slots: number[]): void {
    const total = this.occupiedSlots.length;
    const done = this.occupiedSlots.filter((s) => slots.includes(s)).length;
    this.statusEl.textContent = `Aceptado: ${done}/${total}`;

    // Marca con un tick la tarjeta de cada jugador que ya aceptó.
    for (const [slot, card] of this.cardBySlot) {
      card.classList.toggle("accepted", slots.includes(slot));
    }

    const all = total > 0 && done >= total;
    if (all) {
      if (this.isHost) {
        this.hostActions.style.display = "";
        this.statusEl.textContent = "Todos listos. Elige qué hacer:";
      } else {
        this.statusEl.textContent = "Todos listos. Esperando al anfitrión…";
      }
    }
  }

  private accept(): void {
    this.acceptBtn.disabled = true;
    this.acceptBtn.classList.add("disabled");
    this.cb.onAccept();
  }

  private buildPodium(results: OnlineFighterResult[]): void {
    const sorted = [...results].sort(
      (a, b) => Number(b.isWinner) - Number(a.isWinner) || b.dealt - a.dealt,
    );
    this.podium.replaceChildren();
    this.cardBySlot.clear();
    for (const r of sorted) {
      const card = this.buildCard(r);
      this.cardBySlot.set(r.slot, card);
      this.podium.appendChild(card);
    }
  }

  private buildCard(r: OnlineFighterResult): HTMLElement {
    const card = document.createElement("div");
    card.className = "podium-card";
    card.style.borderColor = r.color;
    if (r.isWinner) card.classList.add("winner");

    // Tick de "ha aceptado" (oculto hasta que el jugador confirma).
    const tick = document.createElement("div");
    tick.className = "podium-accept-tick";
    tick.textContent = "✓";
    card.appendChild(tick);

    const head = document.createElement("div");
    head.className = "podium-head";
    head.style.color = r.color;
    const you = r.slot === this.mySlot ? " (tú)" : "";
    head.textContent = (r.isWinner ? `🏆 ${r.label}` : r.label) + you;
    card.appendChild(head);

    const sub = document.createElement("div");
    sub.className = "podium-grade";
    sub.textContent = CHARACTERS[r.character]?.name ?? "";
    card.appendChild(sub);

    const rows: Array<[string, string]> = [
      ["Daño infligido", `${Math.round(r.dealt)}%`],
      ["Daño recibido", `${Math.round(r.taken)}%`],
      ["Daño bloqueado", `${Math.round(r.blocked)}%`],
      ["KOs", String(r.kos)],
      ["Muertes", String(r.deaths)],
    ];
    const stats = document.createElement("div");
    stats.className = "podium-stats";
    for (const [k, v] of rows) {
      const row = document.createElement("div");
      row.className = "podium-stat";
      const kEl = document.createElement("span");
      kEl.textContent = k;
      const vEl = document.createElement("span");
      vEl.className = "podium-stat-value";
      vEl.textContent = v;
      row.append(kEl, vEl);
      stats.appendChild(row);
    }
    card.appendChild(stats);
    return card;
  }
}
