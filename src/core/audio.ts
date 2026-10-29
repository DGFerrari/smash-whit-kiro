/**
 * Motor de audio sintetizado con la Web Audio API (SIN ficheros de sonido).
 *
 * Todos los efectos se generan al vuelo (osciladores + ruido + envolventes),
 * así no hay que incluir assets. Es un singleton: `audio`. El contexto de audio
 * se crea de forma perezosa en el primer gesto del usuario (los navegadores
 * bloquean el audio hasta entonces), lo que gestiona `unlockOnFirstGesture()`.
 *
 * Volumen global ajustable (Opciones) y mute. Cada efecto es un pequeño
 * "instrumento" para que suene arcade/juguetón, en la línea de un fighter.
 */

export type Sfx =
  | "hit"
  | "hitHeavy"
  | "blocked"
  | "jump"
  | "shield"
  | "dash"
  | "ko"
  | "count"
  | "go"
  | "uiMove"
  | "uiConfirm"
  | "uiBack";

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Volumen 0..1 (persistido). */
  private volume = 0.6;
  private muted = false;

  constructor() {
    const saved = Number(localStorage.getItem("smashb.volume"));
    if (!Number.isNaN(saved) && saved >= 0 && saved <= 1) this.volume = saved;
    this.muted = localStorage.getItem("smashb.muted") === "1";
  }

  /** Engancha listeners para crear el contexto en el primer gesto del usuario. */
  unlockOnFirstGesture(): void {
    const unlock = (): void => {
      this.ensure();
      this.ctx?.resume();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  private ensure(): void {
    if (this.ctx) return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
  }

  getVolume(): number {
    return this.volume;
  }
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem("smashb.volume", String(this.volume));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }
  isMuted(): boolean {
    return this.muted;
  }
  setMuted(m: boolean): void {
    this.muted = m;
    localStorage.setItem("smashb.muted", m ? "1" : "0");
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /**
   * Silenciador temporal (NO el mute del usuario): lo usa el reproductor de
   * replays al re-simular rápido (seek) para no disparar miles de sonidos.
   */
  private silent = false;
  setSilent(s: boolean): void {
    this.silent = s;
  }

  /** Reproduce un efecto. No hace nada si el audio aún no está desbloqueado. */
  play(sfx: Sfx): void {
    if (!this.ctx || !this.master || this.muted || this.silent) return;
    const t = this.ctx.currentTime;
    switch (sfx) {
      case "hit":
        this.blip(t, 420, 0.08, "square", 0.5);
        this.noise(t, 0.06, 0.35);
        break;
      case "hitHeavy":
        this.blip(t, 180, 0.18, "sawtooth", 0.6);
        this.noise(t, 0.14, 0.5);
        break;
      case "blocked":
        this.blip(t, 300, 0.1, "sine", 0.3);
        this.noise(t, 0.05, 0.2);
        break;
      case "jump":
        this.sweep(t, 300, 680, 0.14, "square", 0.3);
        break;
      case "shield":
        this.sweep(t, 500, 760, 0.12, "sine", 0.25);
        break;
      case "dash":
        this.sweep(t, 700, 300, 0.1, "sawtooth", 0.3);
        this.noise(t, 0.08, 0.2);
        break;
      case "ko":
        this.sweep(t, 900, 80, 0.5, "sawtooth", 0.6);
        this.noise(t, 0.3, 0.4);
        break;
      case "count":
        this.blip(t, 520, 0.12, "triangle", 0.45);
        break;
      case "go":
        this.sweep(t, 520, 1040, 0.28, "triangle", 0.5);
        break;
      case "uiMove":
        this.blip(t, 620, 0.05, "square", 0.18);
        break;
      case "uiConfirm":
        this.sweep(t, 540, 900, 0.14, "triangle", 0.3);
        break;
      case "uiBack":
        this.sweep(t, 540, 320, 0.12, "triangle", 0.25);
        break;
    }
  }

  // --- Primitivas de síntesis ------------------------------------------------

  /** Tono corto con envolvente de decaimiento. */
  private blip(
    t: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Tono con barrido de frecuencia (glissando). */
  private sweep(
    t: number,
    from: number,
    to: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Ráfaga de ruido blanco (para el "crunch" de los golpes). */
  private noise(t: number, dur: number, gain: number): void {
    if (!this.ctx || !this.master) return;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(g).connect(this.master);
    src.start(t);
  }
}

/** Instancia global del motor de audio. */
export const audio = new AudioEngine();
