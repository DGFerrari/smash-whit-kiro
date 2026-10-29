import { getCharacter } from "../game/characters.ts";
import { getStage } from "../game/stages.ts";
import type { ReplayData } from "../game/replay.ts";
import {
  listReplays,
  deleteReplay,
  importReplay,
  type StoredReplay,
} from "../game/replayStore.ts";

/**
 * Pantalla de LISTA de replays guardados en el navegador.
 *
 * Diseño (como pediste): a la IZQUIERDA la lista de replays (fecha + personajes
 * implicados); a la DERECHA el detalle del seleccionado (escenario + tarjetas
 * de jugador con estadísticas). Acciones por replay: Ver (reproducir), Guardar
 * (exportar .json), Borrar. Arriba, Importar (.json) y Volver.
 */
export interface ReplayListCallbacks {
  /** Reproducir el replay elegido. */
  onPlay: (data: ReplayData) => void;
  /** Exportar un replay a archivo .json. */
  onExport: (data: ReplayData) => void;
  /** Importar un archivo .json; devuelve el ReplayData parseado. */
  onImportFile: (file: File) => Promise<ReplayData>;
  /** Volver al menú principal. */
  onBack: () => void;
}

export class ReplayListScreen {
  private readonly root: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;

  private entries: StoredReplay[] = [];
  private selectedId: string | null = null;

