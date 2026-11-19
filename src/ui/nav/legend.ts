/**
 * Leyenda de controles (barra inferior típica de consola: "↑↓←→ Mover ·
 * Enter Aceptar · Esc Volver").
 *
 * La pinta el Navegador_Menús para la raíz superior de su pila:
 *  - Mover + Aceptar (salvo `nav: false`).
 *  - Las entradas extra que la pantalla registre con `setLegend()`.
 *  - Los atajos (`data-kb-hotkey`) visibles y habilitados de la raíz.
 *  - "Cerrar" en diálogos cancelables sin atajo de Escape propio.
 *
 * Solo redibuja si cambia el contenido (firma de texto), así que se puede
 * refrescar a menudo sin coste.
 */
import { keycap, type PadButton } from "./keyHints.ts";
import "./legend.css";

export interface LegendItem {
  /** Tecla (o "arrows" para las flechas). */
  key: string;
  pad?: PadButton;
  label: string;
}

export interface LegendConfig {
  /** Mostrar Mover/Aceptar (por defecto `true`). */
  nav?: boolean;
  /** Texto de "Aceptar" (por defecto "Aceptar"). */
  accept?: string;
  /** Entradas extra (antes de los atajos). Función = se reevalúa al refrescar. */
  items?: LegendItem[] | (() => LegendItem[]);
}

const configs = new WeakMap<HTMLElement, LegendConfig>();

/** Configura la leyenda de una raíz montada en el Navegador_Menús. */
export function setLegend(root: HTMLElement, cfg: LegendConfig): void {
  configs.set(root, cfg);
}

export interface LegendContext {
  root: HTMLElement;
  dialog: boolean;
  mandatory: boolean;
  /** Atajos usables de la raíz (ya filtrados por visibilidad/deshabilitado). */
  hotkeys: HTMLElement[];
}

/** Calcula las entradas de la leyenda (puro salvo la lectura de `dataset`). */
export function legendItems(ctx: LegendContext): LegendItem[] {
  const cfg = configs.get(ctx.root) ?? {};
  const out: LegendItem[] = [];
  if (cfg.nav !== false) {
    out.push({ key: "arrows", pad: "dpad", label: "Mover" });
    out.push({ key: "enter", pad: "a", label: cfg.accept ?? "Aceptar" });
  }
  const extra = typeof cfg.items === "function" ? cfg.items() : cfg.items ?? [];
  out.push(...extra);

  const seen = new Set(out.map((i) => i.key));
  let back: LegendItem | null = null;
  for (const el of ctx.hotkeys) {
    const key = (el.dataset.kbHotkey ?? "").split(" ")[0];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const label = el.dataset.kbHint ?? cleanLabel(el);
    const item: LegendItem = { key, pad: el.dataset.kbPad as PadButton | undefined, label };
    if (key === "escape") back = item;
    else out.push(item);
  }
  if (!back && ctx.dialog && !ctx.mandatory && !seen.has("escape")) {
    back = { key: "escape", pad: "b", label: "Cerrar" };
  }
  if (back) out.push(back);
  return out;
}

/** Texto visible del control, sin la tecla dibujada ni flechas decorativas. */
function cleanLabel(el: HTMLElement): string {
  const label = el.querySelector(".kb-btn__label")?.textContent ?? el.getAttribute("aria-label") ?? el.textContent ?? "";
  return label.replace(/[‹›❯]/g, "").trim();
}

export class ControlLegend {
  private el: HTMLElement | null = null;
  private signature = "";

  constructor(private readonly doc: Document = document) {}

  private ensure(): HTMLElement {
    if (this.el && this.el.isConnected) return this.el;
    const el = this.doc.createElement("div");
    el.id = "kb-legend";
    el.className = "kb-legend";
    el.setAttribute("role", "note");
    el.setAttribute("aria-label", "Controles");
    this.doc.body.appendChild(el);
    this.el = el;
    this.signature = "";
    return el;
  }

  /** Muestra la leyenda de `ctx` (o la oculta con `null`). */
  update(ctx: LegendContext | null): void {
    const items = ctx ? legendItems(ctx) : [];
    const sig = items.map((i) => `${i.key}|${i.pad ?? ""}|${i.label}`).join(";");
    const on = items.length > 0;
    this.doc.body.classList.toggle("kb-legend-on", on);
    if (!on) {
      if (this.el) this.el.hidden = true;
      this.signature = "";
      return;
    }
    const el = this.ensure();
    el.hidden = false;
    if (sig === this.signature) return;
    this.signature = sig;
    el.replaceChildren(
      ...items.map((i) => {
        const row = this.doc.createElement("span");
        row.className = "kb-legend__item";
        const text = this.doc.createElement("span");
        text.className = "kb-legend__label";
        text.textContent = i.label;
        row.append(keycap(i.key, i.pad), text);
        return row;
      }),
    );
  }
}
