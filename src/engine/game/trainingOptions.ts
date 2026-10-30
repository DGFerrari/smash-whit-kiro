import type { AttackDir, AttackKind } from "../combat/attacks.ts";

/**
 * Opciones del DUMMY de entrenamiento que afectan a la SIMULACIÓN (no a la
 * presentación). Viven en el engine porque el `World` las lee para decidir el
 * comportamiento del saco y sus ataques automáticos. La UI (menú de pausa) las
 * ESCRIBE, pero no son estado de navegador: son parte de la simulación.
 *
 * Antes estos campos vivían en `debug/debugState.ts` (capa de UI) y el motor
 * los leía desde allí, lo que acoplaba el engine a la UI. Moverlos aquí rompe
 * ese acoplamiento sin cambiar el comportamiento.
 */

/** Comportamiento del dummy. */
export type DummyBehavior = "free" | "freeze" | "reposition";

/** Ataque que el dummy repite en bucle (null = no ataca). */
export type DummyAttack = { kind: AttackKind; dir: AttackDir } | null;

export interface TrainingOptions {
  /**
   *  - "free": física normal, recibe golpes y knockback.
   *  - "freeze": clavado donde está, inmóvil, ignora el knockback.
   *  - "reposition": recibe golpes, pero si se queda quieto en el suelo unos
   *    segundos vuelve solo al centro del mapa.
   */
  dummyBehavior: DummyBehavior;
  /**
   * Ataque que el dummy debe REPETIR de forma continua. null = no ataca. El
   * World lo ejecuta en bucle: el ligero con un intervalo entre golpes
   * (anti-spam) y el fuerte siempre a carga completa.
   */
  dummyAttack: DummyAttack;
}

/** Instancia global compartida (la UI escribe, el World lee). */
export const trainingOptions: TrainingOptions = {
  dummyBehavior: "free",
  dummyAttack: null,
};
