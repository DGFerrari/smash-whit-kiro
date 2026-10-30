ALTER TABLE "users" ADD COLUMN "nickname_chosen" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Los usuarios que ya existían no deben pasar por el onboarding de apodo:
-- los marcamos como que ya lo eligieron. Los nuevos se crean en false.
UPDATE "users" SET "nickname_chosen" = true;
