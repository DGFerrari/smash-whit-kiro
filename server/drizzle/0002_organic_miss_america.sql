-- Añade la columna `nickname`. Como ya puede haber usuarios, la creamos
-- primero NULLABLE, rellenamos los existentes con su `name`, y luego imponemos
-- NOT NULL. (La migración original de drizzle-kit era un ADD COLUMN NOT NULL
-- directo, que fallaría con filas existentes; se ajustó a mano.)
ALTER TABLE "users" ADD COLUMN "nickname" text;
--> statement-breakpoint
UPDATE "users" SET "nickname" = "name" WHERE "nickname" IS NULL;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "nickname" SET NOT NULL;
