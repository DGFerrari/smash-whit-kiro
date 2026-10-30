/**
 * Diálogo para cambiar el APODO del usuario. Overlay modal simple: un input con
 * validación en vivo (3–16 caracteres, contados por puntos de código para que
 * un emoji cuente como 1), botón guardar (con estado de carga) y cancelar.
 *
 * `onSave` hace la llamada al servidor y devuelve ok o un mensaje de error, que
 * el diálogo muestra sin cerrarse (para que el usuario corrija). Al guardar con
 * éxito, se cierra solo.
 */
export interface NicknameDialogCallbacks {
  /** Guarda el apodo en el servidor. Devuelve el apodo final o un error. */
  onSave: (nickname: string) => Promise<{ ok: true; nickname: string } | { ok: false; message: string }>;
}

/** Longitud por puntos de código (un emoji cuenta como 1). */
function glyphLength(s: string): number {
  return Array.from(s).length;
}

export class NicknameDialog {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly error: HTMLDivElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly hintEl: HTMLParagraphElement;
  private readonly cancelBtn: HTMLButtonElement;
  private busy = false;
  /** Modo obligatorio (onboarding del primer login): no se puede cancelar. */
  private mandatory = false;

  constructor(private readonly cb: NicknameDialogCallbacks) {
    this.root = document.createElement("div");
    this.root.id = "nickname-dialog";

    const panel = document.createElement("div");
    panel.className = "nickname-panel menu-panel";

    this.titleEl = document.createElement("h2");
    this.titleEl.className = "nickname-title";
    panel.appendChild(this.titleEl);

    this.hintEl = document.createElement("p");
    this.hintEl.className = "nickname-hint";
    panel.appendChild(this.hintEl);

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "nickname-input";
    this.input.maxLength = 64; // tope duro de bytes; la regla real va por glifos
    this.input.addEventListener("input", () => this.validate());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.trySave();
      if (e.key === "Escape" && !this.mandatory) this.close();
    });
    panel.appendChild(this.input);

    this.error = document.createElement("div");
    this.error.className = "nickname-error";
    panel.appendChild(this.error);

    const actions = document.createElement("div");
    actions.className = "nickname-actions";

    this.cancelBtn = document.createElement("button");
    this.cancelBtn.type = "button";
    this.cancelBtn.className = "menu-btn nickname-cancel";
    this.cancelBtn.textContent = "Cancelar";
    this.cancelBtn.addEventListener("click", () => this.close());
    actions.appendChild(this.cancelBtn);

    this.saveBtn = document.createElement("button");
    this.saveBtn.type = "button";
    this.saveBtn.className = "menu-btn nickname-save";
    this.saveBtn.textContent = "Guardar";
    this.saveBtn.addEventListener("click", () => this.trySave());
    actions.appendChild(this.saveBtn);

    panel.appendChild(actions);
    this.root.appendChild(panel);
    // Clic en el fondo cierra (pero no en modo obligatorio ni al guardar).
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root && !this.mandatory) this.close();
    });
    document.body.appendChild(this.root);
  }

  /**
   * Abre el diálogo con el apodo actual precargado.
   * @param mandatory si true (primer login), no se puede cancelar: el usuario
   *   DEBE elegir un apodo. Cambia los textos a modo bienvenida.
   */
  open(current: string, mandatory = false): void {
    this.mandatory = mandatory;
    this.titleEl.textContent = mandatory ? "¡Elige tu apodo!" : "Cambiar apodo";
    this.hintEl.textContent = mandatory
      ? "Es tu primer inicio de sesión. Elige el apodo con el que te verán en partida y en los rankings (3–16 caracteres)."
      : "Entre 3 y 16 caracteres. Se verá en partida y en los rankings.";
    this.cancelBtn.style.display = mandatory ? "none" : "";
    this.input.value = current;
    this.error.textContent = "";
    this.root.classList.add("open");
    this.validate();
    // Foco y selección para editar rápido.
    requestAnimationFrame(() => {
      this.input.focus();
      this.input.select();
    });
  }

  private close(): void {
    if (this.busy || this.mandatory) return;
    this.root.classList.remove("open");
  }

  /** Habilita/inhabilita Guardar según la longitud. */
  private validate(): boolean {
    const len = glyphLength(this.input.value.trim());
    const valid = len >= 3 && len <= 16;
    this.saveBtn.disabled = !valid || this.busy;
    return valid;
  }

  private async trySave(): Promise<void> {
    if (this.busy || !this.validate()) return;
    const value = this.input.value.trim();
    this.busy = true;
    this.saveBtn.disabled = true;
    this.saveBtn.textContent = "Guardando…";
    this.error.textContent = "";

    const res = await this.cb.onSave(value);

    this.busy = false;
    this.saveBtn.textContent = "Guardar";
    this.saveBtn.disabled = false;
    if (res.ok) {
      this.mandatory = false; // ya eligió: deja de ser obligatorio
      this.root.classList.remove("open");
    } else {
      this.error.textContent = res.message;
    }
  }
}
