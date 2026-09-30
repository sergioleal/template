/**
 * Hub: endpoint da federação. Nós aprovados enviam snapshots assinados dos próprios agentes.
 *   POST /federation/v1/push
 *   x-registry-node: <código do nó>
 *   x-registry-timestamp: <ISO 8601>
 *   x-registry-signature: <Ed25519 de `${timestamp}\n${sha256(corpo)}`, base64>
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  FEDERATION_HEADERS,
  FEDERATION_MAX_SKEW_MS,
  FEDERATION_PROTOCOL,
  isValidNodeCode,
  pushRequestSchema,
  type PushResponse,
} from "@agentikal/shared";
import { db } from "../db/client.ts";
import { federationNodes } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { parsePublicKey, verifyPush } from "../lib/federation/crypto.ts";
import { ingestPush } from "../lib/federation/ingest.ts";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const header = (req: FastifyRequest, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

async function authenticateNode(req: FastifyRequest) {
  const code = header(req, FEDERATION_HEADERS.node);
  const timestamp = header(req, FEDERATION_HEADERS.timestamp);
  const signature = header(req, FEDERATION_HEADERS.signature);
  if (!code || !timestamp || !signature || !isValidNodeCode(code)) {
    throw new HttpError(401, "unsigned", "Envio sem identificação ou assinatura do nó");
  }
  const sentAt = Date.parse(timestamp);
  if (Number.isNaN(sentAt) || Math.abs(Date.now() - sentAt) > FEDERATION_MAX_SKEW_MS) {
    throw new HttpError(401, "stale_signature", "Timestamp fora da janela aceita (confira o relógio do nó)");
  }
  const [node] = await db.select().from(federationNodes).where(eq(federationNodes.code, code)).limit(1);
  // A mesma resposta para nó inexistente e assinatura inválida, para não revelar quais códigos existem.
  if (!node || !verifyPush(parsePublicKey(node.publicKey), timestamp, req.rawBody ?? "", signature)) {
    throw new HttpError(401, "invalid_signature", "Assinatura inválida");
  }
  if (node.status !== "active") throw new HttpError(403, "node_suspended", "Este nó está suspenso no hub");
  return node;
}

export async function federationRoutes(app: FastifyInstance) {
  // A assinatura cobre o corpo exato: guardamos o texto bruto antes do parse (só neste escopo).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 8 * 1024 * 1024 }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new HttpError(400, "invalid_json", "JSON inválido"), undefined);
    }
  });

  app.post("/federation/v1/push", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const node = await authenticateNode(req);
    const { agents } = pushRequestSchema.parse(req.body);
    const results = await ingestPush(node, agents);
    req.log.info({ node: node.code, results: results.length }, "federation push");
    return { protocol: FEDERATION_PROTOCOL, node: node.code, results } satisfies PushResponse;
  });
}
