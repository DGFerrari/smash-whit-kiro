import { FIXED_DT } from "../config.ts";
import { World } from "../game/world.ts";
import { KeyboardInput, createInputState, type InputState } from "../core/input.ts";
import { bindings, keyLabel } from "../core/bindings.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Camera } from "../render/camera.ts";
import { PauseMenu } from "./pauseMenu.ts";
import { markTutorialDone } from "./mainMenu.ts";

/**
 * Pantalla de TUTORIAL: un modo guiado autónomo (con su propio bucle, como el
 * reproductor de replays) que usa el mapa de ENTRENAMIENTO. Presenta objetivos
 * uno a uno con un panel de ayuda; al completar todos, el tutorial termina y se
 * marca como hecho (deja de parpadear en el menú).
 *
 * No toca el GameLoop de combate: reutiliza World (training), KeyboardInput (P1),
 * Camera, Renderer y PauseMenu, igual que ReplayScreen.
 */
export interface TutorialScreenCallbacks {
  onExit: () => void;
}

/** Una etapa del tutorial: título, instrucción y condición de completado. */
interface Objective {
  title: string;
  /** Instrucción (se rellenan {tecla} con la tecla real de P1). */
  instruction: string;
  /** Devuelve true cuando el objetivo se ha cumplido, leyendo el estado. */
  isDone: (t: Tutorial) => boolean;
}

/** Tecla asignada a una acción de P1, legible (para los textos del tutorial). */
function key(action: string): string {
  const arr = (bindings.p1 as Record<string, string[]>)[action];
  return arr && arr[0] ? keyLabel(arr[0]) : "?";
}

export class Tutorial {
  // Estado observable que leen los objetivos (lo actualiza cada paso).
  movedLeft = false;
  movedRight = false;
  jumpsDone = 0;
  airJumpDone = false;
  lightHits = 0;
  heavyHits = 0;
  shieldedOrDodged = 0;

  // Internos de detección.
  private prevOnGround = true;
  private prevDummyTaken = 0;
  private prevShielding = false;
  private prevDodging = false;

  constructor(readonly world: World) {
    this.prevDummyTaken = this.dummyTaken();
  }

  private dummyTaken(): number {
    // Daño recibido acumulado del saco (sobrevive a sus respawns, a diferencia
    // de `damage` que se resetea). Nos sirve para detectar que le pegamos.
    const d = this.world.fighters[1]?.player;
    return d ? d.stats.taken : 0;
  }

  /** Observa el estado tras un paso de física y actualiza los contadores. */
  observe(input: InputState): void {
    const p = this.world.player;

    if (input.moveX < 0) this.movedLeft = true;
    if (input.moveX > 0) this.movedRight = true;

    // Salto: flanco de despegue (estaba en suelo y ahora no, con vel hacia arriba).
    if (this.prevOnGround && !p.onGround && p.vel.y < 0) this.jumpsDone++;
    // Doble salto: pulsó saltar en el aire (airJumpsLeft bajó estando en aire).
    if (!p.onGround && input.jumpPressed && p.airJumpsLeft < 1) this.airJumpDone = true;
    this.prevOnGround = p.onGround;

    // Golpe al dummy: su daño recibido acumulado subió. Clasificamos por el
    // tipo del ataque activo del jugador en ese momento.
    const taken = this.dummyTaken();
    if (taken > this.prevDummyTaken + 0.01) {
      const kind = p.attack?.def.kind;
      if (kind === "heavy") this.heavyHits++;
      else this.lightHits++;
    }
    this.prevDummyTaken = taken;

    // Escudo / esquiva: flanco de activación.
    if (p.shielding && !this.prevShielding) this.shieldedOrDodged++;
    else if (p.dodging && !this.prevDodging) this.shieldedOrDodged++;
    this.prevShielding = p.shielding;
    this.prevDodging = p.dodging;
  }
}

const OBJECTIVES: Objective[] = [
  {
    title: "Moverse",
    instruction: "Muévete a izquierda y derecha con {left} y {right}.",
    isDone: (t) => t.movedLeft && t.movedRight,
  },
  {
    title: "Saltar",
    instruction: "Salta con {jump}. Pulsa en el aire para el doble salto.",
    isDone: (t) => t.jumpsDone >= 1 && t.airJumpDone,
  },
  {
    title: "Ataque ligero",
    instruction: "Golpea al saco con el ataque ligero ({light}) 3 veces.",
    isDone: (t) => t.lightHits >= 3,
  },
  {
    title: "Ataque fuerte",
    instruction: "Mantén {heavy} para cargar y suéltalo para golpear al saco.",
    isDone: (t) => t.heavyHits >= 1,
  },
  {
    title: "Escudo y esquiva",
    instruction: "Usa el escudo con {shield} (en el aire, esquiva).",
    isDone: (t) => t.shieldedOrDodged >= 1,
  },
];

export class TutorialScreen {
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly instrEl: HTMLDivElement;
  private readonly progressEl: HTMLDivElement;
  private readonly doneEl: HTMLDivElement;

  private world: World | null = null;
  private tut: Tutorial | null = null;
  private readonly p1 = new KeyboardInput("p1");
  private readonly p1State = createInputState();
  private readonly dummyState = createInputState();
  private pauseMenu: PauseMenu | null = null;
  private paused = false;

  private objIndex = 0;
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

    // Cartel grande de "completado" (final).
    this.doneEl = document.createElement("div");
    this.doneEl.id = "tutorial-done";
    this.doneEl.textContent = "¡Tutorial completado!";

    document.body.appendChild(this.panel);
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
    this.renderObjective();

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
          if (!this.completed) this.checkObjective();
        }
        // Cuenta atrás tras completar el último objetivo -> salir.
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

  /** Comprueba si el objetivo actual se cumplió; avanza al siguiente. */
  private checkObjective(): void {
    if (!this.tut) return;
    const obj = OBJECTIVES[this.objIndex];
    if (obj && obj.isDone(this.tut)) {
      this.objIndex++;
      if (this.objIndex >= OBJECTIVES.length) {
        this.completed = true;
        this.completeTimer = 2.6;
        this.panel.classList.remove("open");
        this.doneEl.classList.add("show");
      } else {
        this.renderObjective();
      }
    }
  }

  /** Pinta el panel del objetivo actual (rellenando las teclas reales). */
  private renderObjective(): void {
    const obj = OBJECTIVES[this.objIndex];
    if (!obj) return;
    this.progressEl.textContent = `Objetivo ${this.objIndex + 1} / ${OBJECTIVES.length}`;
    this.titleEl.textContent = obj.title;
    this.instrEl.innerHTML = obj.instruction.replace(
      /\{(\w+)\}/g,
      (_m, action: string) => `<b class="tutorial-key">${key(action)}</b>`,
    );
  }
}
