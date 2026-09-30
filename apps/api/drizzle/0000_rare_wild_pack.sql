CREATE TABLE "agent_versions" (
	"agent_id" char(12) NOT NULL,
	"version" text NOT NULL,
	"major" integer NOT NULL,
	"minor" integer NOT NULL,
	"patch" integer NOT NULL,
	"prerelease" text,
	"description" text NOT NULL,
	"remotes" jsonb NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"yanked_reason" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_versions_agent_id_version_pk" PRIMARY KEY("agent_id","version"),
	CONSTRAINT "agent_versions_status_check" CHECK ("agent_versions"."status" in ('published', 'yanked'))
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" char(12) PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_versions_order_idx" ON "agent_versions" USING btree ("agent_id","major","minor","patch");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");