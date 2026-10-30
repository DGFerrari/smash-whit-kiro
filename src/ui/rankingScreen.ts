import {
  getRanking,
  type RankField,
  type RankOrder,
  type RankingData,
  type RankRow,
} from "../net/api.ts";

/**
 * Pantalla de RANKING (clasificación). Muestra una tabla de jugadores. Las
 * cabeceras de columna reordenan (la ordenación la hace el SERVIDOR: al pulsar,
 * se vuelve a pedir el ranking con el nuevo sort/order). La fila del propio
 * usuario se resalta, y un botón permite saltar a ella.
 *
 * Overlay DOM, como el resto de pantallas. Tiene su propio estado de carga.
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
    this.root.className = "select-screen";

    const title = document.createElement("h1");
    title.className = "select-title";
    title.textContent = "Clasificación";
    this.root.appendChild(title);

    // Barra superior: botón "¿Dónde estoy?" (solo útil con sesión).
    const topBar = document.createElement("div");
    topBar.className = "ranking-topbar";
    this.whereBtn = document.createElement("button");
    this.whereBtn.type = "button";
    this.whereBtn.className = "menu-btn ranking-where";
    this.whereBtn.textContent = "¿Dónde estoy?";
    this.whereBtn.addEventListener("click", () => this.scrollToMe());
    topBar.appendChild(this.whereBtn);
    this.root.appendChild(topBar);

    // Contenedor de la tabla (scrolleable) + estado (cargando / vacío / error).
    this.tableWrap = document.createElement("div");
    this.tableWrap.className = "ranking-table-wrap";
    this.root.appendChild(this.tableWrap);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "ranking-status";
    this.root.appendChild(this.statusEl);

    // Acciones (volver).
    const actions = document.createElement("div");
    actions.className = "select-actions";
    const back = document.createElement("button");
    back.className = "menu-btn select-back";
    back.textContent = "‹ Atrás";
    back.addEventListener("click", () => this.cb.onBack());
    actions.appendChild(back);
    this.root.appendChild(actions);

    document.body.appendChild(this.root);
  }

  show(): void {
    this.root.classList.add("open");
    void this.load();
  }

  hide(): void {
    this.root.classList.remove("open");
  }

  /** Pide el ranking al servidor con el sort/order actuales y lo pinta. */
  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.setStatus("Cargando ranking…", true);
    this.tableWrap.replaceChildren();

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
    this.renderTable(data);
  }

  private setStatus(text: string, loading: boolean): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("loading", loading);
    this.statusEl.style.display = text ? "block" : "none";
  }

  private renderTable(data: RankingData): void {
    const hasSession = !!data.myUserId;
    this.whereBtn.style.display = hasSession && data.myRank ? "" : "none";

    const table = document.createElement("table");
    table.className = "ranking-table";

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
    th.textContent = label;
    if (field) {
      th.classList.add("sortable");
      if (field === this.sort) {
        th.classList.add("active");
        // Flecha según el orden actual.
        const arrow = document.createElement("span");
        arrow.className = "ranking-arrow";
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
    tr.dataset.rank = String(row.rank);

    const rankCell = document.createElement("td");
    rankCell.className = "ranking-rank";
    rankCell.textContent = medal(row.rank);
    tr.appendChild(rankCell);

    const player = document.createElement("td");
    player.className = "ranking-player";
    const avatar = document.createElement("span");
    avatar.className = "ranking-avatar";
    if (row.avatarUrl) {
      const img = document.createElement("img");
      img.src = row.avatarUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      avatar.appendChild(img);
    } else {
      avatar.textContent = Array.from(row.nickname)[0]?.toUpperCase() ?? "?";
    }
    const name = document.createElement("span");
    name.className = "ranking-name";
    name.textContent = row.nickname;
    player.appendChild(avatar);
    player.appendChild(name);
    tr.appendChild(player);

    for (const col of COLUMNS) {
      const td = document.createElement("td");
      td.className = "ranking-num";
      if (col.field === this.sort) td.classList.add("active");
      td.textContent = String(row[col.field]);
      tr.appendChild(td);
    }
    return tr;
  }

  /** Cambia el orden: si se pulsa la columna activa, invierte asc/desc. */
  private sortBy(field: RankField): void {
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
      me.scrollIntoView({ behavior: "smooth", block: "center" });
      me.classList.remove("flash");
      void me.offsetWidth;
      me.classList.add("flash");
    } else if (this.data?.myRank) {
      // El usuario existe pero no está en el top cargado: avisamos su posición.
      this.setStatus(`Tu posición en este orden es la #${this.data.myRank}.`, false);
    }
  }
}

/** Medalla para los tres primeros; número para el resto. */
function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return String(rank);
}
