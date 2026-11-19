/**
 * Diálogo de confirmación modal, sencillo y reutilizable.
 *
 * Uso: `const ok = await confirmDialog({ title, message, confirmText });`
 * Devuelve true si el usuario confirma, false si cancela (Esc / botón B / clic
 * en el velo). Se construye con `dialog()` del Sistema_Diseño (velo + trampa de
 * foco vía Navegador_Menús, R4.6) y se retira del DOM al cerrarse.
 */
import { button, dialog } from "./design/components.ts";
import { getMenuNavigator } from "./nav/menuNavigator.ts";
import "./dialogs.css";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    let unmount: (() => void) | null = null;

    const msg = document.createElement("p");
    msg.className = "kb-confirm__message";
    msg.textContent = opts.message;

    const cancel = button({
      label: opts.cancelText ?? "Cancelar",
      variant: "secondary",
      onActivate: () => finish(false),
    });
    cancel.classList.add("kb-confirm__cancel");

    const ok = button({
      label: opts.confirmText ?? "Aceptar",
      variant: "primary",
      onActivate: () => finish(true),
    });
    ok.classList.add("kb-confirm__ok");

    const dlg = dialog({
      title: opts.title,
      body: [msg],
      actions: [cancel, ok],
      // Escape / B (o cualquier cierre sin elección) = cancelar.
      onClose: () => {
        const un = unmount;
        unmount = null;
        un?.();
        resolve(result);
      },
    });
    dlg.el.classList.add("kb-confirm");

    function finish(value: boolean): void {
      result = value;
      dlg.close();
    }

    // Clic en el velo (fuera de la caja) = cancelar.
    dlg.el.addEventListener("click", (e) => {
      if (e.target === dlg.el) finish(false);
    });

    dlg.open();
    unmount = getMenuNavigator().mount(dlg.el, { dialog: true });
    // Mismo comportamiento de teclado que antes: Enter confirma por defecto.
    ok.focus();
  });
}
