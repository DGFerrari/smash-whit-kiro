/**
 * Modelo puro del HUD de combate (R5). Sin DOM ni canvas: convierte la lectura
 * del Estado_Simulación en paneles por jugador y calcula las animaciones
 * (sacudida del porcentaje, rotura de vidas) en función de `now` (ms).
 *
 * `percentHud.ts` lo consume para dibujar; las pruebas lo usan directamente.
 */
import { characterLore } from "../content/lore.ts";

/** Daño al que el porcentaje alcanza el color de peligro (R5.4). */
export const DANGER_DAMAGE = 150;
/** Duración de la sacudida y escala del porcentaje (R5.2: 100–300 ms). */
export const SHAKE_MS = 220;
/** Duración de la rotura de un icono de vida (R5.5: 200–600 ms). */
export const LIFE_BREAK_MS = 400;
/** Carga máxima de furia en el Estado_Simulación (`Player.furyMeter` ∈ [0,1]). */
export const FURY_MAX = 1;
/** Ancho máximo de una columna de panel (R5.8). */
export const PANEL_MAX_W = 360;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Parámetro de color del daño: 0 = neutro, 1 = peligro (monótono, fijo ≥ 150 %). */
export function damageT(damage: number): number {
  if (!Number.isFinite(damage)) return damage > 0 ? 1 : 0;
  return clamp(damage / DANGER_DAMAGE, 0, 1);
}

/** Texto del porcentaje: entero seguido de "%". */
export function percentText(damage: number): string {
  const n = Number.isFinite(damage) ? Math.max(0, Math.round(damage)) : 0;
  return `${n}%`;
}

export interface HudFighterInput {
  /** Etiqueta corta del combatiente (P1, CPU…). */
  label: string;
  color: string;
  /** Id de personaje para el nombre visible y el retrato. */
  characterId?: string;
  damage: number;
  /** Vidas restantes; -1 = sin medidor (p. ej. saco). */
  lives: number;
  fury?: number;
  furyActive?: boolean;
  furyRemaining?: number;
}

export type FuryState = "charging" | "active";

export interface HudPanel {
  label: string;
  color: string;
  characterId?: string;
  /** Nombre visible (lore) o, si no hay id, la etiqueta. */
  name: string;
  percentText: string;
  /** Parámetro de interpolación neutro→peligro. */
  t: number;
  /** ¿Se muestra el medidor de vidas? */
  showLives: boolean;
  /** Indicadores de vida activos (uno por vida restante). */
  livesActive: number;
  /** Retrato atenuado (0 vidas). */
  portraitDimmed: boolean;
  /** Relleno de la barra de furia [0..1]. */
  furyFill: number;
  furyState: FuryState;
}

export function buildHudPanel(f: HudFighterInput): HudPanel {
  const showLives = f.lives >= 0;
  const livesActive = showLives ? Math.max(0, Math.floor(f.lives)) : 0;
  const active = !!f.furyActive;
  const furyFill = active
    ? clamp(f.furyRemaining ?? 1, 0, 1)
    : clamp((f.fury ?? 0) / FURY_MAX, 0, 1);
  return {
    label: f.label,
    color: f.color,
    characterId: f.characterId,
    name: f.characterId ? characterLore(f.characterId).name : f.label,
    percentText: percentText(f.damage),
    t: damageT(f.damage),
    showLives,
    livesActive,
    portraitDimmed: showLives && livesActive === 0,
    furyFill,
    furyState: active ? "active" : "charging",
  };
}

export function buildHudPanels(fighters: readonly HudFighterInput[]): HudPanel[] {
  return fighters.map(buildHudPanel);
}

// ---------------------------------------------------------------------------
// Reparto en columnas (R5.8)
// ---------------------------------------------------------------------------

export interface HudColumn {
  x: number;
  w: number;
}

/**
 * `n` columnas iguales (ancho máx. 360 px) centradas en `screenW` con margen
 * lateral y hueco entre paneles: nunca se solapan ni salen de la pantalla.
 */
