import { FIXED_DT, RULES, WORLD } from "../engine/config.ts";
import { Player } from "../engine/entities/player.ts";
import { World } from "../engine/game/world.ts";
import { KeyboardInput, createInputState, type InputState } from "../core/input.ts";
import { bindings, keyLabel } from "../core/bindings.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import { PauseMenu } from "./pauseMenu.ts";
import { markTutorialDone } from "./mainMenu.ts";

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
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly instrEl: HTMLDivElement;
  private readonly progressEl: HTMLDivElement;
  private readonly taskListEl: HTMLDivElement;
  private readonly doneEl: HTMLDivElement;
  private readonly cheerEl: HTMLDivElement;

  private world: World | null = null;
  private tut: Tutorial | null = null;
  private readonly p1 = new KeyboardInput("p1");
  private readonly p1State = createInputState();
  private readonly dummyState = createInputState();
  private pauseMenu: PauseMenu | null = null;
  private paused = false;

  private objIndex = 0;
  /** Elementos de check de las tareas del objetivo actual. */
  private taskEls: HTMLDivElement[] = [];
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
    this.panel = document.createElement("div");
    this.panel.id = "tutorial-panel";

    this.progressEl = document.createElement("div");
    this.progressEl.className = "tutorial-progress";
    this.panel.appendChild(this.progressEl);

    this.titleEl = document.createElement("div");
    this.titleEl.className = "tutorial-title";
    this.panel.appendChild(this.titleEl);

    this.instrEl = document.createElement("div");
    this.instrEl.className = "tutorial-instr";
    this.panel.appendChild(this.instrEl);

    // Lista de sub-tareas con sus checks.
    this.taskListEl = document.createElement("div");
    this.taskListEl.className = "tutorial-tasks";
    this.panel.appendChild(this.taskListEl);

    // Texto "¡Bien hecho!" al completar un objetivo.
    this.cheerEl = document.createElement("div");
    this.cheerEl.id = "tutorial-cheer";
    this.cheerEl.textContent = "¡Bien hecho!";

    // Cartel grande de "tutorial completado".
    this.doneEl = document.createElement("div");
    this.doneEl.id = "tutorial-done";
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

    if (allDone) {
      // Objetivo completado: "¡Bien hecho!" y, tras un instante, avanzar.
      this.cheer();
      this.advanceTimer = 1.1;
    }
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
    this.progressEl.textContent = `Objetivo ${this.objIndex + 1} / ${OBJECTIVES.length}`;
    this.titleEl.textContent = obj.title;
    this.instrEl.innerHTML = obj.instruction.replace(
      /\{(\w+)\}/g,
      (_m, action: string) => `<b class="tutorial-key">${key(action)}</b>`,
    );

    // Reconstruye la lista de sub-tareas con sus checks (vacíos).
    this.taskListEl.replaceChildren();
    this.taskEls = [];
    this.taskDone = obj.tasks.map(() => false);
    obj.tasks.forEach((task) => {
      const row = document.createElement("div");
      row.className = "tutorial-task";
      const check = document.createElement("span");
      check.className = "tutorial-check";
      check.textContent = "○";
      const label = document.createElement("span");
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
    const check = row.querySelector(".tutorial-check");
    if (check) check.textContent = "✓";
  }
}
