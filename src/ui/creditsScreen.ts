/**
 * Pantalla de créditos (R14.3, R14.5, R14.7).
 *
 * Diálogo no obligatorio con la lista desplazable del Registro_Créditos
 * (`src/assets/credits.json`). Cada entrada muestra los cinco campos (asset,
 * autor, origen, licencia y URL de la licencia) y la atribución si existe.
 *
 * Navegación: se monta en el Navegador_Menús como diálogo. Cada entrada es
 * enfocable, así que flechas/Tab o la cruceta/stick del gamepad recorren la
 * lista y el foco la desplaza; Escape o el botón B (o "Volver") la cierran y
 * devuelven el foco al control que la abrió.
 */
import creditsData from "../assets/credits.json";
import { button, dialog } from "./design/components.ts";
import { getMenuNavigator, type MenuNavigator } from "./nav/menuNavigator.ts";
import { keyHint } from "./nav/keyHints.ts";

export interface CreditEntry {
  asset: string;
  author: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  files: string[];
  attribution?: string;
  modified: boolean;
}

export const CREDITS: readonly CreditEntry[] = creditsData as CreditEntry[];

/** Nombre legible de los identificadores SPDX usados en el registro. */
const LICENSE_NAMES: Record<string, string> = {
  "OFL-1.1": "SIL Open Font License 1.1",
  "CC0-1.0": "CC0 1.0",
  "Supercell-FCP": "Fan Content Policy de Supercell (uso no comercial de fans)",
  "CC-BY-4.0": "CC BY 4.0",
  MIT: "MIT",
};

function field(dl: HTMLElement, label: string, value: Node | string): void {
  const dt = document.createElement("dt");
  dt.className = "credits-entry__key";
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.className = "credits-entry__value";
  dd.append(value);
  dl.append(dt, dd);
}

function link(url: string, text = url): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = url;
  a.textContent = text;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.className = "credits-entry__link";
  return a;
}

/** Construye la tarjeta de una entrada del registro. */
export function buildCreditEntry(e: CreditEntry): HTMLElement {
  const el = document.createElement("article");
  el.className = "kb-card credits-entry";
  el.tabIndex = 0;
  el.setAttribute("data-kb-focusable", "");

  const h = document.createElement("h3");
  h.className = "credits-entry__name";
  h.textContent = e.asset;
  el.setAttribute("aria-label", e.asset);
  el.appendChild(h);

  const dl = document.createElement("dl");
  dl.className = "credits-entry__fields";
  field(dl, "Autor", e.author);
  field(dl, "Origen", link(e.sourceUrl));
  field(dl, "Licencia", LICENSE_NAMES[e.license] ?? e.license);
  field(dl, "Texto de la licencia", link(e.licenseUrl));
  if (e.attribution) field(dl, "Atribución", e.attribution);
  field(dl, "Modificado", e.modified ? "Sí" : "No");
  el.appendChild(dl);
  return el;
}

export class CreditsScreen {
  private dlg: ReturnType<typeof dialog> | null = null;
  private unmount: (() => void) | null = null;
  private onClosed: (() => void) | null = null;

  constructor(
    private readonly entries: readonly CreditEntry[] = CREDITS,
    private readonly nav: MenuNavigator = getMenuNavigator(),
  ) {}

  get isOpen(): boolean {
    return this.dlg !== null;
  }

  /** Abre la pantalla; `onClosed` se llama al volver (Escape, B o "Volver"). */
  open(onClosed?: () => void): void {
    if (this.dlg) return;
    this.onClosed = onClosed ?? null;

    const list = document.createElement("div");
    list.className = "credits-list";
    list.setAttribute("role", "list");
    for (const e of this.entries) {
      const item = buildCreditEntry(e);
      item.setAttribute("role", "listitem");
      list.appendChild(item);
    }

    const intro = document.createElement("p");
    intro.className = "credits-intro";
    intro.textContent = "Recursos de terceros incluidos en KiroBrawl y sus licencias.";

    // Aviso de contenido de fans (exigido por la Fan Content Policy de Supercell).
    const fan = document.createElement("p");
    fan.className = "credits-fan-notice";
    fan.textContent =
      "Proyecto de fans sin ánimo de lucro. El Primo y Brawl Stars son propiedad de Supercell. " +
      "Este material no es oficial y no está respaldado por Supercell. Para más información, " +
      "consulta la Política de contenido de fans de Supercell: www.supercell.com/fan-content-policy. " +
      "(This material is unofficial and is not endorsed by Supercell. For more information see " +
      "Supercell's Fan Content Policy: www.supercell.com/fan-content-policy.)";

    // Escape ya cierra el diálogo; la tecla solo se dibuja.
    const back = keyHint(
      button({ label: "Volver", variant: "secondary", onActivate: () => this.close() }),
      "escape",
      { hotkey: false },
    );

    const dlg = dialog({
      title: "Créditos",
      body: [intro, fan, list],
      actions: [back],
      onClose: () => this.finish(),
    });
    dlg.el.classList.add("credits-screen");
    this.dlg = dlg;
    dlg.open();
    this.unmount = this.nav.mount(dlg.el, { dialog: true });
  }

  close(): void {
    this.dlg?.close();
  }

  /** Limpieza común tras cerrar el diálogo (por cualquier vía). */
  private finish(): void {
    this.dlg = null;
    const un = this.unmount;
    this.unmount = null;
    un?.();
    const cb = this.onClosed;
    this.onClosed = null;
    cb?.();
  }
}
