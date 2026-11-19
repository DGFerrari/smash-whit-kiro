import type { GameMode } from "../engine/game/world.ts";
import { createLogo } from "./brand/logo.ts";
import { CreditsScreen } from "./creditsScreen.ts";
import { button } from "./design/components.ts";
import { CHANGELOG, formatChangelogDate, type ChangeTag } from "../content/changelog.ts";
import { getMenuNavigator } from "./nav/menuNavigator.ts";
import { keyHint } from "./nav/keyHints.ts";
import { setLegend } from "./nav/legend.ts";
import "./mainMenu.css";

/**
 * Menú principal del juego, en dos fases:
 *  1. TÍTULO: logo provisional + "Press start"; se entra con Enter (o clic).
 *  2. SELECCIÓN: título arriba a la izquierda, lista de modos a la izquierda
 *     (con indicador ">" en el seleccionado), botón Jugar abajo a la derecha, y
 *     la descripción del modo abajo en el centro.
 *
 * Es un overlay DOM. Al pulsar Jugar con un modo jugable elegido, llama a
 * onPlay. La opción "dev" se puede seleccionar pero deshabilita Jugar (no está
 * terminada).
 */
export interface MainMenuCallbacks {
  /** Inicia una partida en el modo dado (siempre se graba el replay). */
  onPlay: (mode: GameMode) => void;
  /** Abrir la lista de repeticiones guardadas. */
  onOpenReplays: () => void;
  /** Abrir el tutorial. */
  onOpenTutorial: () => void;
  /** Abrir la clasificación (ranking). */
  onOpenRanking: () => void;
  /** Abrir los cofres (gacha). */
  onOpenGacha: () => void;
  /** Abrir el online (crear/unirse a una sala P2P). */
  onOpenOnline: () => void;
  /** Iniciar sesión con Google (redirección al servidor). */
  onLogin: () => void;
  /** Cerrar sesión. */
  onLogout: () => void;
  /** Abrir el diálogo para cambiar el apodo. */
  onChangeNickname: () => void;
  /**
   * Abrir los créditos. Opcional: si no se indica, el menú abre su propia
   * pantalla de créditos (`creditsScreen.ts`) encima del menú.
   */
  onOpenCredits?: () => void;
  /**
   * Solo en desarrollo: entrar con la cuenta de prueba local. Si se indica,
   * junto al login aparece el botón "Usuario de prueba".
   */
  onDevLogin?: () => void;
  /** Solo cuenta de prueba: sumar monedas. */
  onDevCoins?: () => void;
  /** Solo cuenta de prueba: borrar su progreso. */
  onDevReset?: () => void;
}

/** Datos del usuario con sesión (para el widget del menú). */
export interface MenuUser {
  /** Apodo que se muestra (editable por el usuario). */
  nickname: string;
  avatarUrl: string | null;
  /** ¿Es la cuenta de prueba local? (etiqueta "PRUEBA" y herramientas). */
  dev?: boolean;
}

/** Valor de una opción del menú: modo jugable, ver replay, tutorial o ranking. */
type MenuOption = GameMode | "replay" | "tutorial" | "ranking" | "gacha" | "online";

/** Inactividad en la selección de modos tras la que se vuelve al título. */
export const IDLE_TO_TITLE_MS = 30_000;

/** Clave de localStorage: ¿el jugador ya ha hecho el tutorial alguna vez? */
const TUTORIAL_DONE_KEY = "smashb.tutorialDone.v1";

/** ¿Se ha completado el tutorial alguna vez? (para el parpadeo del menú). */
export function isTutorialDone(): boolean {
  try {
    if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") return false;
    return localStorage.getItem(TUTORIAL_DONE_KEY) === "1";
  } catch {
    return false;
  }
}
/** Marca el tutorial como completado (deja de parpadear en el menú). */
export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, "1");
  } catch {
    /* localStorage no disponible: no pasa nada, solo seguirá parpadeando. */
  }
}

interface ModeDef {
  value: MenuOption;
  label: string;
  hint: string;
  /** ¿Es jugable? (dev no lo es: deshabilita el botón Jugar). */
  playable: boolean;
  /** Color de acento del modo. */
  accent: string;
}

