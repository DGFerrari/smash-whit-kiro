import {
  getRanking,
  type RankField,
  type RankOrder,
  type RankingData,
  type RankRow,
} from "../net/api.ts";
import { button, panel, tabs } from "./design/components.ts";
import { screenNav } from "./nav/screenNav.ts";
import { backHint } from "./nav/keyHints.ts";
import "./rankingScreen.css";

/**
 * Pantalla de RANKING (clasificación) — estética KiroBrawl.
 *
 * Pestañas (`tabs`) eligen el campo de orden; un botón invierte asc/desc (y
 * las cabeceras de la tabla siguen siendo clicables). La ordenación la hace el
 * SERVIDOR: cada cambio vuelve a pedir `getRanking(sort, order)`, igual que
 * antes. Los tres primeros se muestran en un podio y la fila del propio
 * usuario se resalta; "¿Dónde estoy?" salta a ella.
 */
export interface RankingScreenCallbacks {
  onBack: () => void;
}

/** Columnas de la tabla (las ordenables coinciden con los campos del servidor). */
const COLUMNS: Array<{ field: RankField; label: string }> = [
  { field: "wins", label: "Victorias" },
  { field: "kills", label: "Kills" },
  { field: "deaths", label: "Muertes" },
  { field: "coins", label: "Monedas" },
];

export class RankingScreen {
  private readonly root: HTMLDivElement;
  private readonly nav = screenNav(() => this.root);
  private readonly tabsSlot: HTMLDivElement;
  private readonly orderBtn: HTMLButtonElement;
  private readonly podiumEl: HTMLDivElement;
  private readonly tableWrap: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly whereBtn: HTMLButtonElement;

  private sort: RankField = "wins";
  private order: RankOrder = "desc";
  private data: RankingData | null = null;
  private loading = false;

  constructor(private readonly cb: RankingScreenCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "ranking-screen";
    this.root.className = "select-screen kbr";

    const title = document.createElement("h1");
    title.className = "select-title kbr-title";
    title.textContent = "Clasificación";
    this.root.appendChild(title);

    // Barra superior: pestañas de orden + invertir + "¿Dónde estoy?".
    const topBar = document.createElement("div");
    topBar.className = "kbr-topbar";
    this.tabsSlot = document.createElement("div");
    this.tabsSlot.className = "kbr-tabs";
    topBar.appendChild(this.tabsSlot);

    this.orderBtn = button({ label: "", variant: "secondary", onActivate: () => this.sortBy(this.sort) });
    this.orderBtn.classList.add("kbr-order");
    topBar.appendChild(this.orderBtn);

    this.whereBtn = button({ label: "¿Dónde estoy?", variant: "primary", onActivate: () => this.scrollToMe() });
    this.whereBtn.classList.add("kbr-where");
    this.whereBtn.style.display = "none";
    topBar.appendChild(this.whereBtn);
    this.root.appendChild(topBar);

    // Podio (top 3).
    this.podiumEl = document.createElement("div");
    this.podiumEl.className = "kbr-podium";
    this.root.appendChild(this.podiumEl);

    // Tabla (scrolleable) dentro de un panel + estado.
    this.tableWrap = document.createElement("div");
    this.tableWrap.className = "kbr-table-wrap";
    const tablePanel = panel({ children: [this.tableWrap] });
    tablePanel.classList.add("kbr-panel");
    this.root.appendChild(tablePanel);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "kbr-status";
    this.statusEl.setAttribute("role", "status");
    this.root.appendChild(this.statusEl);

    // Acciones (volver).
    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = button({ label: "‹ Atrás", variant: "ghost", onActivate: () => this.cb.onBack() });
    back.classList.add("kb-select__back");
    actions.appendChild(backHint(back));
    this.root.appendChild(actions);

    this.renderControls();
    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add("open");
    this.nav.mount();
    void this.load();
  }

  hide(): void {
    this.root.classList.remove("open");
    this.nav.unmount();
  }

  /** Pide el ranking al servidor con el sort/order actuales y lo pinta. */
  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.renderControls();
    this.setStatus("Cargando ranking…", true);
    this.tableWrap.replaceChildren();
    this.podiumEl.replaceChildren();

    const data = await getRanking(this.sort, this.order);
    this.loading = false;

