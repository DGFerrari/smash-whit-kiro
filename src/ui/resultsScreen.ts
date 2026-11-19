import { characterLore } from "../content/lore.ts";
import { createCharacterPortrait } from "./brand/portraits.ts";
import { CharacterPreview3D } from "./characterPreview3d.ts";
import type { CharacterId } from "../engine/game/characters.ts";
import { button, type ButtonVariant } from "./design/components.ts";
import { screenNav } from "./nav/screenNav.ts";
import { backHint, keyHint } from "./nav/keyHints.ts";
import "./results.css";

/**
 * Pantalla de fin de partida (versus) rediseñada: primero un "FINISH"
 * dramático y luego la pantalla de victoria con el retrato grande del ganador,
 * "¡VICTORIA!" en la tipografía display con líneas de velocidad, una tabla de
 * resultados (daño infligido/recibido/bloqueado, KOs, muertes y nota global) y
 * los botones Revancha / Guardar repetición / Menú.
 *
 * Solo cambia la presentación: las acciones (callbacks) y la API pública
 * (`showFinish`, `show`, `showRewardLoading`, `setReward`, `hideReward`,
 * `hide`) son las mismas de antes.
 */
export interface FighterResult {
  label: string;
  color: string;
  /** Id estable del personaje (para retrato y nombre visible). Opcional. */
  character?: string;
  dealt: number;
  taken: number;
  blocked: number;
  kos: number;
  deaths: number;
  isWinner: boolean;
}

export interface MatchOverCallbacks {
  onRematch: () => void;
  onMenu: () => void;
  /** Ir a la lista de repeticiones (la partida ya quedó guardada). */
  onViewReplays: () => void;
}

export class MatchOverScreen {
  private readonly root: HTMLDivElement;
  private readonly nav = screenNav(() => this.root);
  private readonly finishEl: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly heroEl: HTMLDivElement;
  private readonly portraitEl: HTMLDivElement;
  /** Ganador celebrando en 3D. */
  private readonly celebrate = new CharacterPreview3D({ state: "celebrate", turntable: false, className: "kb-results__canvas" });
  private readonly titleEl: HTMLHeadingElement;
  private readonly winnerNameEl: HTMLDivElement;
  private readonly tableBody: HTMLTableSectionElement;
  /** Fila de monedas ganadas (solo en partidas que puntúan). */
  private readonly rewardEl: HTMLDivElement;
  private finishTimer = 0;

  constructor(private readonly cb: MatchOverCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "match-over";
    this.root.classList.add("kb-results");

    // Cartel "FINISH" que aparece primero.
    this.finishEl = document.createElement("div");
    this.finishEl.className = "finish-text kb-results__finish";
    this.finishEl.textContent = "FINISH";
    this.root.appendChild(this.finishEl);

    // Panel de resultados (aparece tras el FINISH).
    this.panel = document.createElement("div");
    this.panel.className = "kb-results__panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");

    // ── Héroe: ráfaga + líneas de velocidad + retrato + título ──
    this.heroEl = document.createElement("div");
    this.heroEl.className = "kb-results__hero";
    const burst = document.createElement("div");
    burst.className = "kb-results__burst";
    burst.setAttribute("aria-hidden", "true");
    const lines = document.createElement("div");
    lines.className = "kb-results__speedlines";
    lines.setAttribute("aria-hidden", "true");
    this.heroEl.appendChild(burst);
    this.heroEl.appendChild(lines);

    this.portraitEl = document.createElement("div");
    this.portraitEl.className = "kb-results__portrait";
    this.heroEl.appendChild(this.portraitEl);

    const heading = document.createElement("div");
    heading.className = "kb-results__heading";
    this.titleEl = document.createElement("h1");
    this.titleEl.className = "kb-results__title";
    this.titleEl.id = "kb-results-title";
    heading.appendChild(this.titleEl);
    this.winnerNameEl = document.createElement("div");
    this.winnerNameEl.className = "kb-results__winner";
    heading.appendChild(this.winnerNameEl);
    this.heroEl.appendChild(heading);
    this.panel.setAttribute("aria-labelledby", this.titleEl.id);
    this.panel.appendChild(this.heroEl);

