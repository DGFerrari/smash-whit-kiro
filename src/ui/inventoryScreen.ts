import { getStats, getTokens, type TokenInventory } from "../net/api.ts";
import { button, tabs } from "./design/components.ts";
import { screenNav } from "./nav/screenNav.ts";
import { backHint, keyHint } from "./nav/keyHints.ts";
import { setLegend } from "./nav/legend.ts";
import {
  RARITY_DESC,
  RARITY_LABEL,
  RARITY_ORDER,
  gemIcon,
  loadPullHistory,
  type PullSession,
} from "./gachaArt.ts";
import "./inventoryScreen.css";

/**
 * INVENTARIO: pantalla propia (antes era el cajón "Mochila" del gacha).
 *
 *  - Pestaña "Tokens": una vitrina por rareza con su gema, cantidad y barra de
 *    proporción; más huecos "Próximamente" para objetos futuros.
 *  - Pestaña "Historial": las últimas tiradas vistas en este navegador.
 *
 * Los totales salen del SERVIDOR (getTokens/getStats); el historial es local.
 */
export interface InventoryScreenCallbacks {
  onBack: () => void;
  /** Ir al gacha a tirar más. */
  onOpenGacha: () => void;
}

type Tab = "tokens" | "history";

export class InventoryScreen {
  private readonly root: HTMLDivElement;
  private readonly nav = screenNav(() => this.root);
  private readonly coinsEl: HTMLSpanElement;
  private readonly totalEl: HTMLSpanElement;
  private readonly body: HTMLDivElement;
  private tab: Tab = "tokens";
  private tokens: TokenInventory | null = null;
  private hasSession = false;
  private loadId = 0;

  constructor(private readonly cb: InventoryScreenCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "inventory-screen";
    this.root.className = "select-screen kbi";

    const header = document.createElement("div");
    header.className = "kbi-header";
    const title = document.createElement("h1");
    title.className = "select-title kbi-title";
    title.textContent = "Inventario";

    const chips = document.createElement("div");
    chips.className = "kbi-chips";
    const coins = document.createElement("span");
    coins.className = "kbi-chip kbi-chip--coins";
    this.coinsEl = document.createElement("strong");
    this.coinsEl.textContent = "—";
    coins.append("🪙 ", this.coinsEl, " monedas");
    const total = document.createElement("span");
    total.className = "kbi-chip";
    this.totalEl = document.createElement("strong");
    this.totalEl.textContent = "—";
    total.append(this.totalEl, " tokens en total");
    chips.append(coins, total);
    header.append(title, chips);
    this.root.appendChild(header);

    const bar = tabs({
      tabs: [
        { id: "tokens", label: "Tokens" },
        { id: "history", label: "Historial" },
      ],
      selected: this.tab,
      onChange: (id) => {
        this.tab = id as Tab;
        this.render();
      },
    });
    bar.classList.add("kbi-tabs");
    this.root.appendChild(bar);

    this.body = document.createElement("div");
    this.body.className = "kbi-body";
    this.body.setAttribute("aria-live", "polite");
    this.root.appendChild(this.body);

    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = button({ label: "‹ Atrás", variant: "ghost", onActivate: () => this.cb.onBack() });
    back.classList.add("kb-select__back");
    const toGacha = button({ label: "Ir al gacha ›", variant: "primary", onActivate: () => this.cb.onOpenGacha() });
    toGacha.classList.add("kb-select__go");
    actions.append(backHint(back), keyHint(toGacha, "g", { pad: "y", label: "Gacha" }));
    this.root.appendChild(actions);

    setLegend(this.root, { accept: "Aceptar" });
    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add("open");
    this.render();
    this.nav.mount();
    void this.load();
  }

  hide(): void {
    this.loadId++;
    this.root.classList.remove("open");
    this.nav.unmount();
  }

  private async load(): Promise<void> {
    const id = ++this.loadId;
    this.body.classList.add("is-loading");
    const [stats, tokens] = await Promise.all([getStats(), getTokens()]);
    if (id !== this.loadId) return;
    this.body.classList.remove("is-loading");
    this.hasSession = stats !== null;
    this.tokens = tokens;
    this.coinsEl.textContent = stats ? String(stats.coins) : "—";
    this.totalEl.textContent = tokens ? String(tokens.common + tokens.epic + tokens.legendary) : "—";
    this.render();
  }

