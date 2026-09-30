ALTER TABLE "agents" ADD COLUMN "visibility" text DEFAULT 'unlisted' NOT NULL;--> statement-breakpoint
CREATE INDEX "agents_catalog_idx" ON "agents" USING btree ("updated_at") WHERE "agents"."visibility" = 'public' and "agents"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_visibility_check" CHECK ("agents"."visibility" in ('public', 'unlisted'));