    // ── Tabla de resultados ──
    const table = document.createElement("table");
    table.className = "kb-results__table";
    const caption = document.createElement("caption");
    caption.className = "kb-results__caption";
    caption.textContent = "Resultados";
    table.appendChild(caption);
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const h of ["Jugador", "Nota", "Daño infligido", "Daño recibido", "Daño bloqueado", "KOs", "Muertes"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = h;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    this.tableBody = document.createElement("tbody");
    table.appendChild(this.tableBody);
    this.panel.appendChild(table);

    // Fila de RECOMPENSA (monedas ganadas). Oculta por defecto; se muestra solo
    // en partidas que puntúan (versus con sesión). Empieza en "cargando".
    this.rewardEl = document.createElement("div");
    this.rewardEl.className = "match-reward kb-results__reward";
    this.rewardEl.setAttribute("aria-live", "polite");
    this.panel.appendChild(this.rewardEl);

    // ── Acciones ──
    const actions = document.createElement("div");
    actions.className = "kb-results__actions";
    actions.appendChild(
      keyHint(
        actionButton("Revancha", "Misma config", "↻", "primary", () => this.cb.onRematch()),
        "r",
        { pad: "x" },
      ),
    );
    // La partida se guarda sola; este botón lleva a la lista de repeticiones.
    actions.appendChild(
      keyHint(
        actionButton("Guardar repetición", "Guardada · ver lista", "▶", "secondary", () =>
          this.cb.onViewReplays(),
        ),
        "v",
        { pad: "y", label: "Repeticiones" },
      ),
    );
    actions.appendChild(
      backHint(actionButton("Menú", "Salir de la partida", "⌂", "ghost", () => this.cb.onMenu()), "Menú"),
    );
    this.panel.appendChild(actions);

    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
  }

  /** Muestra SOLO el cartel "FINISH" (durante la cámara lenta del remate). */
  showFinish(): void {
    this.root.classList.add("open");
    this.panel.classList.remove("show");
    this.finishEl.classList.remove("show");
    void this.finishEl.offsetWidth;
    this.finishEl.classList.add("show");
  }

  /** Muestra la pantalla de victoria tras el FINISH. */
  show(winnerLabel: string, winnerColor: string, results: FighterResult[]): void {
    this.root.classList.add("open");
    this.finishEl.classList.remove("show");
    this.build(winnerLabel, winnerColor, results);
    this.hideReward(); // por defecto sin recompensa; la app la activa si procede
    this.panel.classList.add("show");
    this.nav.mount();
  }

  /** Oculta la fila de recompensa (partidas que no puntúan). */
  hideReward(): void {
    this.rewardEl.classList.remove("show", "loading");
    this.rewardEl.replaceChildren();
  }

  /** Estado "enviando partida al servidor" (spinner + texto). */
  showRewardLoading(): void {
    this.rewardEl.classList.add("show", "loading");
    this.rewardEl.replaceChildren();
    const spin = document.createElement("span");
    spin.className = "match-reward-spinner kb-results__spinner";
    spin.setAttribute("aria-hidden", "true");
    const txt = document.createElement("span");
    txt.textContent = "Guardando resultado…";
    this.rewardEl.appendChild(spin);
    this.rewardEl.appendChild(txt);
  }

  /**
   * Muestra el resultado del envío: monedas ganadas, o un aviso si no puntuó
   * (sin sesión / error). `coins` es null cuando no hubo recompensa.
   */
  setReward(message: string, coins: number | null): void {
    this.rewardEl.classList.remove("loading");
    this.rewardEl.classList.add("show");
    this.rewardEl.replaceChildren();
    if (coins !== null) {
      const amount = document.createElement("span");
      amount.className = "match-reward-coins kb-results__coins";
      amount.textContent = `+${coins}`;
      const icon = document.createElement("span");
      icon.className = "match-reward-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "🪙";
      const label = document.createElement("span");
      label.textContent = message;
      this.rewardEl.appendChild(amount);
      this.rewardEl.appendChild(icon);
      this.rewardEl.appendChild(label);
    } else {
      const label = document.createElement("span");
      label.className = "match-reward-note kb-results__note";
      label.textContent = message;
      this.rewardEl.appendChild(label);
    }
  }

