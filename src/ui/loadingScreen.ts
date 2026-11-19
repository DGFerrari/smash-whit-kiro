/**
 * Pantalla_Carga de KiroBrawl (R15).
 *
 * - Variante `boot`: logo, porcentaje grande, barra, MB y recursos restantes,
 *   consejo/lore rotatorio.
 * - Variante `match`: además, retratos enfrentados (VS) y vista previa del escenario.
 *
 * El progreso llega de un `LoadHandle` (`onProgress` ≤ 100 ms) y además se
 * sondea `progress()` cada `REFRESH_MS` para garantizar el refresco ≤ 250 ms
 * (R15.6). Con todo en caché, `bind()` pinta el 100 % y resuelve en cuanto el
 * handle termina (R15.13). No decide cuándo ocultarse: lo hace el llamador.
 */
import "./loadingScreen.css";
import type { LoadHandle } from "../assets/assetLoader.ts";
import { formatBytesText, formatRemainingText, type LoadProgress } from "../assets/progress.ts";
import { createLogo } from "./brand/logo.ts";
import { createCharacterPortrait, createStagePreview } from "./brand/portraits.ts";
import { CHARACTER_LORE, STAGE_LORE, characterLore, stageLore } from "../content/lore.ts";
import { panel } from "./design/components.ts";

export const REFRESH_MS = 200;
export const TIP_INTERVAL_MS = 6000;
export const TIP_MAX_CHARS = 200;

const BASE_TIPS: readonly string[] = [
  "Mantén pulsado el ataque especial para cargarlo: cuanto más porcentaje tenga el rival, más lejos saldrá volando.",
  "El escudo se desgasta si lo mantienes demasiado tiempo. Suéltalo a tiempo y castiga.",
  "Tras un golpe fuerte, inclina la dirección para sobrevivir más tiempo fuera del escenario.",
  "Los fragmentos de Aethra mantienen las islas en el aire. Quien los reúna, gobierna el cielo.",
];

/** Recorta a [1, 200] caracteres (R15.11). */
export function clampTip(text: string): string {
  const t = text.trim() || "KiroBrawl";
  const chars = [...t];
  return chars.length <= TIP_MAX_CHARS ? t : chars.slice(0, TIP_MAX_CHARS - 1).join("") + "…";
}

/** Consejos + títulos de personaje + descripciones de escenario, todos ≤ 200 caracteres. */
export function defaultTips(): string[] {
  const out = [...BASE_TIPS];
  for (const c of Object.values(CHARACTER_LORE)) out.push(`${c.name}, ${c.title}.`);
  for (const s of Object.values(STAGE_LORE)) out.push(`${s.name}: ${s.description}`);
  return out.map(clampTip);
}

export interface LoadingScreenOptions {
  variant?: "boot" | "match";
  /** Variante `match`: ids de personaje (se muestran los dos primeros enfrentados). */
  characters?: readonly string[];
  stage?: string;
  tips?: readonly string[];
  tipIntervalMs?: number;
  /** Índice del primer consejo (por defecto, aleatorio). */
  tipStart?: number;
}

export interface LoadingScreen {
  readonly el: HTMLElement;
  update(p: LoadProgress): void;
  /** Sigue el handle hasta que termina; resuelve con el progreso final (100 %). */
  bind(handle: LoadHandle): Promise<LoadProgress>;
  destroy(): void;
}

