import {
  getGachaInfo,
  getStats,
  getTokens,
  pull,
  type GachaInfo,
  type Pull,
  type Rarity,
  type TokenInventory,
} from "../net/api.ts";

/**
 * Pantalla de GACHA ("Cofres") + mochila de tokens.
 *
 * Arriba: saldo de monedas. Centro: botones de tirada (x1 / x10) y la zona
 * donde se revelan los resultados con una animación por rareza. Abajo: la
 * MOCHILA por apartados (de momento solo "Tokens", con común/épico/legendario).
 *
 * Toda la aleatoriedad y el cobro los hace el SERVIDOR: el cliente pide tirar y
 * muestra lo que recibe. Las esperas tienen indicador de carga.
 */
export interface GachaScreenCallbacks {
  onBack: () => void;
}

const RARITY_LABEL: Record<Rarity, string> = {
  common: "Común",
  epic: "Épico",
  legendary: "Legendario",
};

export class GachaScreen {
  private readonly root: HTMLDivElement;
  private readonly coinsEl: HTMLSpanElement;
  private readonly resultEl: HTMLDivElement;
  private readonly drawer: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly pull1Btn: HTMLButtonElement;
  private readonly pull10Btn: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;

  private info: GachaInfo | null = null;
  private coins = 0;
  private busy = false;

  constructor(private readonly cb: GachaScreenCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "gacha-screen";
    this.root.className = "select-screen";

    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Gacha";
    this.root.appendChild(title);

    // Saldo de monedas.
    const coinsBar = document.createElement("div");
    coinsBar.className = "gacha-coins";
    coinsBar.innerHTML = '<span class="gacha-coin-icon">🪙</span>';
    this.coinsEl = document.createElement("span");
    this.coinsEl.className = "gacha-coins-value";
    this.coinsEl.textContent = "—";
    coinsBar.appendChild(this.coinsEl);
    this.root.appendChild(coinsBar);

    // Zona de resultados (cartas reveladas).
    this.resultEl = document.createElement("div");
    this.resultEl.className = "gacha-result";
    this.root.appendChild(this.resultEl);

    // Botones de tirada.
    const pulls = document.createElement("div");
    pulls.className = "gacha-pulls";
    this.pull1Btn = document.createElement("button");
    this.pull1Btn.type = "button";
    this.pull1Btn.className = "menu-btn gacha-pull-btn";
    this.pull1Btn.addEventListener("click", () => void this.doPull(1));
    pulls.appendChild(this.pull1Btn);
    this.pull10Btn = document.createElement("button");
    this.pull10Btn.type = "button";
    this.pull10Btn.className = "menu-btn gacha-pull-btn gacha-pull-multi";
    this.pull10Btn.addEventListener("click", () => void this.doPull(10));
    pulls.appendChild(this.pull10Btn);
    this.root.appendChild(pulls);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "gacha-status";
    this.root.appendChild(this.statusEl);

    // Volver.
    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = document.createElement("button");
    back.className = "menu-btn select-back";
    back.textContent = "‹ Atrás";
    back.addEventListener("click", () => this.cb.onBack());
    actions.appendChild(back);
    this.root.appendChild(actions);

    // --- MOCHILA: cajón inferior desplegable ---
    // Oculto abajo; una pestaña lo despliega hacia arriba. Dentro: pestañas de
    // categoría (por ahora solo "Tokens") y una cuadrícula 5x3 de celdas.
    this.drawer = document.createElement("div");
    this.drawer.className = "inv-drawer";

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "inv-handle";
    handle.innerHTML = '<span class="inv-handle-arrow">▲</span> Mochila';
    handle.addEventListener("click", () => this.toggleDrawer());
    this.drawer.appendChild(handle);

    const panel = document.createElement("div");
    panel.className = "inv-panel";

    // Pestañas de categoría (preparadas para más apartados en el futuro).
    const tabs = document.createElement("div");
    tabs.className = "inv-tabs";
    const tokensTab = document.createElement("button");
    tokensTab.type = "button";
    tokensTab.className = "inv-tab active";
    tokensTab.textContent = "Tokens";
    tabs.appendChild(tokensTab);
    panel.appendChild(tabs);

    // Cuadrícula 5x3 (15 celdas). Las primeras 3 son los tokens; el resto,
    // huecos vacíos (placeholder para futuros objetos).
    this.grid = document.createElement("div");
    this.grid.className = "inv-grid";
    panel.appendChild(this.grid);

    this.drawer.appendChild(panel);
    this.root.appendChild(this.drawer);

    document.body.appendChild(this.root);
  }

  /** Abre/cierra el cajón de la mochila. */
  private toggleDrawer(): void {
    this.drawer.classList.toggle("open");
  }

  show(): void {
    this.root.classList.add("open");
    this.resultEl.replaceChildren();
    void this.loadAll();
  }

  hide(): void {
    this.root.classList.remove("open");
  }