  private build(winnerLabel: string, winnerColor: string, results: FighterResult[]): void {
    const isDraw = winnerLabel === "Empate";
    const winner = results.find((r) => r.isWinner);

    this.titleEl.textContent = isDraw ? "¡EMPATE!" : "¡VICTORIA!";
    this.panel.style.setProperty("--kb-winner", winnerColor);
    this.heroEl.classList.toggle("is-draw", isDraw);

    // Nombre del ganador: etiqueta del jugador + nombre visible del personaje.
    const charName = winner?.character ? characterLore(winner.character).name : "";
    this.winnerNameEl.textContent = isDraw
      ? "Nadie se lleva la victoria"
      : charName && charName !== winnerLabel
        ? `${winnerLabel} · ${charName}`
        : winnerLabel;

    // Retrato grande del ganador (si conocemos su personaje).
    this.portraitEl.replaceChildren();
    if (!isDraw && winner?.character) {
      this.portraitEl.appendChild(
        createCharacterPortrait(winner.character, { decorative: true }),
      );
      // Celebración del ganador en 3D sobre el retrato (R11.9); si no hay
      // WebGL, el retrato queda como respaldo.
      this.celebrate.setCharacter(winner.character as CharacterId, winnerColor);
      this.portraitEl.appendChild(this.celebrate.canvas);
      this.portraitEl.dataset.preview = this.celebrate.available ? "3d" : "fallback";
      this.celebrate.start();
      this.portraitEl.hidden = false;
    } else {
      this.celebrate.stop();
      this.portraitEl.hidden = true;
    }

    // Tabla: ganador primero; el resto por daño infligido.
    const sorted = [...results].sort(
      (a, b) => Number(b.isWinner) - Number(a.isWinner) || b.dealt - a.dealt,
    );
    this.tableBody.replaceChildren();
    sorted.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.className = "kb-results__row";
      if (r.isWinner) tr.classList.add("is-winner");
      tr.style.setProperty("--kb-row-color", r.color);
      tr.style.animationDelay = r.isWinner ? "0.1s" : `${0.5 + i * 0.12}s`;

      const who = document.createElement("th");
      who.scope = "row";
      who.className = "kb-results__who";
      const dot = document.createElement("span");
      dot.className = "kb-results__dot";
      dot.setAttribute("aria-hidden", "true");
      who.appendChild(dot);
      const name = document.createElement("span");
      name.textContent = r.isWinner ? `🏆 ${r.label}` : r.label;
      who.appendChild(name);
      if (r.character) {
        const ch = document.createElement("span");
        ch.className = "kb-results__char";
        ch.textContent = characterLore(r.character).name;
        who.appendChild(ch);
      }
      tr.appendChild(who);

      const cells = [
        grade(r),
        `${Math.round(r.dealt)}%`,
        `${Math.round(r.taken)}%`,
        `${Math.round(r.blocked)}%`,
        String(r.kos),
        String(r.deaths),
      ];
      cells.forEach((v, ci) => {
        const td = document.createElement("td");
        if (ci === 0) td.className = "kb-results__grade";
        td.textContent = v;
        tr.appendChild(td);
      });
      this.tableBody.appendChild(tr);
    });
    window.clearTimeout(this.finishTimer);
  }

  hide(): void {
    window.clearTimeout(this.finishTimer);
    this.celebrate.stop();
    this.root.classList.remove("open");
    this.panel.classList.remove("show");
    this.finishEl.classList.remove("show");
    this.nav.unmount();
  }
}

/** Botón de acción del post-partida: componente `button` + icono y subtítulo. */
function actionButton(
  label: string,
  sub: string,
  icon: string,
  variant: ButtonVariant,
  onActivate: () => void,
): HTMLButtonElement {
  const el = button({ label, variant, onActivate });
  el.classList.add("kb-results__action");
  const i = document.createElement("span");
  i.className = "kb-results__action-icon";
  i.setAttribute("aria-hidden", "true");
  i.textContent = icon;
  el.insertBefore(i, el.firstChild);
  const s = document.createElement("span");
  s.className = "kb-results__action-sub";
  s.textContent = sub;
  el.appendChild(s);
  return el;
}

/** Nota global simple a partir de las stats (no es ciencia, es sabor). */
function grade(r: FighterResult): string {
  const score = r.dealt + r.kos * 40 + r.blocked * 0.5 - r.taken * 0.6 - r.deaths * 25;
  if (score >= 220) return "S";
  if (score >= 150) return "A";
  if (score >= 90) return "B";
  if (score >= 40) return "C";
  return "D";
}
