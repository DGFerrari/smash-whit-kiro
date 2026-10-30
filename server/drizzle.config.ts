import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Config de drizzle-kit: de dónde lee el esquema, dónde escribe las migraciones
 * SQL y cómo conecta a la BD para aplicarlas. La URL viene de `.env`
 * (DATABASE_URL); nunca se escribe en el repo.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: (process.env.DATABASE_URL ?? "").replace(/^["']|["']$/g, ""),
  },
});
