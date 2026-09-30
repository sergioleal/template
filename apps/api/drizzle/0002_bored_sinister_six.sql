ALTER TABLE "agent_versions" ADD COLUMN "tools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD COLUMN "auth" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "semantic_profile" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "latest_version" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "latest_transports" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "latest_auth" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "search_doc" "tsvector";--> statement-breakpoint
CREATE INDEX "agents_search_idx" ON "agents" USING gin ("search_doc");--> statement-breakpoint
CREATE INDEX "agents_tags_idx" ON "agents" USING gin ("tags");