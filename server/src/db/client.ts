import pkg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

const { Pool } = pkg;

/**
 * Conexión a Postgres (Neon) mediante el driver `pg` (TCP), que es lo adecuado
 * para un servidor Node de larga duración (Render). Neon exige SSL.
 *
 * Exponemos un único `db` (Drizzle) para todo el servidor. El `schema` se pasa
 * para tener consultas tipadas y relaciones.
 */
export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
