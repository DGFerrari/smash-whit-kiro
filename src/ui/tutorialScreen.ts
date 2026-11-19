import { FIXED_DT, RULES, WORLD } from "../engine/config.ts";
import { Player } from "../engine/entities/player.ts";
import { World } from "../engine/game/world.ts";
import { KeyboardInput, createInputState, type InputState } from "../core/input.ts";
import { bindings, keyLabel } from "../core/bindings.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import { PauseMenu } from "./pauseMenu.ts";
import { markTutorialDone } from "./mainMenu.ts";
import { button, panel, setDisabled } from "./design/components.ts";
import "./tutorial.css";

/** Escapa texto para insertarlo en `innerHTML` (etiquetas de teclas). */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Pantalla de TUTORIAL: un modo guiado autónomo (con su propio bucle, como el
 * reproductor de replays) sobre el mapa de ENTRENAMIENTO. Presenta objetivos
 * por fases; cada objetivo tiene una o varias SUB-TAREAS con su check. Al
 * completar todas las sub-tareas de un objetivo: check + "¡Bien hecho!" y se
 * reinicia al jugador para la siguiente fase. Al terminar todo, se marca como
 * hecho (deja de parpadear en el menú).
 *
 * No toca el GameLoop de combate: reutiliza World (training), KeyboardInput (P1),
 * Camera, Renderer y PauseMenu.
 */
export interface TutorialScreenCallbacks {
  onExit: () => void;
}

/** Tecla asignada a una acción de P1, legible (para los textos del tutorial). */
function key(action: string): string {
  const arr = (bindings.p1 as Record<string, string[]>)[action];
  return arr && arr[0] ? keyLabel(arr[0]) : "?";
}

/** Una sub-tarea de un objetivo: etiqueta + condición de hecho. */
interface Task {
  label: string;
  done: (t: Tutorial) => boolean;
}

/** Un objetivo del tutorial: título, instrucción y sus sub-tareas. */
interface Objective {
  title: string;
  /** Instrucción con {accion} que se reemplaza por la tecla real de P1. */
  instruction: string;
  tasks: Task[];
}

/**
 * Estado observable que leen las condiciones de las tareas. Lo alimenta
 * `observe()` tras cada paso de física. Los contadores por dirección/carga
 * permiten las sub-tareas de ataques.
 */
export class Tutorial {
  movedLeft = false;
  movedRight = false;
  jumpDone = false;
  airJumpDone = false;

  /** Golpes LIGEROS conectados por dirección. */
  readonly light = { neutral: false, side: false, up: false, down: false };
  /** Golpes FUERTES conectados por nivel de carga. */
  heavyWeak = false; // fuerte con carga baja
  heavyFull = false; // fuerte con carga (casi) máxima

  shieldedOrDodged = false;

  /** ¿Ha activado el modo furia alguna vez? */
  furyActivated = false;
  /** ¿Ha derrotado (KO) al saco con un fuerte estando en furia? */
  furyKo = false;

  private prevOnGround = true;
  private prevDummyTaken = 0;
  private prevDummyDeaths = 0;

  constructor(readonly world: World) {
    this.prevDummyTaken = this.dummyTaken();
    this.prevDummyDeaths = this.dummyDeaths();
  }

  private get dummy() {
    return this.world.fighters[1]?.player ?? null;
  }
  private dummyTaken(): number {
    return this.dummy?.stats.taken ?? 0;
  }
  private dummyDeaths(): number {
    return this.dummy?.stats.deaths ?? 0;
  }

