import type { FastifyInstance } from "fastify";
import type { InstanceInfo } from "@agentikal/shared";
import { env, isNode } from "../env.ts";

/** Como esta instância se apresenta; a interface usa para mudar identidade e textos entre hub e nó. */
export async function instanceRoutes(app: FastifyInstance) {
  app.get("/api/instance", async (_req, reply) => {
    // Revalida sempre (com ETag): mudar nome, cor ou hub na configuração deve aparecer no próximo carregamento.
    reply.header("Access-Control-Allow-Origin", "*").header("Cache-Control", "no-cache");
    return {
      mode: env.REGISTRY_MODE,
      name: env.REGISTRY_NAME ?? (isNode ? "Registry de agentes" : "Agentikal Registry"),
      brandColor: env.BRAND_COLOR ?? null,
      nodeCode: env.NODE_CODE ?? null,
      hub: isNode && env.HUB_URL ? { url: env.HUB_URL } : null,
    } satisfies InstanceInfo;
  });
}