const MODES: ModeDef[] = [
  {
    value: "versus",
    label: "Singleplayer",
    hint: "Varios jugadores en el mismo teclado (o contra la CPU). Elige personajes y escenario; gana el último en pie.",
    playable: true,
    accent: "var(--color-secondary)",
  },
  {
    value: "online",
    label: "Multiplayer",
    hint: "Juega en vivo contra tus amigos por internet (hasta 4). Crea una sala y comparte el código, o únete con el suyo.",
    playable: true,
    accent: "var(--color-primary)",
  },
  {
    value: "training",
    label: "Entrenamiento",
    hint: "Practica combos y recuperaciones contra un dummy configurable en un escenario con regla de distancias.",
    playable: true,
    accent: "var(--color-success)",
  },
  {
    value: "replay",
    label: "Replay",
    hint: "Tus partidas se guardan solas. Míralas desde la lista (o importa un .json): pausa, velocidad, avance/retroceso y cámara libre.",
    playable: true,
    accent: "var(--color-focus)",
  },
  {
    value: "tutorial",
    label: "Tutorial",
    hint: "Aprende los controles: moverte, saltar, atacar, el escudo y más, completando objetivos.",
    playable: true,
    accent: "var(--color-secondary)",
  },
  {
    value: "ranking",
    label: "Clasificación",
    hint: "Tabla de jugadores: victorias, kills, muertes y monedas. Ordena por cualquier columna y encuentra tu posición.",
    playable: true,
    accent: "var(--color-primary)",
  },
  {
    value: "gacha",
    label: "Gacha",
    hint: "Gasta tus monedas en tiradas y consigue tokens (común, épico o legendario). Tira x1 o x10 con descuento.",
    playable: true,
    accent: "var(--color-danger)",
  },
];

const TAG_LABEL: Record<ChangeTag, string> = { new: "Nuevo", improve: "Mejoras", fix: "Arreglos" };

