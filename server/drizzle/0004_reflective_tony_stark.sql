CREATE TABLE "player_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"common" integer DEFAULT 0 NOT NULL,
	"epic" integer DEFAULT 0 NOT NULL,
	"legendary" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_tokens" ADD CONSTRAINT "player_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;