    if (!data) {
      this.setStatus(
        "No se pudo cargar el ranking. El servidor puede estar despertando; prueba de nuevo en unos segundos.",
        false,
      );
      return;
    }
    this.data = data;
    if (data.rows.length === 0) {
      this.setStatus("Aún no hay jugadores en la clasificación. ¡Gana una partida!", false);
      return;
    }
    this.setStatus("", false);
    this.renderPodium(data);
    this.renderTable(data);
  }

  /** (Re)construye las pestañas según el orden actual y el texto de invertir. */
  private renderControls(): void {
    this.tabsSlot.replaceChildren(
      tabs({
        tabs: COLUMNS.map((c) => ({ id: c.field, label: c.label })),
        selected: this.sort,
        onChange: (id) => this.sortBy(id as RankField),
      }),
    );
    const label = this.orderBtn.querySelector(".kb-btn__label") ?? this.orderBtn;
    label.textContent = this.order === "desc" ? "▼ Mayor primero" : "▲ Menor primero";
    this.orderBtn.setAttribute("aria-label", this.order === "desc" ? "Orden descendente; invertir" : "Orden ascendente; invertir");
  }

  private setStatus(text: string, loading: boolean): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("loading", loading);
    this.statusEl.style.display = text ? "block" : "none";
  }

  /** Podio con los tres primeros (visual 2º-1º-3º). */
  private renderPodium(data: RankingData): void {
    const top = data.rows.filter((r) => r.rank >= 1 && r.rank <= 3).sort((a, b) => a.rank - b.rank);
    const order = [top[1], top[0], top[2]].filter((r): r is RankRow => !!r);
    const field = COLUMNS.find((c) => c.field === this.sort)!;
    this.podiumEl.replaceChildren(
      ...order.map((row) => {
        const step = document.createElement("div");
        step.className = `kbr-podium__step kbr-podium__step--${row.rank}`;
        if (row.userId === data.myUserId) step.classList.add("me");
        step.appendChild(buildAvatar(row, "kbr-podium__avatar"));
        const name = document.createElement("span");
        name.className = "kbr-podium__name";
        name.textContent = row.nickname;
        const value = document.createElement("span");
        value.className = "kbr-podium__value";
        value.textContent = `${row[this.sort]} ${field.label}`;
        const base = document.createElement("span");
        base.className = "kbr-podium__base";
        base.textContent = medal(row.rank);
        step.append(name, value, base);
        return step;
      }),
    );
  }

  private renderTable(data: RankingData): void {
    const hasSession = !!data.myUserId;
    this.whereBtn.style.display = hasSession && data.myRank ? "" : "none";

    const table = document.createElement("table");
    table.className = "kbr-table";

    // Cabecera: # | Jugador | [columnas ordenables].
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    hr.appendChild(this.th("#", null));
    hr.appendChild(this.th("Jugador", null));
    for (const col of COLUMNS) hr.appendChild(this.th(col.label, col.field));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of data.rows) {
      tbody.appendChild(this.buildRow(row, row.userId === data.myUserId));
    }
    table.appendChild(tbody);

    this.tableWrap.replaceChildren(table);
  }

  /** Celda de cabecera; si `field` no es null, es clicable para ordenar. */
  private th(label: string, field: RankField | null): HTMLTableCellElement {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    if (field) {
      th.classList.add("sortable");
      if (field === this.sort) {
        th.classList.add("active");
        th.setAttribute("aria-sort", this.order === "desc" ? "descending" : "ascending");
        const arrow = document.createElement("span");
        arrow.className = "kbr-arrow";
        arrow.textContent = this.order === "desc" ? " ▼" : " ▲";
        th.appendChild(arrow);
      }
      th.addEventListener("click", () => this.sortBy(field));
    }
    return th;
  }

  private buildRow(row: RankRow, isMe: boolean): HTMLTableRowElement {
    const tr = document.createElement("tr");
    if (isMe) tr.classList.add("me");
    if (row.rank <= 3) tr.classList.add(`top-${row.rank}`);
    tr.dataset.rank = String(row.rank);

    const rankCell = document.createElement("td");
    rankCell.className = "kbr-rank";
    rankCell.textContent = medal(row.rank);
    tr.appendChild(rankCell);

    const player = document.createElement("td");
    player.className = "kbr-player";
    const name = document.createElement("span");
    name.className = "kbr-name";
    name.textContent = row.nickname;
    player.appendChild(buildAvatar(row, "kbr-avatar"));
    player.appendChild(name);
    if (isMe) {
      const you = document.createElement("span");
      you.className = "kbr-you";
      you.textContent = "Tú";
      player.appendChild(you);
    }
    tr.appendChild(player);

    for (const col of COLUMNS) {
      const td = document.createElement("td");
      td.className = "kbr-num";
      if (col.field === this.sort) td.classList.add("active");
      td.textContent = String(row[col.field]);
      tr.appendChild(td);
    }
    return tr;
  }

  /** Cambia el orden: si se pide la columna activa, invierte asc/desc. */
  private sortBy(field: RankField): void {
    if (this.loading) return;
    if (this.sort === field) {
      this.order = this.order === "desc" ? "asc" : "desc";
    } else {
      this.sort = field;
      this.order = "desc";
    }
    void this.load();
  }

  /** Lleva el scroll hasta la fila del usuario y la parpadea un momento. */
  private scrollToMe(): void {
    const me = this.tableWrap.querySelector<HTMLTableRowElement>("tr.me");
    if (me) {
      const reduced = document.documentElement.hasAttribute("data-reduced-motion");
      me.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      me.classList.remove("flash");
      void me.offsetWidth;
      me.classList.add("flash");
    } else if (this.data?.myRank) {
      // El usuario existe pero no está en el top cargado: avisamos su posición.
      this.setStatus(`Tu posición en este orden es la #${this.data.myRank}.`, false);
    }
  }
}

/** Avatar (imagen o inicial). */
function buildAvatar(row: RankRow, cls: string): HTMLSpanElement {
  const avatar = document.createElement("span");
  avatar.className = cls;
  if (row.avatarUrl) {
    const img = document.createElement("img");
    img.src = row.avatarUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    avatar.appendChild(img);
  } else {
    avatar.textContent = Array.from(row.nickname)[0]?.toUpperCase() ?? "?";
  }
  return avatar;
}

/** Medalla para los tres primeros; número para el resto. */
function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return String(rank);
}
