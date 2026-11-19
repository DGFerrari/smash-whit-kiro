/**
 * Enlace mínimo entre una pantalla DOM (que se muestra/oculta con clases) y el
 * Navegador_Menús compartido (R4.9): `mount()` al mostrarse y `unmount()` al
 * ocultarse, para que el navegador nunca se quede con una raíz oculta (y no
 * robe teclas a la partida).
 */
import { getMenuNavigator, type MenuNavigator, type MountOpts } from "./menuNavigator.ts";

export interface ScreenNav {
  mount(opts?: MountOpts): void;
  unmount(): void;
  readonly mounted: boolean;
}

export function screenNav(
  getRoot: () => HTMLElement,
  nav: () => MenuNavigator = getMenuNavigator,
): ScreenNav {
  let unmountFn: (() => void) | null = null;
  return {
    mount(opts) {
      unmountFn?.();
      unmountFn = nav().mount(getRoot(), opts);
    },
    unmount() {
      unmountFn?.();
      unmountFn = null;
    },
    get mounted() {
      return unmountFn !== null;
    },
  };
}
