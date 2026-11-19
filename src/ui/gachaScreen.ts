import { getGachaInfo, getStats, pull, type GachaInfo, type Pull, type Rarity } from "../net/api.ts";
import { button, setDisabled } from "./design/components.ts";
import { screenNav } from "./nav/screenNav.ts";
import { backHint, keyHint } from "./nav/keyHints.ts";
import { setLegend } from "./nav/legend.ts";
import {
  RARITY_LABEL,
  RARITY_ODDS,
  RARITY_ORDER,
  bestRarity,
  gemIcon,
  recordPullSession,
} from "./gachaArt.ts";
import "./gachaScreen.css";

/**
 * GACHA — estética KiroBrawl, con un COFRE como protagonista.
 *
 * Secuencia de una tirada:
 *  1. `charging`: el cofre tiembla y se carga de luz mientras el servidor
 *     sortea (como mínimo ~0,9 s, para que haya suspense).
 *  2. `burst`: la tapa salta, rayos del color de la MEJOR rareza obtenida
 *     (pista de lo que viene: dorado = hay legendario) y destello.
 *  3. `reveal`: las cartas salen del cofre boca abajo y se dan la vuelta en
 *     cadena; los legendarios con destello extra. Se pueden girar a mano o
 *     todas a la vez ("Revelar todo").
 *  4. `done`: resumen de lo obtenido y "Continuar" vuelve al cofre.
 *
 * El inventario vive en su propia pantalla (botón "Inventario").
 * Toda la aleatoriedad y el cobro los hace el SERVIDOR (o la cuenta de prueba
 * en desarrollo); el cliente solo anima el resultado que recibe.
 */
export interface GachaScreenCallbacks {
  onBack: () => void;
  onOpenInventory: () => void;
}

type ChestState = "idle" | "charging" | "burst" | "reveal" | "done";

