import { defineConfig } from "vitest/config";

// Los tests prueban la SIMULACIÓN (motor determinista), que no necesita DOM ni
// navegador: corren en Node. Si en el futuro hay tests de UI, se puede añadir
// un entorno jsdom por carpeta.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