  observe(input: InputState): void {
    const p = this.world.player;

    if (input.moveX < 0) this.movedLeft = true;
    if (input.moveX > 0) this.movedRight = true;

    if (this.prevOnGround && !p.onGround && p.vel.y < 0) this.jumpDone = true;
    if (!p.onGround && input.jumpPressed && p.airJumpsLeft < 1) this.airJumpDone = true;
    this.prevOnGround = p.onGround;

    if (p.furyActive) this.furyActivated = true;

    // Golpe al saco: su daño recibido acumulado subió. Clasificamos por el
    // ataque activo del jugador (dirección + carga) en ese instante.
    const taken = this.dummyTaken();
    if (taken > this.prevDummyTaken + 0.01 && p.attack) {
      const { kind, dir } = p.attack.def;
      if (kind === "light") {
        this.light[dir] = true;
      } else {
        // charge 0..1: flojo si <0.35, a tope si >=0.8.
        if (p.attack.charge >= 0.8) this.heavyFull = true;
        else if (p.attack.charge < 0.35) this.heavyWeak = true;
      }
    }
    this.prevDummyTaken = taken;

    // KO del saco con un fuerte estando en furia: detectamos que el saco murió
    // (sus muertes acumuladas suben) mientras el jugador está en furia y acaba
    // de conectar un fuerte.
    const deaths = this.dummyDeaths();
    if (deaths > this.prevDummyDeaths) {
      if (p.furyActive && (p.attack?.def.kind === "heavy" || this.recentHeavy)) {
        this.furyKo = true;
      }
    }
    this.prevDummyDeaths = deaths;

    // Recordar si hubo un fuerte hace poco (el KO puede llegar 1-2 pasos
    // después del golpe, cuando el saco cruza la blast zone).
    if (p.attack?.def.kind === "heavy") this.recentHeavyTimer = 18;
    else if (this.recentHeavyTimer > 0) this.recentHeavyTimer--;

    if (p.shielding || p.dodging) this.shieldedOrDodged = true;
  }

  private recentHeavyTimer = 0;
  private get recentHeavy(): boolean {
    return this.recentHeavyTimer > 0;
  }
}

const OBJECTIVES: Objective[] = [
  {
    title: "Moverse",
    instruction: "Muévete a izquierda y derecha con {left} y {right}.",
    tasks: [
      { label: "Ir a la izquierda", done: (t) => t.movedLeft },
      { label: "Ir a la derecha", done: (t) => t.movedRight },
    ],
  },
  {
    title: "Saltar",
    instruction: "Salta con {jump}. Pulsa otra vez en el aire para el doble salto.",
    tasks: [
      { label: "Saltar", done: (t) => t.jumpDone },
      { label: "Doble salto (en el aire)", done: (t) => t.airJumpDone },
    ],
  },
  {
    title: "Ataques ligeros",
    instruction:
      "Golpea al saco con el ligero ({light}) en cada dirección. Apunta con {up}/{down} o muévete para el lateral.",
    tasks: [
      { label: "Ligero neutral", done: (t) => t.light.neutral },
      { label: "Ligero lateral", done: (t) => t.light.side },
      { label: "Ligero arriba", done: (t) => t.light.up },
      { label: "Ligero abajo", done: (t) => t.light.down },
    ],
  },
  {
    title: "Ataques fuertes",
    instruction:
      "Mantén {heavy} para cargar. Un toque rápido = fuerte flojo; mantenerlo hasta el tope = fuerte potente.",
    tasks: [
      { label: "Fuerte poco cargado", done: (t) => t.heavyWeak },
      { label: "Fuerte cargado a tope", done: (t) => t.heavyFull },
    ],
  },
  {
    title: "Escudo y esquiva",
    instruction: "Usa el escudo con {shield} (en el aire es una esquiva).",
    tasks: [{ label: "Escudar o esquivar", done: (t) => t.shieldedOrDodged }],
  },
  {
    title: "Habilidad especial: Furia",
    instruction:
      "Al infligir daño cargas tu FURIA. Cuando se llene se activa sola y multiplica tu daño: ¡remata al saco con un fuerte estando en furia!",
    tasks: [
      { label: "Activar la furia (haz daño)", done: (t) => t.furyActivated },
      { label: "Derrotar al saco con un fuerte en furia", done: (t) => t.furyKo },
    ],
  },
];