const CHARGE_MIN_MS = 900;
const BURST_MS: Record<Rarity, number> = { common: 750, epic: 950, legendary: 1500 };
const FLIP_STEP_MS = 230;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class GachaScreen {
  private readonly root: HTMLDivElement;
  private readonly nav = screenNav(() => this.root);
  private readonly coinsEl: HTMLSpanElement;
  private readonly arena: HTMLDivElement;
  private readonly chest: HTMLDivElement;
  private readonly cardsEl: HTMLDivElement;
  private readonly summaryEl: HTMLDivElement;
  private readonly pullsEl: HTMLDivElement;
  private readonly pull1Btn: HTMLButtonElement;
  private readonly pull10Btn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;

  private info: GachaInfo | null = null;
  private coins = 0;
  private hasSession = false;
  private state: ChestState = "idle";
  /** Se incrementa al ocultar/reiniciar: cancela las secuencias en curso. */
  private run = 0;
  private cards: HTMLButtonElement[] = [];
  private current: Pull[] = [];

  constructor(private readonly cb: GachaScreenCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "gacha-screen";
    this.root.className = "select-screen kbg";

    // ── Cabecera: título, monedas e Inventario ──
    const header = document.createElement("div");
    header.className = "kbg-header";
    const title = document.createElement("h1");
    title.className = "select-title kbg-title";
    title.textContent = "Gacha";

    const coinsBar = document.createElement("div");
    coinsBar.className = "kbg-coins";
    coinsBar.setAttribute("aria-live", "polite");
    const icon = document.createElement("span");
    icon.className = "kbg-coins__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🪙";
    this.coinsEl = document.createElement("span");
    this.coinsEl.className = "kbg-coins__value";
    this.coinsEl.textContent = "—";
    const coinsLabel = document.createElement("span");
    coinsLabel.className = "kbg-coins__label";
    coinsLabel.textContent = "monedas";
    coinsBar.append(icon, this.coinsEl, coinsLabel);

    const invBtn = button({ label: "🎒 Inventario", variant: "secondary", onActivate: () => this.cb.onOpenInventory() });
    invBtn.classList.add("kbg-inv-btn");
    keyHint(invBtn, "i", { pad: "y", label: "Inventario" });
    header.append(title, coinsBar, invBtn);
    this.root.appendChild(header);

    // ── Escena: cofre + cartas ──
    this.arena = document.createElement("div");
    this.arena.className = "kbg-arena";
    this.chest = buildChest();
    this.cardsEl = document.createElement("div");
    this.cardsEl.className = "kbg-cards";
    this.cardsEl.setAttribute("aria-live", "polite");
    this.summaryEl = document.createElement("div");
    this.summaryEl.className = "kbg-summary";
    this.summaryEl.setAttribute("role", "status");
    const flash = document.createElement("div");
    flash.className = "kbg-flash";
    flash.setAttribute("aria-hidden", "true");
    this.arena.append(this.chest, this.cardsEl, this.summaryEl, flash);
    this.root.appendChild(this.arena);

    // ── Botones de tirada / continuar ──
    this.pullsEl = document.createElement("div");
    this.pullsEl.className = "kbg-pulls";
    this.pull1Btn = button({ label: "Tirar ×1", variant: "primary", onActivate: () => void this.doPull(1) });
    this.pull1Btn.classList.add("kbg-pull");
    this.pull10Btn = button({ label: "Tirar ×10", variant: "secondary", onActivate: () => void this.doPull(10) });
    this.pull10Btn.classList.add("kbg-pull", "kbg-pull--multi");
    this.nextBtn = button({ label: "Revelar todo", variant: "primary", onActivate: () => this.onNext() });
    this.nextBtn.classList.add("kbg-next");
    this.nextBtn.hidden = true;
    keyHint(this.pull1Btn, "1", { pad: "x", label: "Tirar ×1" });
    keyHint(this.pull10Btn, "0", { pad: "rb", label: "Tirar ×10" });
    keyHint(this.nextBtn, "c", { pad: "start", label: "Continuar" });
    this.pullsEl.append(this.pull1Btn, this.pull10Btn, this.nextBtn);
    this.root.appendChild(this.pullsEl);

    // Probabilidades públicas.
    const odds = document.createElement("div");
    odds.className = "kbg-odds";
    for (const r of RARITY_ORDER) {
      const item = document.createElement("span");
      item.className = `kbg-odds__item rarity-${r}`;
      item.append(gemIcon(r, "kbg-odds__gem"), document.createTextNode(`${RARITY_LABEL[r]} ${RARITY_ODDS[r]}%`));
      odds.appendChild(item);
    }
    this.root.appendChild(odds);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "kbg-status";
    this.statusEl.setAttribute("role", "status");
    this.root.appendChild(this.statusEl);

    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = button({ label: "‹ Atrás", variant: "ghost", onActivate: () => this.cb.onBack() });
    back.classList.add("kb-select__back");
    actions.appendChild(backHint(back));
    this.root.appendChild(actions);

    setLegend(this.root, { accept: "Aceptar" });
    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add("open");
    this.reset();
    this.nav.mount();
    void this.loadAll();
  }

  hide(): void {
    this.run++;
    this.root.classList.remove("open");
    this.nav.unmount();
  }

  /** Vuelve al cofre en reposo (sin cartas). */
  private reset(): void {
    this.run++;
    this.cards = [];
    this.current = [];
    this.cardsEl.replaceChildren();
    this.cardsEl.classList.remove("is-multi");
    this.summaryEl.replaceChildren();
    this.setState("idle");
  }

  private setState(s: ChestState): void {
    this.state = s;
    this.arena.dataset.state = s;
    const choosing = s === "idle";
    this.pull1Btn.hidden = !choosing;
    this.pull10Btn.hidden = !choosing;
    this.nextBtn.hidden = s !== "reveal" && s !== "done";
    const label = this.nextBtn.querySelector(".kb-btn__label");
    if (label) label.textContent = s === "done" ? "Continuar" : "Revelar todo";
    this.updateButtons();
  }

  private get reduced(): boolean {
    return document.documentElement.hasAttribute("data-reduced-motion");
  }

  /** Carga precios y saldo al abrir. */
  private async loadAll(): Promise<void> {
    this.setStatus("Cargando…", true);
    const [info, stats] = await Promise.all([this.info ? Promise.resolve(this.info) : getGachaInfo(), getStats()]);
    if (!info) {
      this.setStatus("No se pudo cargar la tienda. El servidor puede estar despertando.", false);
      return;
    }
    this.info = info;
    setPullLabel(this.pull1Btn, "Tirar ×1", info.singleCost);
    setPullLabel(this.pull10Btn, `Tirar ×${info.multiCount}`, info.multiCost);
    this.hasSession = stats !== null;
    if (!stats) {
      this.coinsEl.textContent = "—";
      this.setStatus("Inicia sesión para tirar y guardar tus tokens.", false);
    } else {
      this.setCoins(stats.coins);
      this.setStatus("", false);
    }
    this.updateButtons();
  }

  private setCoins(value: number): void {
    const from = this.coins;
    this.coins = value;
    // Contador animado (sube o baja) para que se note el gasto.
    if (this.reduced || from === value || !this.coinsEl.isConnected) {
      this.coinsEl.textContent = String(value);
      return;
    }
    const start = performance.now();
    const dur = 600;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / dur);
      this.coinsEl.textContent = String(Math.round(from + (value - from) * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.coinsEl.parentElement?.classList.remove("is-spent");
    void this.coinsEl.parentElement?.offsetWidth;
    if (value < from) this.coinsEl.parentElement?.classList.add("is-spent");
  }

  private async doPull(count: 1 | 10): Promise<void> {
    if (this.state !== "idle" || !this.info) return;
    const run = ++this.run;
    this.setStatus("", false);
    this.setState("charging");

    const [outcome] = await Promise.all([pull(count), wait(this.reduced ? 0 : CHARGE_MIN_MS)]);
    if (run !== this.run) return;

    if (outcome.kind !== "ok") {
      this.setState("idle");
      this.setStatus(
        outcome.kind === "no-session" ? "Inicia sesión para tirar." : outcome.message,
        false,
      );
      return;
    }

    this.setCoins(outcome.coins);
    recordPullSession({ at: Date.now(), cost: outcome.cost, pulls: outcome.pulls });
    this.current = outcome.pulls;

    // Apertura del cofre con el color de la mejor rareza.
    const best = bestRarity(outcome.pulls);
    this.arena.dataset.best = best;
    this.setState("burst");
    await wait(this.reduced ? 0 : BURST_MS[best]);
    if (run !== this.run) return;

    this.dealCards(outcome.pulls);
    this.setState("reveal");
    this.nextBtn.focus();
    if (this.reduced) {
      this.revealAll();
      return;
    }
    // Giro en cadena (cada carta tras la anterior).
    await wait(450);
    for (const c of this.cards) {
      if (run !== this.run) return;
      if (!c.classList.contains("is-flipped")) {
        this.flip(c);
        await wait(this.cards.length > 1 ? FLIP_STEP_MS : 0);
      }
    }
  }

  /** Coloca las cartas boca abajo, saliendo del cofre. */
  private dealCards(pulls: Pull[]): void {
    this.cardsEl.replaceChildren();
    this.cardsEl.classList.toggle("is-multi", pulls.length > 1);
    this.cards = pulls.map((p, i) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = `kbg-card rarity-${p.rarity}`;
      c.style.setProperty("--i", String(i));
      c.setAttribute("aria-label", "Carta boca abajo: pulsa para girarla");
      const inner = document.createElement("span");
      inner.className = "kbg-card__inner";
      const backFace = document.createElement("span");
      backFace.className = "kbg-card__face kbg-card__back";
      backFace.textContent = "?";
      const front = document.createElement("span");
      front.className = "kbg-card__face kbg-card__front";
      const rays = document.createElement("span");
      rays.className = "kbg-card__rays";
      const amount = document.createElement("span");
      amount.className = "kbg-card__amount";
      amount.textContent = `+${p.tokens}`;
      const label = document.createElement("span");
      label.className = "kbg-card__label";
      label.textContent = RARITY_LABEL[p.rarity];
      front.append(rays, gemIcon(p.rarity, "kbg-card__gem"), amount, label);
      inner.append(backFace, front);
      c.appendChild(inner);
      c.addEventListener("click", () => this.flip(c));
      this.cardsEl.appendChild(c);
      return c;
    });
  }

  private flip(c: HTMLButtonElement): void {
    if (c.classList.contains("is-flipped")) return;
    c.classList.add("is-flipped");
    const i = this.cards.indexOf(c);
    const p = this.current[i];
    if (p) c.setAttribute("aria-label", `${RARITY_LABEL[p.rarity]}: ${p.tokens} tokens`);
    if (p?.rarity === "legendary" && !this.reduced) {
      // Destello de pantalla breve para cada legendario.
      this.arena.classList.remove("is-flash");
      void this.arena.offsetWidth;
      this.arena.classList.add("is-flash");
    }
    if (this.cards.every((x) => x.classList.contains("is-flipped"))) this.finish();
  }

  private revealAll(): void {
    for (const c of this.cards) this.flip(c);
  }

  private onNext(): void {
    if (this.state === "reveal") this.revealAll();
    else if (this.state === "done") {
      this.reset();
      this.pull1Btn.focus();
    }
  }

  /** Todas giradas: resumen por rareza. */
  private finish(): void {
    if (this.state === "done") return;
    const totals: Record<Rarity, number> = { common: 0, epic: 0, legendary: 0 };
    for (const p of this.current) totals[p.rarity] += p.tokens;
    this.summaryEl.replaceChildren();
    const title = document.createElement("span");
    title.className = "kbg-summary__title";
    title.textContent = "Has conseguido";
    this.summaryEl.appendChild(title);
    for (const r of RARITY_ORDER) {
      if (!totals[r]) continue;
      const chip = document.createElement("span");
      chip.className = `kbg-summary__chip rarity-${r}`;
      chip.append(gemIcon(r, "kbg-summary__gem"), document.createTextNode(`+${totals[r]} ${RARITY_LABEL[r]}`));
      this.summaryEl.appendChild(chip);
    }
    this.setState("done");
  }

  /** Habilita las tiradas según sesión y saldo. */
  private updateButtons(): void {
    const idle = this.state === "idle";
    const ok = (cost: number): boolean => idle && this.hasSession && this.info !== null && this.coins >= cost;
    setDisabled(this.pull1Btn, !ok(this.info?.singleCost ?? Infinity));
    setDisabled(this.pull10Btn, !ok(this.info?.multiCost ?? Infinity));
  }

  private setStatus(text: string, loading: boolean): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("loading", loading);
    this.statusEl.style.display = text ? "block" : "none";
  }
}

