import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "drizzle-orm";
import { env } from "./env.ts";
import { db } from "./db/client.ts";
import { authRoutes } from "./auth/routes.ts";

/**
 * Backend de smash-B (Fase 2+).
 *
 * Ya conecta a Postgres (Neon) vía Drizzle. En los siguientes pasos:
 *  - login con Google (OAuth) usando la tabla `users`,
 *  - puntos y ranking (validando replays con el motor compartido).
 *
 * Config por variables de entorno (nunca secretos en el repo): ver .env.example.
 */

const app = new Hono();

// CORS: el cliente (localhost:5173 / GitHub Pages) y el server están en
// orígenes distintos. `credentials: true` permite que viaje la cookie de sesión.
app.use(
  "/api/*",
  cors({
    origin: env.clientUrl,
    credentials: true,
  }),
);

// Rutas de autenticación (Google OAuth + sesión).
app.route("/api/auth", authRoutes);

/** Raíz informativa (no expone nada sensible). */
app.get("/", (c) => c.text("smash-B server OK"));

/** Salud: para comprobaciones del hosting y pruebas rápidas. */
app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "smash-b-server", time: new Date().toISOString() }),
);

/** Comprobación de BD: hace un SELECT 1 para verificar la conexión a Neon. */
app.get("/api/db-check", async (c) => {
  try {
    const result = await db.execute(sql`select 1 as ok`);
    const ok = result.rows[0]?.ok === 1;
    return c.json({ db: ok ? "ok" : "unexpected", rows: result.rows });
  } catch (err) {
    console.error("db-check falló:", err);
    return c.json({ db: "error", message: (err as Error).message }, 500);
  }
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`smash-B server escuchando en http://localhost:${info.port}`);
});