export function layoutColumns(n: number, screenW: number, margin = 24, gap = 16): HudColumn[] {
  if (n <= 0) return [];
  const avail = Math.max(0, screenW - 2 * margin - (n - 1) * gap);
  const w = Math.min(PANEL_MAX_W, avail / n);
  const total = n * w + (n - 1) * gap;
  const start = (screenW - total) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: start + i * (w + gap), w }));
}

// ---------------------------------------------------------------------------
// Animaciones
// ---------------------------------------------------------------------------

export interface ShakeFrame {
  offsetX: number;
  offsetY: number;
  scale: number;
  /** Intensidad del pulso de color [0..1] (1 al inicio, 0 al final). */
  pulse: number;
  done: boolean;
}

const REST: ShakeFrame = { offsetX: 0, offsetY: 0, scale: 1, pulse: 0, done: true };

/**
 * Fotograma de la sacudida `elapsed` ms después del último aumento. Al final
 * (p = 1) la escala es 1 y el desplazamiento 0. Con Movimiento_Reducido solo
 * hay pulso de color (escala 1, sin desplazamiento).
 */
export function shakeFrame(elapsed: number, reducedMotion = false, amplitude = 6): ShakeFrame {
  if (!(elapsed >= 0) || elapsed >= SHAKE_MS) return REST;
  const p = elapsed / SHAKE_MS;
  const k = 1 - p;
  if (reducedMotion) return { offsetX: 0, offsetY: 0, scale: 1, pulse: k, done: false };
  return {
    offsetX: amplitude * Math.sin(elapsed * 0.19) * k,
    offsetY: amplitude * 0.5 * Math.cos(elapsed * 0.23) * k,
    scale: 1 + 0.25 * k * k,
    pulse: k,
    done: false,
  };
}

export interface LifeBreak {
  /** Índice del icono perdido (0 = primero). */
  index: number;
  start: number;
}

interface SlotState {
  damage: number;
  lives: number;
  shakeStart: number | null;
  breaks: LifeBreak[];
}

/**
 * Detecta aumentos de daño (reinicia la sacudida, R5.3) y pérdidas de vida
 * (rotura del icono perdido, R5.5) comparando con el fotograma anterior.
 */
export class HudAnimTracker {
  private slots: SlotState[] = [];

  update(fighters: readonly Pick<HudFighterInput, "damage" | "lives">[], now: number): void {
    if (fighters.length !== this.slots.length) {
      this.slots = fighters.map((f) => ({ damage: f.damage, lives: f.lives, shakeStart: null, breaks: [] }));
      return;
    }
    fighters.forEach((f, i) => {
      const s = this.slots[i];
      if (f.damage > s.damage) s.shakeStart = now;
      if (s.lives >= 0 && f.lives >= 0 && f.lives < s.lives) {
        for (let k = Math.max(0, Math.floor(f.lives)); k < Math.floor(s.lives); k++) {
          s.breaks.push({ index: k, start: now });
        }
      }
      s.breaks = s.breaks.filter((b) => now - b.start < LIFE_BREAK_MS);
      if (s.shakeStart !== null && now - s.shakeStart >= SHAKE_MS) s.shakeStart = null;
      s.damage = f.damage;
      s.lives = f.lives;
    });
  }

  shake(i: number, now: number, reducedMotion = false): ShakeFrame {
    const s = this.slots[i];
    if (!s || s.shakeStart === null) return REST;
    return shakeFrame(now - s.shakeStart, reducedMotion);
  }

  /** Roturas en curso con su progreso [0..1). */
  breaks(i: number, now: number): { index: number; p: number }[] {
    const s = this.slots[i];
    if (!s) return [];
    return s.breaks
      .map((b) => ({ index: b.index, p: (now - b.start) / LIFE_BREAK_MS }))
      .filter((b) => b.p >= 0 && b.p < 1);
  }

  reset(): void {
    this.slots = [];
  }
}
