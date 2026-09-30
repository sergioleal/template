CREATE TABLE "federation_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" char(2) NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_push_at" timestamp with time zone,
	CONSTRAINT "federation_nodes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "federation_outbox" (
	"agent_id" char(12) PRIMARY KEY NOT NULL,
	"pushed_revision" bigint DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "origin_node_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "origin_url" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "remote_owner_name" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_outbox" ADD CONSTRAINT "federation_outbox_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_origin_node_id_federation_nodes_id_fk" FOREIGN KEY ("origin_node_id") REFERENCES "public"."federation_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_origin_idx" ON "agents" USING btree ("origin_node_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_authority_check" CHECK (("agents"."owner_id" is null) <> ("agents"."origin_node_id" is null));