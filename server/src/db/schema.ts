import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Tabla de USUARIOS. Un usuario se crea la primera vez que inicia sesión con
 * Google. Guardamos lo mínimo para identificarlo y mostrarlo en rankings:
 *  - id interno (uuid) nuestro, estable aunque cambie el proveedor.
 *  - googleId: el "sub" de Google (identificador único de esa cuenta).
 *  - email / name / avatarUrl: datos del perfil de Google (el email se usa como
 *    identificador, no para comunicaciones).
 *  - createdAt: fecha de alta.
 *
 * Los PUNTOS y el ranking irán en su propia tabla en el paso siguiente; aquí
 * solo la identidad.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