function div(cls: string, text?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function fighter(id: string, side: "left" | "right"): HTMLElement {
  const wrap = div(`kb-loading__fighter kb-loading__fighter--${side}`);
  const lore = characterLore(id);
  wrap.dataset.character = id;
  wrap.append(
    createCharacterPortrait(id, { decorative: true, className: "kb-loading__portrait" }),
    div("kb-loading__fighter-name", lore.name),
    div("kb-loading__fighter-title", lore.title),
  );
  return wrap;
}

export function createLoadingScreen(opts: LoadingScreenOptions = {}): LoadingScreen {
  const variant = opts.variant ?? "boot";
  const root = div(`kb-loading kb-loading--${variant}`);
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "off");
  root.append(div("kb-loading__lines"));

  const header = div("kb-loading__header");
  header.append(createLogo({ className: "kb-loading__logo" }));
  root.append(header);

  if (variant === "match") {
    const chars = opts.characters ?? [];
    const vs = div("kb-loading__vs");
    if (chars[0]) vs.append(fighter(chars[0], "left"));
    vs.append(div("kb-loading__vs-badge", "VS"));
    if (chars[1]) vs.append(fighter(chars[1], "right"));
    root.append(vs);
    if (opts.stage) {
      const strip = div("kb-loading__stage");
      strip.append(
        createStagePreview(opts.stage, { decorative: true, className: "kb-loading__stage-preview" }),
        div("kb-loading__stage-name", stageLore(opts.stage).name),
      );
      root.append(strip);
    }
  }

  // Progreso
  const progress = div("kb-loading__progress");
  const percentEl = div("kb-loading__percent", "0 %");
  percentEl.setAttribute("aria-hidden", "true");
  const bar = div("kb-loading__bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Progreso de carga");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = div("kb-loading__fill");
  bar.append(fill);
  const meta = div("kb-loading__meta");
  const bytesEl = div("kb-loading__bytes");
  const remainingEl = div("kb-loading__remaining");
  meta.append(bytesEl, remainingEl);
  progress.append(percentEl, bar, meta);
  root.append(progress);

  // Consejo rotatorio (componente panel)
  const tips = (opts.tips && opts.tips.length ? opts.tips : defaultTips()).map(clampTip);
  let tipIdx =
    (opts.tipStart ?? Math.floor(Math.random() * tips.length)) % tips.length;
  const tipText = document.createElement("p");
  tipText.className = "kb-loading__tip-text";
  tipText.textContent = tips[tipIdx];
  const tipPanel = panel({ title: "Consejo", children: [tipText] });
  tipPanel.classList.add("kb-loading__tip");
  root.append(tipPanel);
  const tipTimer = setInterval(() => {
    tipIdx = (tipIdx + 1) % tips.length;
    tipText.textContent = tips[tipIdx];
  }, opts.tipIntervalMs ?? TIP_INTERVAL_MS);

  let lastPercent = -1;
  const timers = new Set<ReturnType<typeof setInterval>>();
  const unsubs = new Set<() => void>();

  function update(p: LoadProgress): void {
    const percent = Math.max(lastPercent, Math.min(100, Math.max(0, Math.floor(p.percent))));
    lastPercent = percent;
    const bytes = formatBytesText(p);
    const remaining = formatRemainingText(p);
    percentEl.textContent = `${percent} %`;
    fill.style.setProperty("--kb-loading-progress", String(percent / 100));
    bar.setAttribute("aria-valuenow", String(percent));
    bar.setAttribute("aria-valuetext", [`${percent} %`, bytes, remaining].filter(Boolean).join(", "));
    bytesEl.textContent = bytes ?? "";
    bytesEl.hidden = bytes === null;
    remainingEl.textContent = remaining;
    root.classList.toggle("kb-loading--complete", percent >= 100);
  }

  function bind(handle: LoadHandle): Promise<LoadProgress> {
    update(handle.progress());
    const unsub = handle.onProgress(update);
    unsubs.add(unsub);
    const poll = setInterval(() => update(handle.progress()), REFRESH_MS);
    timers.add(poll);
    return handle.done.then(() => {
      clearInterval(poll);
      timers.delete(poll);
      unsub();
      unsubs.delete(unsub);
      const final = handle.progress();
      update(final);
      return final;
    });
  }

  function destroy(): void {
    clearInterval(tipTimer);
    for (const t of timers) clearInterval(t);
    for (const u of unsubs) u();
    timers.clear();
    unsubs.clear();
    root.remove();
  }

  update({ bytesLoaded: 0, bytesTotal: null, assetsDone: 0, assetsTotal: 0, percent: 0 });
  return { el: root, update, bind, destroy };
}
