ALTER TABLE "agent_versions" ADD COLUMN "examples" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Agente pessoal: o mesmo nome para todo mundo; o endereço @ continua sendo de cada um.
UPDATE "agents" SET "name" = 'Agente pessoal', "updated_at" = now() WHERE "kind" = 'personal' AND "name" <> 'Agente pessoal';