  /** Carga precios, saldo e inventario al abrir. */
  private async loadAll(): Promise<void> {
    this.setStatus("Cargando…", true);
    this.setButtonsEnabled(false);
    const [info, stats, tokens] = await Promise.all([
      this.info ? Promise.resolve(this.info) : getGachaInfo(),
      getStats(),
      getTokens(),
    ]);

    if (!info) {
      this.setStatus("No se pudo cargar la tienda. El servidor puede estar despertando.", false);
      return;
    }
    this.info = info;
    this.pull1Btn.innerHTML = `Tirar ×1<span class="gacha-cost">🪙 ${info.singleCost}</span>`;
    this.pull10Btn.innerHTML = `Tirar ×${info.multiCount}<span class="gacha-cost">🪙 ${info.multiCost}</span>`;

    if (!stats) {
      // Sin sesión: se puede ver la tienda pero no tirar.
      this.coinsEl.textContent = "inicia sesión";
      this.renderTokens(null);
      this.setStatus("Inicia sesión para tirar y guardar tus tokens.", false);
      this.setButtonsEnabled(false);
      return;
    }

    this.coins = stats.coins;
    this.coinsEl.textContent = String(stats.coins);
    this.renderTokens(tokens);
    this.setStatus("", false);
    this.updateButtons();
  }

  private async doPull(count: 1 | 10): Promise<void> {
    if (this.busy || !this.info) return;
    this.busy = true;
    this.setButtonsEnabled(false);
    this.setStatus("Abriendo…", true);
    this.resultEl.replaceChildren();

    const outcome = await pull(count);
    this.busy = false;

    if (outcome.kind === "no-session") {
      this.setStatus("Inicia sesión para tirar.", false);
      return;
    }
    if (outcome.kind === "no-coins") {
      this.setStatus(outcome.message, false);
      this.updateButtons();
      return;
    }
    if (outcome.kind === "error") {
      this.setStatus(outcome.message, false);
      this.updateButtons();
      return;
    }

    // Éxito: actualizamos saldo e inventario y revelamos las cartas.
    this.coins = outcome.coins;
    this.coinsEl.textContent = String(outcome.coins);
    this.renderTokens(outcome.tokens);
    this.setStatus("", false);
    this.revealPulls(outcome.pulls);
    this.updateButtons();
  }

  /** Revela las cartas obtenidas con una pequeña animación escalonada. */
  private revealPulls(pulls: Pull[]): void {
    this.resultEl.replaceChildren();
    pulls.forEach((p, i) => {
      const card = document.createElement("div");
      card.className = `gacha-card rarity-${p.rarity}`;
      card.style.animationDelay = `${i * 0.08}s`;
      const rarity = document.createElement("div");
      rarity.className = "gacha-card-rarity";
      rarity.textContent = RARITY_LABEL[p.rarity];
      const amount = document.createElement("div");
      amount.className = "gacha-card-amount";
      amount.textContent = `+${p.tokens}`;
      const tk = document.createElement("div");
      tk.className = "gacha-card-token";
      tk.textContent = "tokens";
      card.appendChild(rarity);
      card.appendChild(amount);
      card.appendChild(tk);
      this.resultEl.appendChild(card);
    });
  }

  /**
   * Pinta el inventario en la cuadrícula 5x3 (15 celdas). Las primeras 3 son
   * los tokens (común/épico/legendario); el resto, huecos vacíos (placeholder
   * para futuros objetos). Con guiones si no hay sesión.
   */
  private renderTokens(tokens: TokenInventory | null): void {
    const CELLS = 15; // 5 columnas x 3 filas
    const items: Array<{ rarity: Rarity; value: number | null }> = [
      { rarity: "common", value: tokens?.common ?? null },
      { rarity: "epic", value: tokens?.epic ?? null },
      { rarity: "legendary", value: tokens?.legendary ?? null },
    ];
    this.grid.replaceChildren();
    for (let i = 0; i < CELLS; i++) {
      const cell = document.createElement("div");
      const item = items[i];
      if (item) {
        cell.className = `inv-cell rarity-${item.rarity}`;
        const label = document.createElement("span");
        label.className = "inv-cell-label";
        label.textContent = RARITY_LABEL[item.rarity];
        const value = document.createElement("span");
        value.className = "inv-cell-value";
        value.textContent = item.value === null ? "—" : String(item.value);
        cell.appendChild(label);
        cell.appendChild(value);
      } else {
        cell.className = "inv-cell empty";
      }
      this.grid.appendChild(cell);
    }
  }

  /** Habilita/inhabilita los botones según saldo. */
  private updateButtons(): void {
    if (!this.info) return;
    this.pull1Btn.disabled = this.busy || this.coins < this.info.singleCost;
    this.pull10Btn.disabled = this.busy || this.coins < this.info.multiCost;
  }

  private setButtonsEnabled(enabled: boolean): void {
    this.pull1Btn.disabled = !enabled;
    this.pull10Btn.disabled = !enabled;
  }

  private setStatus(text: string, loading: boolean): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("loading", loading);
    this.statusEl.style.display = text ? "block" : "none";
  }
}
