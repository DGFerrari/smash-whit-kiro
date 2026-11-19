import { defineConfig } from "vitest/config";

// Entorno por defecto: Node. La simulación (motor determinista) y los módulos
// puros del rediseño (visualPrefs, qualityManager, particlePool, hudModel...)
// no necesitan DOM ni navegador.
//
// Los tests que sí necesitan DOM (componentes de UI, foco, diálogos) optan por
// jsdom archivo a archivo con un comentario en la primera línea:
//
//   // @vitest-environment jsdom
export default defineConfig({
  test: {
    environment: "node",
    // Tests del motor/cliente (tests/ y co-localizados en src/) y del servidor
    // (server/src/**).
    include: [
      "tests/**/*.test.ts",
      "src/**/*.test.ts",
      "server/src/**/*.test.ts",
    ],
  },
});
