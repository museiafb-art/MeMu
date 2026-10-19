CREATE TABLE "pairing_code" (
	"id" text PRIMARY KEY,
	"code" text NOT NULL UNIQUE,
	"group_id" text NOT NULL,
	"created_by_id" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pairing_code_code_idx" ON "pairing_code" ("code");--> statement-breakpoint
ALTER TABLE "pairing_code" ADD CONSTRAINT "pairing_code_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pairing_code" ADD CONSTRAINT "pairing_code_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;