/** Panel "Novedades": versiones del changelog, la más reciente arriba. */
function buildNewsPanel(): { panel: HTMLElement; list: HTMLElement } {
  const panel = document.createElement("section");
  panel.className = "menu-news";
  panel.setAttribute("aria-labelledby", "menu-news-title");

  const head = document.createElement("header");
  head.className = "menu-news__head";
  const title = document.createElement("h2");
  title.id = "menu-news-title";
  title.className = "menu-news__title";
  title.textContent = "Novedades";
  head.appendChild(title);
  const latest = CHANGELOG[0];
  if (latest) {
    const ver = document.createElement("span");
    ver.className = "menu-news__current";
    ver.textContent = `v${latest.version}`;
    head.appendChild(ver);
  }
  panel.appendChild(head);

  const list = document.createElement("div");
  list.className = "menu-news__list";
  // Región desplazable accesible (AvPág/RePág o LB/RB la desplazan).
  list.setAttribute("role", "region");
  list.setAttribute("aria-label", "Historial de cambios");
  CHANGELOG.forEach((entry, i) => {
    const art = document.createElement("article");
    art.className = `menu-news__entry is-${entry.tag}`;
    if (i === 0) art.classList.add("is-latest");
    const top = document.createElement("div");
    top.className = "menu-news__entry-top";
    const tag = document.createElement("span");
    tag.className = "menu-news__tag";
    tag.textContent = i === 0 ? "Última" : TAG_LABEL[entry.tag];
    const ver = document.createElement("span");
    ver.className = "menu-news__ver";
    ver.textContent = `v${entry.version}`;
    top.append(tag, ver);
    if (entry.date) {
      const date = document.createElement("time");
      date.className = "menu-news__date";
      date.dateTime = entry.date;
      date.textContent = formatChangelogDate(entry.date);
      top.appendChild(date);
    }
    const h = document.createElement("h3");
    h.className = "menu-news__entry-title";
    h.textContent = entry.title;
    const ul = document.createElement("ul");
    ul.className = "menu-news__items";
    for (const item of entry.items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    art.append(top, h, ul);
    list.appendChild(art);
  });
  panel.appendChild(list);
  return { panel, list };
}

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly titlePhase: HTMLDivElement;
  private readonly selectPhase: HTMLDivElement;
  private readonly rows = new Map<MenuOption, HTMLButtonElement>();
  private readonly hintEl: HTMLParagraphElement;
  /** Lista desplazable del panel de novedades. */
  private readonly newsList: HTMLElement;
  /** Logo compartido entre fases: se desliza del centro a arriba-izquierda. */
  private readonly logo: HTMLElement;
  /** Pantalla de créditos propia (si la app no aporta `onOpenCredits`). */
  private credits: CreditsScreen | null = null;
  /** Widget de cuenta (arriba a la derecha): botón de login o chip de usuario. */
  private readonly accountEl: HTMLDivElement;
  private selected: MenuOption | null = null;
  private phase: "title" | "select" = "title";
  /** Desmontaje del Navegador_Menús de la fase visible (R4.9). */
  private unmountNav: (() => void) | null = null;

  constructor(private readonly cb: MainMenuCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "main-menu";

    // Logo ÚNICO compartido: su posición la decide la clase de fase del root,
    // así la transición de centro -> arriba-izquierda es un deslizamiento suave.
    // Logo SVG de KiroBrawl (con respaldo de texto "KiroBrawl", R1.2/R1.9).
    this.logo = createLogo({ className: "menu-logo" });
    this.root.appendChild(this.logo);

    // Widget de cuenta (arriba a la derecha), visible en ambas fases. Arranca
    // mostrando el botón de login; se rellena con setUser() tras consultar la
    // sesión al servidor.
    this.accountEl = document.createElement("div");
    this.accountEl.className = "menu-account";
    this.root.appendChild(this.accountEl);
    this.setUser(null);

    // --- Fase 1: título (solo "Press start"; el logo es el compartido) ---
    this.titlePhase = document.createElement("div");
    this.titlePhase.className = "menu-title-phase";
    const press = document.createElement("div");
    press.className = "menu-press-start";
    press.textContent = "Press start";
    // Enfocable para teclado/gamepad: A (o Enter) entra a la selección.
    press.tabIndex = 0;
    press.setAttribute("role", "button");
    this.titlePhase.appendChild(press);
    this.titlePhase.addEventListener("click", () => this.enterSelect());
    this.root.appendChild(this.titlePhase);

    // --- Fase 2: selección ---
    this.selectPhase = document.createElement("div");
    this.selectPhase.className = "menu-select-phase";

    // Lista de modos (a la izquierda).
    const list = document.createElement("div");
    list.className = "mode-list";
    for (const def of MODES) {
      const row = this.buildModeRow(def);
      this.rows.set(def.value, row);
      list.appendChild(row);
    }
    // "Créditos": abre directamente la pantalla de créditos (R14.3).
    const creditsBtn = button({
      label: "Créditos",
      variant: "ghost",
      onActivate: () => this.openCredits(),
    });
    creditsBtn.classList.add("menu-credits-btn");
    list.appendChild(keyHint(creditsBtn, "c", { pad: "y" }));
    this.selectPhase.appendChild(list);

    // Descripción del modo (abajo, centrada).
    this.hintEl = document.createElement("p");
    this.hintEl.className = "mode-hint";
    this.hintEl.textContent = "Selecciona un modo.";
    this.selectPhase.appendChild(this.hintEl);

    // Panel de novedades (changelog), a la derecha.
    const news = buildNewsPanel();
    this.newsList = news.list;
    this.selectPhase.appendChild(news.panel);

    this.root.appendChild(this.selectPhase);

    // Leyendas: en el título solo "Empezar"; en la selección, Esc vuelve al título.
    setLegend(this.titlePhase, { nav: false, items: [{ key: "enter", pad: "a", label: "Empezar" }] });
    setLegend(this.selectPhase, {
      accept: "Entrar",
      items: [
        { key: "pagedown", pad: "rb", label: "Novedades" },
        { key: "escape", pad: "b", label: "Título" },
      ],
    });
    document.body.appendChild(this.root);

    window.addEventListener("keydown", this.onKey);
    // Clic fuera del chip de usuario: cierra su desplegable.
    document.addEventListener("click", () => this.closeUserMenu());
    // Actividad de ratón/táctil (el teclado y el mando los cuenta el navegador).
    for (const ev of ["pointermove", "pointerdown", "wheel"] as const) {
      window.addEventListener(ev, this.markActivity, { passive: true });
    }
  }

  // ── Inactividad: vuelta a la pantalla de título ─────────────────────────────

  private idleTimer = 0;
  private lastPointerAt = 0;

  private markActivity = (): void => {
    this.lastPointerAt = performance.now();
  };

  private startIdleWatch(): void {
    this.stopIdleWatch();
    this.markActivity();
    this.idleTimer = window.setInterval(() => this.checkIdle(), 1000);
  }

  private stopIdleWatch(): void {
    if (this.idleTimer) window.clearInterval(this.idleTimer);
    this.idleTimer = 0;
  }

  /** Tras `IDLE_TO_TITLE_MS` sin tocar nada en la selección, vuelve al título. */
  private checkIdle(): void {
    if (this.phase !== "select" || !this.root.classList.contains("open")) return;
    // Con otra ventana encima (créditos, apodo, confirmaciones…) no cuenta.
    const active = document.activeElement;
    const elsewhere = active instanceof HTMLElement && active !== document.body && !this.root.contains(active);
    if (this.credits?.isOpen || elsewhere) {
      this.markActivity();
      return;
    }
    const last = Math.max(this.lastPointerAt, getMenuNavigator().lastInputAt());
    if (performance.now() - last >= IDLE_TO_TITLE_MS) this.enterTitle();
  }

  show(): void {
    this.phase = "title";
    this.root.classList.remove("in-select", "mode-chosen");
    this.root.classList.add("open", "in-title");

    // Entramos SIN ningún modo seleccionado.
    this.selected = null;
    for (const row of this.rows.values()) row.classList.remove("selected");
    this.hintEl.textContent = "Selecciona un modo.";
    this.hintEl.style.color = "";

    // Reevaluamos el parpadeo del Tutorial (puede haberse completado ya).
    const tut = this.rows.get("tutorial");
    if (tut) tut.classList.toggle("nudge", !isTutorialDone());

    this.mountNav(this.titlePhase);
  }

  hide(): void {
    this.stopIdleWatch();
    this.credits?.close();
    this.root.classList.remove("open");
    this.unmountNav?.();
    this.unmountNav = null;
  }

  /** Monta el Navegador_Menús sobre la fase visible (sustituye al anterior). */
  private mountNav(root: HTMLElement): void {
    this.unmountNav?.();
    const back = (): void => this.enterTitle();
    const news = (dir: 1 | -1) => (): void => {
      this.newsList.scrollBy({ top: dir * this.newsList.clientHeight * 0.8, behavior: "smooth" });
    };
    this.unmountNav = getMenuNavigator().mount(
      root,
      root === this.selectPhase
        ? {
            hotkeys: { escape: back, backspace: back, pagedown: news(1), pageup: news(-1) },
            padHotkeys: { rb: news(1), lb: news(-1) },
          }
        : {},
    );
  }

  /** Vuelve de la selección a la pantalla de título ("Press start"). */
  private enterTitle(): void {
    if (this.phase === "title") return;
    this.stopIdleWatch();
    this.closeUserMenu();
    this.phase = "title";
    this.root.classList.remove("in-select");
    this.root.classList.add("in-title");
    if (this.root.classList.contains("open")) this.mountNav(this.titlePhase);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.root.classList.contains("open")) return;
    // Con los créditos abiertos, el teclado es del diálogo.
    if (this.credits?.isOpen) return;
    if (e.key !== "Enter") return;
    if (this.phase === "title") {
      e.preventDefault();
      this.enterSelect();
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) {
      const def = MODES.find((m) => this.rows.get(m.value) === active);
      if (def) {
        // Enter sobre un modo: lo elige y juega (sin el clic nativo duplicado).
        e.preventDefault();
        this.select(def);
        this.tryPlay();
        return;
      }
      // Otros botones del menú (Jugar, Créditos, cuenta): clic nativo.
      if (active.matches("button")) return;
    }
    e.preventDefault();
    this.tryPlay();
  };

  /** Abre los créditos (callback de la app o pantalla propia). */
  private openCredits(): void {
    if (this.cb.onOpenCredits) {
      this.cb.onOpenCredits();
      return;
    }
    this.credits ??= new CreditsScreen();
    this.credits.open();
  }

  /** Pasa de la fase título a la de selección. */
  private enterSelect(): void {
    if (this.phase === "select") return;
    this.phase = "select";
    this.root.classList.remove("in-title");
    this.root.classList.add("in-select");
    // Solo la lista de modos (la cuenta queda para ratón/Tab nativo).
    if (this.root.classList.contains("open")) {
      this.mountNav(this.selectPhase);
      this.startIdleWatch();
    }
  }

  private tryPlay(): void {
    if (!this.selected) return;
    const def = MODES.find((m) => m.value === this.selected);
    if (!def || !def.playable) return;
    if (this.selected === "replay") {
      // La opción Replay abre la lista de repeticiones guardadas.
      this.cb.onOpenReplays();
      return;
    }
    if (this.selected === "tutorial") {
      this.cb.onOpenTutorial();
      return;
    }
    if (this.selected === "ranking") {
      this.cb.onOpenRanking();
      return;
    }
    if (this.selected === "gacha") {
      this.cb.onOpenGacha();
      return;
    }
    if (this.selected === "online") {
      this.cb.onOpenOnline();
      return;
    }
    this.cb.onPlay(this.selected as GameMode);
  }

  private buildModeRow(def: ModeDef): HTMLButtonElement {
    // Sin botón "Jugar": activar un modo (clic, Enter o A) entra directamente.
    const btn = button({
      label: def.label,
      variant: "secondary",
      onActivate: () => {
        this.select(def);
        this.tryPlay();
      },
    });
    btn.classList.add("mode-row");
    // Enfocar o pasar el ratón por un modo lo marca y muestra su descripción.
    btn.addEventListener("focus", () => this.select(def));
    btn.addEventListener("pointerenter", () => this.select(def));
    btn.querySelector(".kb-btn__label")?.classList.add("mode-row-label");
    btn.style.setProperty("--accent", def.accent);

    // El Tutorial destaca (clase "nudge": brillo, destello y etiqueta) si el
    // jugador nunca lo ha completado.
    if (def.value === "tutorial") {
      if (!isTutorialDone()) btn.classList.add("nudge");
      const shine = document.createElement("span");
      shine.className = "mode-shine";
      shine.setAttribute("aria-hidden", "true");
      const badge = document.createElement("span");
      badge.className = "mode-nudge-badge";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = "¡Empieza aquí!";
      btn.append(shine, badge);
    }

    // Indicador ">" que aparece solo en el seleccionado.
    const caret = document.createElement("span");
    caret.className = "mode-caret";
    caret.textContent = "❯";
    caret.setAttribute("aria-hidden", "true");
    btn.prepend(caret);
    return btn;
  }

  private select(def: ModeDef): void {
    this.selected = def.value;
    for (const [value, row] of this.rows) {
      row.classList.toggle("selected", value === def.value);
    }
    this.root.style.setProperty("--menu-accent", def.accent);
    this.root.classList.add("mode-chosen");
    this.hintEl.textContent = def.hint;
    this.hintEl.style.color = def.accent;
  }

  /**
   * Actualiza el widget de cuenta: si `user` es null muestra el botón de
   * "Iniciar sesión con Google"; si hay usuario, muestra su avatar + nombre y
   * un botón de cerrar sesión. Lo llama la app tras consultar /api/auth/me.
   */
  setUser(user: MenuUser | null): void {
    this.accountEl.replaceChildren();

    if (!user) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-btn login-btn";
      // Texto a la izquierda y el logo OFICIAL de Google (SVG multicolor) a la
      // derecha. El SVG es el de la marca "Sign in with Google" (inline, así no
      // depende de una petición externa que pueda fallar).
      btn.innerHTML =
        '<span>Iniciar sesión</span>' +
        '<span class="login-g" aria-hidden="true">' +
        '<svg viewBox="0 0 48 48" width="18" height="18">' +
        '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
        '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
        '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
        '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
        "</svg></span>";
      btn.addEventListener("click", () => this.cb.onLogin());
      this.accountEl.appendChild(btn);
      const devLogin = this.cb.onDevLogin;
      if (import.meta.env.DEV && devLogin) {
        const dev = document.createElement("button");
        dev.type = "button";
        dev.className = "menu-btn login-btn login-btn--dev";
        dev.title = "Solo en desarrollo: sesión simulada en este navegador, sin servidor";
        dev.textContent = "🧪 Usuario de prueba";
        dev.addEventListener("click", () => devLogin());
        this.accountEl.appendChild(dev);
      }
      return;
    }

    const chip = document.createElement("div");
    chip.className = "user-chip";

    // El chip es un BOTÓN que despliega un menú (cambiar apodo / cerrar sesión).
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "user-chip-trigger";

    const avatar = document.createElement("div");
    avatar.className = "user-avatar";
    if (user.avatarUrl) {
      const img = document.createElement("img");
      img.src = user.avatarUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer"; // avatares de Google
      avatar.appendChild(img);
    } else {
      avatar.textContent = Array.from(user.nickname)[0]?.toUpperCase() ?? "?";
    }
    trigger.appendChild(avatar);

    const name = document.createElement("span");
    name.className = "user-name";
    name.textContent = user.nickname;
    trigger.appendChild(name);

    if (user.dev) {
      const tag = document.createElement("span");
      tag.className = "user-dev-tag";
      tag.textContent = "PRUEBA";
      tag.title = "Cuenta de prueba local (sin servidor)";
      trigger.appendChild(tag);
    }

    const caret = document.createElement("span");
    caret.className = "user-caret";
    caret.textContent = "▾";
    trigger.appendChild(caret);

    chip.appendChild(trigger);

    // Menú desplegable (oculto hasta pulsar el chip).
    const menu = document.createElement("div");
    menu.className = "user-menu";

    const renameOpt = document.createElement("button");
    renameOpt.type = "button";
    renameOpt.className = "user-menu-item";
    renameOpt.textContent = "Cambiar apodo";
    renameOpt.addEventListener("click", () => {
      this.closeUserMenu();
      this.cb.onChangeNickname();
    });
    menu.appendChild(renameOpt);

    // Herramientas de la cuenta de prueba.
    const devItem = (label: string, fn: (() => void) | undefined): void => {
      if (!user.dev || !fn) return;
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "user-menu-item dev";
      opt.textContent = label;
      opt.addEventListener("click", () => {
        this.closeUserMenu();
        fn();
      });
      menu.appendChild(opt);
    };
    devItem("🧪 +1000 monedas", this.cb.onDevCoins);
    devItem("🧪 Reiniciar datos de prueba", this.cb.onDevReset);

    const logoutOpt = document.createElement("button");
    logoutOpt.type = "button";
    logoutOpt.className = "user-menu-item danger";
    logoutOpt.textContent = "Cerrar sesión";
    logoutOpt.addEventListener("click", () => {
      this.closeUserMenu();
      this.cb.onLogout();
    });
    menu.appendChild(logoutOpt);

    chip.appendChild(menu);
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      chip.classList.toggle("open");
    });

    this.accountEl.appendChild(chip);
  }

  /** Cierra el desplegable del chip de usuario, si está abierto. */
  private closeUserMenu(): void {
    this.accountEl.querySelector(".user-chip")?.classList.remove("open");
  }
}

/**
 * Pantalla de fin de partida (versus): vive en `resultsScreen.ts` (rediseño
 * KiroBrawl). Se re-exporta aquí para mantener los imports existentes.
 */
export {
  MatchOverScreen,
  type FighterResult,
  type MatchOverCallbacks,
} from "./resultsScreen.ts";
