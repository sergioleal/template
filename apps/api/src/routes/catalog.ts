import type { FastifyInstance } from "fastify";
import { catalogQuerySchema, type CatalogPage } from "@agentikal/shared";
import { searchPublicAgents } from "../lib/search.ts";

/**
 * Catálogo público: agentes públicos, não removidos e com versão latest.
 * Aceita busca em linguagem natural (q) e filtros por tags, transporte e autenticação.
 */
export async function catalogRoutes(app: FastifyInstance) {
  app.get("/api/catalog", async (req, reply) => {
    const query = catalogQuerySchema.parse(req.query);
    const { total, items } = await searchPublicAgents(query);
    reply.header("Access-Control-Allow-Origin", "*").header("Cache-Control", "public, max-age=60");
    return {
      schemaVersion: "1",
      query: query.q,
      total,
      page: query.page,
      pageSize: query.pageSize,
      items,
    } satisfies CatalogPage;
  });
}
