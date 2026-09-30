/**
 * Com o front no Cloudflare (apps/edge), a API fica atrás do Worker. EDGE_SECRET faz a API recusar
 * quem tentar falar com ela direto (ex.: pelo hostname do túnel), sem passar pelo Worker.
 *
 * Exceções: /mcp/app (a CLI do assistente chama pelo loopback, e a rota já exige o token de turno)
 * e /healthz.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.ts";
import { HttpError } from "./errors.ts";

export const EDGE_SECRET_HEADER = "x-edge-secret";

const EXEMPT = /^\/(mcp\/app|healthz)(\?|$)/;

export const edgeGuard = fp(async (app: FastifyInstance) => {
  const secret = env.EDGE_SECRET;
  if (!secret) return;
  const expected = Buffer.from(secret);
  app.addHook("onRequest", async (req) => {
    if (EXEMPT.test(req.url)) return;
    const got = req.headers[EDGE_SECRET_HEADER];
    const value = Buffer.from(Array.isArray(got) ? (got[0] ?? "") : (got ?? ""));
    if (value.length !== expected.length || !timingSafeEqual(value, expected)) {
      throw new HttpError(403, "edge_only", "Acesse pelo endereço público do registry");
    }
  });
});
