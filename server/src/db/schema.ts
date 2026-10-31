import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Tabla de USUARIOS. Un usuario se crea la primera vez que inicia sesión con
 * Google. Guardamos lo mínimo para identificarlo y mostrarlo en rankings:
 *  - id interno (uuid) nuestro, estable aunque cambie el proveedor.
 *  - googleId: el "sub" de Google (identificador único de esa cuenta).
 *  - email / name / avatarUrl: datos del perfil de Google (el email se usa como
 *    identificador, no para comunicaciones).
 *  - createdAt: fecha de alta.
 *
 * El progreso del jugador (monedas, stats) vive en `playerStats`.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull(),
  /** Nombre del perfil de Google (no editable; referencia). */
  name: text("name").notNull(),
  /**
   * Apodo que ELIGE el usuario (editable). Es el que se muestra en partida y en
   * rankings. Por defecto es el nombre de Google (recortado) al darse de alta.
   */
  nickname: text("nickname").notNull(),
  /**
   * ¿El usuario ya ELIGIÓ su apodo explícitamente? Al crearse es false (el
   * apodo es el de Google por defecto); pasa a true cuando lo cambia. El
   * cliente usa esto para forzar elegir apodo en el primer inicio de sesión.
   */
  nicknameChosen: boolean("nickname_chosen").notNull().default(false),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * PROGRESO del jugador (una fila por usuario). Separado de `users` porque es
 * mutable y crecerá (hoy monedas + stats de ranking; mañana nivel, logros...).
 *
 *  - coins: moneda del juego. Se gana ganando partidas, por rango y por KOs.
 *  - wins: partidas ganadas (para el ranking).
 *  - kills: KOs totales infligidos (para el ranking).
 *  - deaths: muertes totales (para el ranking).
 *  - matchesPlayed: partidas validadas contabilizadas (informativo / anti-abuso).
 *
 * Todos los valores los calcula y escribe el SERVIDOR tras validar la partida
 * re-simulando el replay; el cliente nunca los fija directamente.
 */
export const playerStats = pgTable("player_stats", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  coins: integer("coins").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  deaths: integer("deaths").notNull().default(0),
  matchesPlayed: integer("matches_played").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlayerStats = typeof playerStats.$inferSelect;
export type NewPlayerStats = typeof playerStats.$inferInsert;

/**
 * INVENTARIO de tokens del jugador (una fila por usuario). Los tokens se ganan
 * en el gacha según la rareza que toque. Se acumulan sin límite. Es el primer
 * "apartado" del inventario (mochila); más adelante habrá otros (cosméticos…).
 */
export const playerTokens = pgTable("player_tokens", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  common: integer("common").notNull().default(0),
  epic: integer("epic").notNull().default(0),
  legendary: integer("legendary").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlayerTokens = typeof playerTokens.$inferSelect;
export type NewPlayerTokens = typeof playerTokens.$inferInsert;
