import type { ReplayData } from "../engine/game/replay.ts";
import {
  listReplays,
  deleteReplay,
  importReplay,
  type StoredReplay,
} from "../game/replayStore.ts";
import { characterLore, stageLore } from "../content/lore.ts";
import { createCharacterPortrait, createStagePreview } from "./brand/portraits.ts";
import { button, card } from "./design/components.ts";
import { screenNav } from "./nav/screenNav.ts";
import { backHint, keyHint } from "./nav/keyHints.ts";
import "./replays.css";

/**
 * Pantalla de LISTA de replays guardados en el navegador (rediseño KiroBrawl).
 *
 * A la IZQUIERDA la lista de replays como tarjetas (retratos + personajes +
 * fecha); a la DERECHA el detalle del seleccionado (vista previa y nombre del
 * escenario + tarjetas de jugador con estadísticas). Acciones por replay: Ver
 * (reproducir), Guardar (exportar .json), Borrar. Arriba, Importar (.json) y
 * Volver. Los nombres visibles se resuelven desde los ids guardados (R1.6).
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
  private readonly nav = screenNav(() => this.root);
  private readonly listEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;

  private entries: StoredReplay[] = [];
  private selectedId: string | null = null;

  constructor(private readonly cb: ReplayListCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "replay-list";
    this.root.classList.add("kb-replays");

    // Cabecera.
    const header = document.createElement("div");
    header.className = "rl-header kb-replays__header";
    const title = document.createElement("h2");
    title.className = "rl-title kb-replays__title";
    title.textContent = "Repeticiones";
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "rl-header-actions kb-replays__header-actions";
    actions.appendChild(
      keyHint(
        button({
          label: "Importar .json",
          variant: "secondary",
          onActivate: () => this.fileInput.click(),
        }),
        "i",
        { label: "Importar" },
      ),
    );
    actions.appendChild(
      backHint(button({ label: "‹ Volver", variant: "ghost", onActivate: () => this.cb.onBack() })),
    );
    header.appendChild(actions);
    this.root.appendChild(header);

    // Cuerpo en dos columnas.
    const body = document.createElement("div");
    body.className = "rl-body kb-replays__body";

    this.listEl = document.createElement("div");
    this.listEl.className = "rl-list kb-replays__list";
    this.listEl.setAttribute("aria-label", "Repeticiones guardadas");
    body.appendChild(this.listEl);

    this.detailEl = document.createElement("div");
    this.detailEl.className = "rl-detail kb-replays__detail";
    this.detailEl.setAttribute("aria-live", "polite");
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
    this.nav.mount();
  }

  hide(): void {
    this.root.classList.remove("open");
    this.nav.unmount();
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
      empty.className = "rl-empty kb-replays__empty";
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
    const data = entry.data;
    const ids = characterIds(data);

    // Retratos en miniatura de los personajes implicados.
    const media = document.createElement("div");
    media.className = "kb-replays__item-portraits";
    for (const id of ids) {
      media.appendChild(createCharacterPortrait(id, { decorative: true }));
    }

    const dur = data.result ? ` · ${fmtDuration(data.result.durationSec)}` : "";
    const item = card({
      label: characterNames(data).join("  vs  "),
      subtitle: `${fmtDate(data.recordedAt)}${dur} · ${stageLore(replayStageId(data)).name}`,
      media,
      onActivate: () => {
        this.selectedId = entry.id;
        this.renderList();
        this.renderDetail();
      },
    });
    item.classList.add("kb-replays__item");
    const selected = entry.id === this.selectedId;
    item.classList.toggle("is-selected", selected);
    item.setAttribute("aria-pressed", selected ? "true" : "false");
    return item;
  }

  private renderDetail(): void {
    this.detailEl.replaceChildren();

    const entry = this.entries.find((e) => e.id === this.selectedId) ?? null;
    if (!entry) {
      const hint = document.createElement("div");
      hint.className = "rl-detail-empty kb-replays__empty";
      hint.textContent = "Selecciona una repetición para ver sus detalles.";
      this.detailEl.appendChild(hint);
      return;
    }

    const data = entry.data;

    // Escenario: vista previa + nombre visible resuelto desde el id guardado.
    const stageEl = document.createElement("div");
    stageEl.className = "kb-replays__stage";
    stageEl.appendChild(
      createStagePreview(replayStageId(data), { decorative: true, className: "kb-replays__stage-preview" }),
    );
    const stageText = document.createElement("div");
    stageText.className = "kb-replays__stage-text";
    const stageName = document.createElement("div");
    stageName.className = "kb-replays__stage-name";
    stageName.textContent = stageLore(replayStageId(data)).name;
    stageText.appendChild(stageName);
    const stageTag = document.createElement("div");
    stageTag.className = "kb-replays__stage-tag";
    stageTag.textContent = data.mode === "training" ? "Entrenamiento" : "Batalla";
    stageText.appendChild(stageTag);
    stageEl.appendChild(stageText);
    this.detailEl.appendChild(stageEl);

    // Tarjetas de jugador con estadísticas.
    const cards = document.createElement("div");
    cards.className = "kb-replays__cards";
    if (data.result) {
      for (const f of data.result.fighters) {
        cards.appendChild(this.buildFighterCard(f));
      }
    } else {
      // Replay antiguo sin resumen: mostramos al menos los personajes.
      const note = document.createElement("div");
      note.className = "kb-replays__empty";
      note.textContent =
        "Esta repetición es de una versión anterior y no tiene estadísticas guardadas.";
      cards.appendChild(note);
    }
    this.detailEl.appendChild(cards);

    // Acciones.
    const actions = document.createElement("div");
    actions.className = "kb-replays__detail-actions";
    actions.appendChild(
      keyHint(
        button({ label: "▶ Ver repetición", variant: "primary", onActivate: () => this.cb.onPlay(data) }),
        "p",
        { pad: "x", label: "Ver" },
      ),
    );
    const save = button({
      label: "⭳ Guardar .json",
      variant: "secondary",
      onActivate: () => this.cb.onExport(data),
    });
    save.title = "Exportar esta repetición como archivo";
    actions.appendChild(keyHint(save, "g", { label: "Guardar" }));
    actions.appendChild(
      keyHint(
        button({
          label: "🗑 Borrar",
          variant: "danger",
          onActivate: () => {
            deleteReplay(entry.id);
            this.refresh();
          },
        }),
        "delete",
        { pad: "y", label: "Borrar" },
      ),
    );
    this.detailEl.appendChild(actions);
  }

  private buildFighterCard(f: ReplayDataFighter): HTMLElement {
    const el = document.createElement("div");
    el.className = "kb-replays__fighter";
    el.style.setProperty("--kb-row-color", f.color);
    if (f.isWinner) el.classList.add("is-winner");

    const portrait = document.createElement("div");
    portrait.className = "kb-replays__fighter-portrait";
    portrait.appendChild(createCharacterPortrait(f.character, { decorative: true }));
    el.appendChild(portrait);

    const info = document.createElement("div");
    info.className = "kb-replays__fighter-info";

    const head = document.createElement("div");
    head.className = "kb-replays__fighter-head";
    head.textContent = f.isWinner ? `🏆 ${f.label}` : f.label;
    info.appendChild(head);

    const sub = document.createElement("div");
    sub.className = "kb-replays__fighter-sub";
    sub.textContent = characterLore(f.character).name;
    info.appendChild(sub);

    const rows: Array<[string, string]> = [
      ["Daño infligido", `${Math.round(f.dealt)}%`],
      ["Daño recibido", `${Math.round(f.taken)}%`],
      ["Daño bloqueado", `${Math.round(f.blocked)}%`],
      ["KOs", String(f.kos)],
      ["Muertes", String(f.deaths)],
    ];
    const stats = document.createElement("dl");
    stats.className = "kb-replays__fighter-stats";
    for (const [k, v] of rows) {
      const row = document.createElement("div");
      row.className = "kb-replays__fighter-stat";
      const kEl = document.createElement("dt");
      kEl.textContent = k;
      const vEl = document.createElement("dd");
      vEl.textContent = v;
      row.appendChild(kEl);
      row.appendChild(vEl);
      stats.appendChild(row);
    }
    info.appendChild(stats);
    el.appendChild(info);
    return el;
  }
}

/** Tipo auxiliar: una entrada de fighter del resumen del replay. */
type ReplayDataFighter = NonNullable<ReplayData["result"]>["fighters"][number];

/** Ids de personaje de un replay (desde result o desde characters). */
export function characterIds(data: ReplayData): string[] {
  if (data.result) return data.result.fighters.map((f) => f.character);
  if (data.characters) return [...data.characters];
  return [];
}

/** Nombres visibles de personaje de un replay, resueltos desde los ids (R1.6). */
export function characterNames(data: ReplayData): string[] {
  const ids = characterIds(data);
  if (ids.length === 0) return ["Azul", "Rojo"];
  return ids.map((id) => characterLore(id).name);
}

/**
 * Id de escenario de un replay. Los v1 no lo guardan: se usa el mismo
 * respaldo que el `World` (entrenamiento → training; si no, isla neón).
 */
export function replayStageId(data: ReplayData): string {
  return data.stage ?? (data.mode === "training" ? "training" : "neonIsland");
}

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
