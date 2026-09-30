-- Handles (@endereço) dos agentes e slug dos nós. Preenche os registros existentes a partir do nome,
-- com a mesma regra de slugifyHandle (packages/shared/src/handle.ts) e sufixo numérico em repetições.
ALTER TABLE "agents" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "federation_nodes" ADD COLUMN "slug" text;--> statement-breakpoint
WITH base AS (
  SELECT id, created_at,
    trim(both '-' from left(trim(both '-' from regexp_replace(
      translate(lower(name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
      '[^a-z0-9]+', '-', 'g')), 32)) AS slug
  FROM "federation_nodes"
), ranked AS (
  SELECT id, CASE WHEN length(slug) >= 3 THEN slug ELSE 'no-' || lower(id::text) END AS slug,
    row_number() OVER (PARTITION BY slug ORDER BY created_at, id) AS n
  FROM base
)
UPDATE "federation_nodes" f
SET slug = CASE WHEN r.n = 1 THEN r.slug ELSE trim(both '-' from left(r.slug, 28)) || '-' || r.n END
FROM ranked r WHERE r.id = f.id;--> statement-breakpoint
WITH base AS (
  SELECT id, created_at,
    trim(both '-' from left(trim(both '-' from regexp_replace(
      translate(lower(name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
      '[^a-z0-9]+', '-', 'g')), 32)) AS slug
  FROM "agents"
  WHERE origin_node_id IS NULL
), ranked AS (
  SELECT id, CASE WHEN length(slug) >= 3 THEN slug WHEN slug <> '' THEN slug || '-agente' ELSE 'agente' END AS slug,
    created_at
  FROM base
), numbered AS (
  SELECT id, slug, row_number() OVER (PARTITION BY slug ORDER BY created_at, id) AS n FROM ranked
)
UPDATE "agents" a
SET handle = CASE WHEN x.n = 1 THEN x.slug ELSE trim(both '-' from left(x.slug, 28)) || '-' || x.n END
FROM numbered x WHERE x.id = a.id;--> statement-breakpoint
ALTER TABLE "federation_nodes" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_handle_unique" UNIQUE("handle");--> statement-breakpoint
ALTER TABLE "federation_nodes" ADD CONSTRAINT "federation_nodes_slug_unique" UNIQUE("slug");
