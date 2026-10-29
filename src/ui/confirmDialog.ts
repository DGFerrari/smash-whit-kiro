/**
 * Diálogo de confirmación modal, sencillo y reutilizable.
 *
 * Uso: `const ok = await confirmDialog({ title, message, confirmText });`
 * Devuelve true si el usuario confirma, false si cancela (o pulsa Esc / clic
 * fuera). Crea su propio DOM y lo retira al cerrarse.
 */
export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "confirm-overlay";

    const box = document.createElement("div");
    box.className = "confirm-box";

    const title = document.createElement("h3");
    title.className = "confirm-title";
    title.textContent = opts.title;
    box.appendChild(title);

    const msg = document.createElement("p");
    msg.className = "confirm-message";
    msg.textContent = opts.message;
    box.appendChild(msg);

    const actions = document.createElement("div");
    actions.className = "confirm-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "confirm-btn confirm-btn-cancel";
    cancel.textContent = opts.cancelText ?? "Cancelar";
    actions.appendChild(cancel);

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "confirm-btn confirm-btn-ok";
    ok.textContent = opts.confirmText ?? "Aceptar";
    actions.appendChild(ok);

    box.appendChild(actions);
    root.appendChild(box);
    document.body.appendChild(root);

    // Animación de entrada en el siguiente frame.
    requestAnimationFrame(() => root.classList.add("open"));

    const close = (result: boolean): void => {
      window.removeEventListener("keydown", onKey, true);
      root.classList.remove("open");
      // Esperamos a la transición de salida antes de retirar del DOM.
      window.setTimeout(() => root.remove(), 180);
      resolve(result);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };

    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => close(true));
    // Clic en el velo (fuera de la caja) = cancelar.
    root.addEventListener("click", (e) => {
      if (e.target === root) close(false);
    });
    window.addEventListener("keydown", onKey, true);
  });
}