/** Pone en un botón de tirada su texto y el coste (chip de monedas). */
function setPullLabel(btn: HTMLButtonElement, text: string, cost: number): void {
  const label = btn.querySelector(".kb-btn__label") ?? btn;
  const main = document.createElement("span");
  main.className = "kbg-pull__text";
  main.textContent = text;
  const costEl = document.createElement("span");
  costEl.className = "kbg-pull__cost";
  costEl.textContent = `🪙 ${cost}`;
  label.replaceChildren(main, costEl);
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag: string, attrs: Record<string, string>, children: SVGElement[] = []): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.appendChild(c);
  return e;
}

/** Cofre (SVG) con rayos, brillo y chispas alrededor. */
function buildChest(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "kbg-chest";
  wrap.setAttribute("aria-hidden", "true");
  const rays = document.createElement("div");
  rays.className = "kbg-chest__rays";
  const glow = document.createElement("div");
  glow.className = "kbg-chest__glow";
  const sparks = document.createElement("div");
  sparks.className = "kbg-chest__sparks";
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    s.style.setProperty("--a", `${(i / 14) * 360}deg`);
    s.style.setProperty("--d", `${110 + (i % 3) * 40}px`);
    sparks.appendChild(s);
  }

  const art = el("svg", { viewBox: "0 0 200 180", class: "kbg-chest__art" }, [
    el("ellipse", { cx: "100", cy: "166", rx: "74", ry: "9", class: "kbg-chest__shadow" }),
    // Base.
    el("g", { class: "kbg-chest__base" }, [
      el("rect", { x: "28", y: "84", width: "144", height: "74", rx: "8", class: "kbg-chest__wood" }),
      el("rect", { x: "28", y: "84", width: "144", height: "12", class: "kbg-chest__rim" }),
      el("rect", { x: "50", y: "84", width: "12", height: "74", class: "kbg-chest__metal" }),
      el("rect", { x: "138", y: "84", width: "12", height: "74", class: "kbg-chest__metal" }),
      el("rect", { x: "28", y: "146", width: "144", height: "12", rx: "4", class: "kbg-chest__metal" }),
    ]),
    // Luz del interior (visible al abrir).
    el("rect", { x: "34", y: "78", width: "132", height: "10", rx: "4", class: "kbg-chest__inner-light" }),
    // Tapa (gira hacia atrás al abrir).
    el("g", { class: "kbg-chest__lid" }, [
      el("path", { d: "M28 86 V64 Q28 30 100 30 Q172 30 172 64 V86 Z", class: "kbg-chest__wood" }),
      el("path", { d: "M50 86 V40 M150 86 V40", class: "kbg-chest__band" }),
      el("path", { d: "M28 86 V64 Q28 30 100 30 Q172 30 172 64 V86", class: "kbg-chest__edge" }),
      el("rect", { x: "86", y: "70", width: "28", height: "30", rx: "6", class: "kbg-chest__lock" }),
      el("circle", { cx: "100", cy: "84", r: "7", class: "kbg-chest__gem" }),
    ]),
  ]);
  wrap.append(rays, glow, art, sparks);
  return wrap;
}