  constructor(private readonly cb: ReplayListCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "replay-list";

    // Cabecera.
    const header = document.createElement("div");
    header.className = "rl-header";
    const title = document.createElement("h2");
    title.className = "rl-title";
    title.textContent = "Repeticiones";
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "rl-header-actions";

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "rl-btn";
    importBtn.textContent = "Importar .json";
    importBtn.addEventListener("click", () => this.fileInput.click());
    actions.appendChild(importBtn);

    const back = document.createElement("button");
    back.type = "button";
    back.className = "rl-btn rl-btn-ghost";
    back.textContent = "‹ Volver";
    back.addEventListener("click", () => this.cb.onBack());
    actions.appendChild(back);

    header.appendChild(actions);
    this.root.appendChild(header);

    // Cuerpo en dos columnas.
    const body = document.createElement("div");
    body.className = "rl-body";

    this.listEl = document.createElement("div");
    this.listEl.className = "rl-list";
    body.appendChild(this.listEl);

    this.detailEl = document.createElement("div");
    this.detailEl.className = "rl-detail";
    body.appendChild(this.detailEl);

    this.root.appendChild(body);

    // Selector de archivo oculto para importar.
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "application/json,.json";
    this.fileInput.style.display = "none";
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = "";
      if (file) void this.handleImport(file);
    });
    this.root.appendChild(this.fileInput);

    document.body.appendChild(this.root);
  }

  show(): void {
    this.refresh();
    this.root.classList.add("open");
  }

  hide(): void {
    this.root.classList.remove("open");
  }

  /** Relee del almacén y re-dibuja lista + detalle. */
  private refresh(): void {
    this.entries = listReplays();
    // Mantener selección si sigue existiendo; si no, seleccionar la primera.
    if (!this.entries.some((e) => e.id === this.selectedId)) {
      this.selectedId = this.entries[0]?.id ?? null;
    }
    this.renderList();
    this.renderDetail();
  }

  private async handleImport(file: File): Promise<void> {
    try {
      const data = await this.cb.onImportFile(file);
      const id = importReplay(data);
      this.selectedId = id;
      this.refresh();
    } catch {
      window.alert("No se pudo importar el replay: archivo no válido.");
    }
  }

  private renderList(): void {
    this.listEl.replaceChildren();

    if (this.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rl-empty";
      empty.textContent =
        "No hay repeticiones guardadas todavía. Juega una partida o importa un .json.";
      this.listEl.appendChild(empty);
      return;
    }

    for (const entry of this.entries) {
      this.listEl.appendChild(this.buildListItem(entry));
    }
  }

  private buildListItem(entry: StoredReplay): HTMLElement {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "rl-item";
    if (entry.id === this.selectedId) item.classList.add("selected");
    item.addEventListener("click", () => {
      this.selectedId = entry.id;
      this.renderList();
      this.renderDetail();
    });

    // Fila 1: personajes implicados.
    const chars = this.characterNames(entry.data);
    const who = document.createElement("div");
    who.className = "rl-item-who";
    who.textContent = chars.join("  vs  ");
    item.appendChild(who);

    // Fila 2: fecha + duración.
    const meta = document.createElement("div");
    meta.className = "rl-item-meta";
    const dur = entry.data.result
      ? ` · ${fmtDuration(entry.data.result.durationSec)}`
      : "";
    meta.textContent = `${fmtDate(entry.data.recordedAt)}${dur}`;
    item.appendChild(meta);

    return item;
  }

  private renderDetail(): void {
    this.detailEl.replaceChildren();

    const entry = this.entries.find((e) => e.id === this.selectedId) ?? null;
    if (!entry) {
      const hint = document.createElement("div");
      hint.className = "rl-detail-empty";
      hint.textContent = "Selecciona una repetición para ver sus detalles.";
      this.detailEl.appendChild(hint);
      return;
    }

    const data = entry.data;

    // Escenario (mapa seleccionado).
    const stage = getStage(data.stage);
    const stageEl = document.createElement("div");
    stageEl.className = "rl-stage";
    const stageName = document.createElement("div");
    stageName.className = "rl-stage-name";
    stageName.textContent = stage.name;
    stageEl.appendChild(stageName);
    const stageTag = document.createElement("div");
    stageTag.className = "rl-stage-tag";
    stageTag.textContent =
      data.mode === "training" ? "Entrenamiento" : "Batalla";
    stageEl.appendChild(stageTag);
    this.detailEl.appendChild(stageEl);

    // Tarjetas de jugador con estadísticas.
    const cards = document.createElement("div");
    cards.className = "rl-cards";
    if (data.result) {
      for (const f of data.result.fighters) {
        cards.appendChild(this.buildFighterCard(f));
      }
    } else {
      // Replay antiguo sin resumen: mostramos al menos los personajes.
      const note = document.createElement("div");
      note.className = "rl-detail-empty";
      note.textContent =
        "Esta repetición es de una versión anterior y no tiene estadísticas guardadas.";
      cards.appendChild(note);
    }
    this.detailEl.appendChild(cards);

    // Acciones.
    const actions = document.createElement("div");
    actions.className = "rl-detail-actions";

    const play = document.createElement("button");
    play.type = "button";
    play.className = "rl-btn rl-btn-primary";
    play.textContent = "▶ Ver repetición";
    play.addEventListener("click", () => this.cb.onPlay(data));
    actions.appendChild(play);

    const save = document.createElement("button");
    save.type = "button";
    save.className = "rl-btn";
    save.textContent = "⭳ Guardar .json";
    save.title = "Exportar esta repetición como archivo";
    save.addEventListener("click", () => this.cb.onExport(data));
    actions.appendChild(save);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "rl-btn rl-btn-danger";
    del.textContent = "🗑 Borrar";
    del.addEventListener("click", () => {
      deleteReplay(entry.id);
      this.refresh();
    });
    actions.appendChild(del);

    this.detailEl.appendChild(actions);
  }

  private buildFighterCard(f: ReplayDataFighter): HTMLElement {
    const card = document.createElement("div");
    card.className = "rl-card";
    card.style.borderColor = f.color;
    if (f.isWinner) card.classList.add("winner");

    const head = document.createElement("div");
    head.className = "rl-card-head";
    head.style.color = f.color;
    head.textContent = f.isWinner ? `🏆 ${f.label}` : f.label;
    card.appendChild(head);

    const sub = document.createElement("div");
    sub.className = "rl-card-sub";
    sub.textContent = getCharacter(f.character).name;
    card.appendChild(sub);

    const rows: Array<[string, string]> = [
      ["Daño infligido", `${Math.round(f.dealt)}%`],
      ["Daño recibido", `${Math.round(f.taken)}%`],
      ["Daño bloqueado", `${Math.round(f.blocked)}%`],
      ["KOs", String(f.kos)],
      ["Muertes", String(f.deaths)],
    ];
    const stats = document.createElement("div");
    stats.className = "rl-card-stats";
    for (const [k, v] of rows) {
      const row = document.createElement("div");
      row.className = "rl-card-stat";
      const kEl = document.createElement("span");
      kEl.textContent = k;
      const vEl = document.createElement("span");
      vEl.className = "rl-card-stat-value";
      vEl.textContent = v;
      row.appendChild(kEl);
      row.appendChild(vEl);
      stats.appendChild(row);
    }
    card.appendChild(stats);
    return card;
  }

  /** Nombres de personaje de un replay (desde result o desde characters). */
  private characterNames(data: ReplayData): string[] {
    if (data.result) {
      return data.result.fighters.map((f) => getCharacter(f.character).name);
    }
    if (data.characters) {
      return data.characters.map((c) => getCharacter(c).name);
    }
    return ["Azul", "Rojo"];
  }
}

/** Tipo auxiliar: una entrada de fighter del resumen del replay. */
type ReplayDataFighter = NonNullable<ReplayData["result"]>["fighters"][number];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "fecha desconocida";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