export class TutorialScreen {
  private readonly panel: HTMLElement;
  private readonly stepNumEl: HTMLSpanElement;
  private readonly stepTotalEl: HTMLSpanElement;
  private readonly titleEl: HTMLDivElement;
  private readonly instrEl: HTMLDivElement;
  private readonly progressEl: HTMLDivElement;
  private readonly taskListEl: HTMLUListElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly doneEl: HTMLDivElement;
  private readonly cheerEl: HTMLDivElement;
  /** Objetivos ya completados (al volver a ellos con "Anterior" no se re-avanza). */
  private objDone: boolean[] = OBJECTIVES.map(() => false);

  private world: World | null = null;
  private tut: Tutorial | null = null;
  private readonly p1 = new KeyboardInput("p1");
  private readonly p1State = createInputState();
  private readonly dummyState = createInputState();
  private pauseMenu: PauseMenu | null = null;
  private paused = false;

  private objIndex = 0;
  /** Elementos de check de las tareas del objetivo actual. */
  private taskEls: HTMLLIElement[] = [];
  private taskDone: boolean[] = [];

  /** Transición entre objetivos: >0 = mostrando "¡Bien hecho!" y reiniciando. */
  private advanceTimer = 0;
  private completed = false;
  private completeTimer = 0;

  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly camera: Camera,
    private readonly cb: TutorialScreenCallbacks,
  ) {
    // Cabecera: número de paso en fuente display + "de N".
    const head = document.createElement("div");
    head.className = "kb-tut__head";
    const step = document.createElement("div");
    step.className = "kb-tut__step";
    this.stepNumEl = document.createElement("span");
    this.stepNumEl.className = "kb-tut__step-num";
    this.stepTotalEl = document.createElement("span");
    this.stepTotalEl.className = "kb-tut__step-total";
    step.append(this.stepNumEl, this.stepTotalEl);

    this.titleEl = document.createElement("div");
    this.titleEl.className = "kb-tut__title";
    this.titleEl.setAttribute("aria-live", "polite");
    head.append(step, this.titleEl);

    // Barra de progreso segmentada: un segmento por objetivo.
    this.progressEl = document.createElement("div");
    this.progressEl.className = "kb-tut__progress";
    this.progressEl.setAttribute("role", "progressbar");
    this.progressEl.setAttribute("aria-label", "Progreso del tutorial");
    this.progressEl.setAttribute("aria-valuemin", "0");
    this.progressEl.setAttribute("aria-valuemax", String(OBJECTIVES.length));
    for (let i = 0; i < OBJECTIVES.length; i++) {
      const seg = document.createElement("span");
      seg.className = "kb-tut__seg";
      this.progressEl.appendChild(seg);
    }

    this.instrEl = document.createElement("div");
    this.instrEl.className = "kb-tut__instr";

    // Lista de sub-tareas con sus checks.
    this.taskListEl = document.createElement("ul");
    this.taskListEl.className = "kb-tut__tasks";

    // Anterior / Siguiente: navegan entre objetivos. Se desenfocan tras usarse
    // para que Espacio/Enter sigan yendo a la partida y no al botón.
    this.prevBtn = button({
      label: "Anterior",
      variant: "secondary",
      onActivate: () => {
        this.prevBtn.blur();
        this.goTo(this.objIndex - 1);
      },
    });
    this.nextBtn = button({
      label: "Siguiente",
      variant: "primary",
      onActivate: () => {
        this.nextBtn.blur();
        this.goTo(this.objIndex + 1);
      },
    });
    const nav = document.createElement("div");
    nav.className = "kb-tut__nav";
    nav.append(this.prevBtn, this.nextBtn);

    this.panel = panel({ children: [head, this.progressEl, this.instrEl, this.taskListEl, nav] });
    this.panel.id = "kb-tutorial";
    this.panel.classList.add("kb-tut");
    this.panel.setAttribute("aria-label", "Tutorial");

    // Texto "¡Bien hecho!" al completar un objetivo.
    this.cheerEl = document.createElement("div");
    this.cheerEl.className = "kb-tut-cheer";
    this.cheerEl.setAttribute("aria-live", "polite");
    this.cheerEl.textContent = "¡Bien hecho!";

    // Cartel grande de "tutorial completado".
    this.doneEl = document.createElement("div");
    this.doneEl.className = "kb-tut-done";
    this.doneEl.textContent = "¡Tutorial completado!";

    document.body.appendChild(this.panel);
    document.body.appendChild(this.cheerEl);
    document.body.appendChild(this.doneEl);
  }

  start(): void {
    this.world = new World("training", undefined, {
      characters: ["blue", "sandbag"],
      stage: "training",
    });
    this.tut = new Tutorial(this.world);
    this.objIndex = 0;
    this.objDone = OBJECTIVES.map(() => false);
    this.completed = false;
    this.completeTimer = 0;
    this.advanceTimer = 0;
    this.paused = false;

    this.camera.clearCinematic();
    this.camera.resize(this.renderer.cssWidth, this.renderer.cssHeight);
    this.camera.snapTo(this.world);

    this.p1.attach();

    this.pauseMenu = new PauseMenu({
      mode: "training",
      onOpen: () => {
        this.paused = true;
      },
      onClose: () => {
        this.paused = false;
      },
      onQuitToMenu: () => this.exit(),
    });

    this.panel.classList.add("open");
    this.doneEl.classList.remove("show");
    this.cheerEl.classList.remove("show");
    this.buildObjective();

    this.lastTime = performance.now();
    this.accumulator = 0;
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.frame);
  }

  private exit(): void {
    cancelAnimationFrame(this.rafId);
    this.p1.detach();
    this.panel.classList.remove("open");
    this.doneEl.classList.remove("show");
    this.cheerEl.classList.remove("show");
    this.camera.clearCinematic();
    if (this.pauseMenu) {
      this.pauseMenu.destroy();
      this.pauseMenu = null;
    }
    this.cb.onExit();
  }

  private frame = (now: number): void => {
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25;

    if (this.world && this.tut) {
      if (!this.paused) {
        this.accumulator += frameTime;
        let guard = 0;
        while (this.accumulator >= FIXED_DT && guard < 10) {
          this.p1.sample(this.p1State);
          this.world.step([this.p1State, this.dummyState], FIXED_DT);
          this.tut.observe(this.p1State);
          this.accumulator -= FIXED_DT;
          guard++;
          if (!this.completed && this.advanceTimer <= 0) this.checkTasks();
        }

        // Transición "¡Bien hecho!" entre objetivos.
        if (this.advanceTimer > 0) {
          this.advanceTimer -= frameTime;
          if (this.advanceTimer <= 0) this.advanceObjective();
        }

        // Cuenta atrás tras completar el tutorial entero -> salir.
        if (this.completed) {
          this.completeTimer -= frameTime;
          if (this.completeTimer <= 0) {
            markTutorialDone();
            this.exit();
            return;
          }
        }
      }

      this.camera.follow(this.world);
      this.renderer.render(this.world, this.camera, this.accumulator / FIXED_DT);
    }

    this.rafId = requestAnimationFrame(this.frame);
  };

  /** Comprueba el estado de cada sub-tarea del objetivo actual. */
  private checkTasks(): void {
    if (!this.tut) return;
    const obj = OBJECTIVES[this.objIndex];
    if (!obj) return;

    let allDone = true;
    obj.tasks.forEach((task, i) => {
      const done = task.done(this.tut!);
      if (done && !this.taskDone[i]) {
        this.taskDone[i] = true;
        this.markTaskDone(i);
      }
      if (!done) allDone = false;
    });

    // Objetivo completado por primera vez: "¡Bien hecho!" y, tras un instante,
    // avanzar. Si se volvió a un objetivo ya hecho con "Anterior", se queda.
    if (allDone && !this.objDone[this.objIndex]) {
      this.objDone[this.objIndex] = true;
      this.renderProgress();
      this.cheer();
      this.advanceTimer = 1.1;
    }
  }

  /** Salta manualmente a otro objetivo (botones Anterior/Siguiente). */
  private goTo(index: number): void {
    if (this.completed || index < 0 || index >= OBJECTIVES.length || index === this.objIndex) return;
    this.advanceTimer = 0;
    this.cheerEl.classList.remove("show");
    this.objIndex = index;
    this.resetPlayer();
    this.buildObjective();
  }

  /** Actualiza segmentos de progreso, número de paso y estado de los botones. */
  private renderProgress(): void {
    const n = OBJECTIVES.length;
    this.stepNumEl.textContent = String(this.objIndex + 1).padStart(2, "0");
    this.stepTotalEl.textContent = `/ ${String(n).padStart(2, "0")}`;
    const segs = this.progressEl.children;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      seg.classList.toggle("is-done", this.objDone[i] === true);
      seg.classList.toggle("is-current", i === this.objIndex);
    }
    const doneCount = this.objDone.filter(Boolean).length;
    this.progressEl.setAttribute("aria-valuenow", String(doneCount));
    this.progressEl.setAttribute("aria-valuetext", `Objetivo ${this.objIndex + 1} de ${n}`);
    setDisabled(this.prevBtn, this.objIndex <= 0);
    setDisabled(this.nextBtn, this.objIndex >= n - 1);
  }

  /** Muestra el texto de ánimo al completar un objetivo. */
  private cheer(): void {
    this.cheerEl.classList.remove("show");
    void this.cheerEl.offsetWidth; // reinicia la animación
    this.cheerEl.classList.add("show");
  }

  /** Pasa al siguiente objetivo (o completa el tutorial), reiniciando al jugador. */
  private advanceObjective(): void {
    this.objIndex++;
    if (this.objIndex >= OBJECTIVES.length) {
      this.completed = true;
      this.completeTimer = 2.6;
      this.panel.classList.remove("open");
      this.doneEl.classList.add("show");
      return;
    }
    this.resetPlayer();
    this.buildObjective();
  }

  /**
   * Reinicia al jugador (y al saco) sobre el suelo, listo para la siguiente
   * fase. Los colocamos a ras de suelo (como el spawn inicial) en vez de en el
   * punto de reaparición flotante, para que no caigan ni queden descolocados.
   */
  private resetPlayer(): void {
    if (!this.world) return;
    const groundY = WORLD.groundY - Player.bodyHeight - 2;
    const p = this.world.player;
    p.respawn(RULES.respawnX, groundY);
    // La barra de furia NO se conserva entre fases salvo en el apartado de
    // furia, donde queremos que el jugador la cargue él mismo.
    p.furyMeter = 0;
    p.furyTimer = 0;
    const dummy = this.world.fighters[1]?.player;
    if (dummy) dummy.respawn(RULES.respawnX + 150, groundY);
  }

  /** Construye el panel + lista de tareas del objetivo actual. */
  private buildObjective(): void {
    const obj = OBJECTIVES[this.objIndex];
    if (!obj) return;
    this.renderProgress();
    this.titleEl.textContent = obj.title;
    this.instrEl.innerHTML = obj.instruction.replace(
      /\{(\w+)\}/g,
      (_m, action: string) => `<kbd class="kb-tut__key">${escapeHtml(key(action))}</kbd>`,
    );

    // Reconstruye la lista de sub-tareas con sus checks (vacíos).
    this.taskListEl.replaceChildren();
    this.taskEls = [];
    this.taskDone = obj.tasks.map(() => false);
    obj.tasks.forEach((task) => {
      const row = document.createElement("li");
      row.className = "kb-tut__task";
      const check = document.createElement("span");
      check.className = "kb-tut__check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "";
      const label = document.createElement("span");
      label.className = "kb-tut__task-label";
      label.textContent = task.label;
      row.appendChild(check);
      row.appendChild(label);
      this.taskListEl.appendChild(row);
      this.taskEls.push(row);
    });
  }

  /** Marca visualmente una sub-tarea como completada (check verde + animación). */
  private markTaskDone(i: number): void {
    const row = this.taskEls[i];
    if (!row) return;
    row.classList.add("done");
    row.setAttribute("aria-label", `${row.textContent ?? ""}: completado`);
    const check = row.querySelector(".kb-tut__check");
    if (check) check.textContent = "✓";
  }
}