  private render(): void {
    this.body.replaceChildren(this.tab === "tokens" ? this.renderTokens() : this.renderHistory());
  }

  private renderTokens(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "kbi-vitrine";
    if (!this.hasSession) wrap.appendChild(notice("Inicia sesión para ver y guardar tus tokens."));
    const t = this.tokens;
    const sum = t ? t.common + t.epic + t.legendary : 0;
    RARITY_ORDER.forEach((r, i) => {
      const n = t?.[r] ?? 0;
      const item = document.createElement("article");
      item.className = `kbi-item rarity-${r}`;
      item.style.setProperty("--i", String(i));
      const gemWrap = document.createElement("div");
      gemWrap.className = "kbi-item__gem-wrap";
      gemWrap.appendChild(gemIcon(r, "kbi-item__gem"));
      const name = document.createElement("h2");
      name.className = "kbi-item__name";
      name.textContent = RARITY_LABEL[r];
      const count = document.createElement("div");
      count.className = "kbi-item__count";
      count.textContent = t ? String(n) : "—";
      const desc = document.createElement("p");
      desc.className = "kbi-item__desc";
      desc.textContent = RARITY_DESC[r];
      const meter = document.createElement("div");
      meter.className = "kbi-item__meter";
      meter.setAttribute("role", "img");
      const pct = sum > 0 ? Math.round((n / sum) * 100) : 0;
      meter.setAttribute("aria-label", `${pct}% de tus tokens`);
      const fill = document.createElement("span");
      fill.style.setProperty("--pct", `${pct}%`);
      meter.appendChild(fill);
      item.append(gemWrap, name, count, meter, desc);
      wrap.appendChild(item);
    });
    // Huecos para futuros objetos (aspectos, emotes…).
    for (let i = 0; i < 3; i++) {
      const slot = document.createElement("article");
      slot.className = "kbi-item kbi-item--locked";
      slot.style.setProperty("--i", String(3 + i));
      slot.innerHTML = '<div class="kbi-item__lock" aria-hidden="true">🔒</div><h2 class="kbi-item__name">Próximamente</h2>';
      wrap.appendChild(slot);
    }
    return wrap;
  }

  private renderHistory(): HTMLElement {
    const list = document.createElement("div");
    list.className = "kbi-history";
    const sessions = loadPullHistory();
    if (sessions.length === 0) {
      list.appendChild(notice("Aún no has hecho ninguna tirada en este dispositivo."));
      return list;
    }
    sessions.forEach((s, i) => list.appendChild(historyRow(s, i)));
    return list;
  }
}

function notice(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "kbi-notice";
  p.textContent = text;
  return p;
}

function historyRow(s: PullSession, i: number): HTMLElement {
  const row = document.createElement("article");
  row.className = "kbi-hrow";
  row.style.setProperty("--i", String(Math.min(i, 12)));
  const when = document.createElement("time");
  when.className = "kbi-hrow__when";
  const d = new Date(s.at);
  when.dateTime = d.toISOString();
  when.textContent = d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const kind = document.createElement("span");
  kind.className = "kbi-hrow__kind";
  kind.textContent = `×${s.pulls.length} · 🪙 ${s.cost}`;
  const chips = document.createElement("div");
  chips.className = "kbi-hrow__chips";
  for (const r of RARITY_ORDER) {
    const got = s.pulls.filter((p) => p.rarity === r);
    if (got.length === 0) continue;
    const chip = document.createElement("span");
    chip.className = `kbi-hchip rarity-${r}`;
    chip.append(gemIcon(r, "kbi-hchip__gem"), document.createTextNode(`+${got.reduce((a, p) => a + p.tokens, 0)}`));
    chip.title = `${got.length} × ${RARITY_LABEL[r]}`;
    chips.appendChild(chip);
  }
  row.append(when, kind, chips);
  return row;
}
