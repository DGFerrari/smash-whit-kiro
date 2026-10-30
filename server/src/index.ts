import { serve } from "@hono/node-server";
import { Hono } from "hono";

/**
 * Backend de smash-B (Fase 2+).
 *
 * De momento es un esqueleto: solo expone un endpoint de salud para confirmar
 * que el servidor arranca y responde. En los siguientes pasos añadiremos:
 *  - conexión a Postgres (Neon) + migraciones (Drizzle),
 *  - login con Google (OAuth) y tabla de usuarios,
 *  - puntos y ranking (validando replays con el motor compartido).
 *
 * Config por variables de entorno (nunca secretos en el repo): ver .env.example.
 */

const app = new Hono();

/** Raíz informativa (no expone nada sensible). */
app.get("/", (c) => c.text("smash-B server OK"));

/** Salud: para comprobaciones del hosting y pruebas rápidas. */
app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "smash-b-server", time: new Date().toISOString() }),
);

// El hosting (Render) inyecta PORT; en local usamos 8787 por defecto.
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`smash-B server escuchando en http://localhost:${info.port}`);
});
