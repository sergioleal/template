import Fastify from "fastify";
import cookie from "@fastify/cookie";
import etag from "@fastify/etag";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { authPlugin } from "./lib/auth.ts";
import { edgeGuard } from "./lib/edge-guard.ts";
import { registerErrorHandler } from "./lib/errors.ts";
import { renderSpa, spaDir, spaEnabled } from "./lib/spa.ts";
import { agentRoutes } from "./routes/agents.ts";
import { authRoutes } from "./routes/auth.ts";
import { catalogRoutes } from "./routes/catalog.ts";
import { mcpRoutes } from "./routes/mcp.ts";
import { federationRoutes } from "./routes/federation.ts";
import { instanceRoutes } from "./routes/instance.ts";
import { appMcpRoutes } from "./routes/app-mcp.ts";
import { assistantRoutes } from "./routes/assistant.ts";
import { publicRoutes } from "./routes/public.ts";
import { randomBytes } from "node:crypto";
import { env, isHub, isProduction } from "./env.ts";

export async function buildApp() {
  const app = Fastify({
    logger: { level: isProduction ? "info" : "debug" },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  registerErrorHandler(app);
  await app.register(edgeGuard);
  // O segredo assina o cookie de estado do login (lib/oidc.ts); a sessão usa um token opaco à parte.
  await app.register(cookie, { secret: env.COOKIE_SECRET ?? randomBytes(32).toString("hex") });
  await app.register(etag);
  // Sem limite global; rotas sensíveis (login) configuram o próprio.
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin);

  app.get("/healthz", async () => ({ ok: true }));
  await app.register(instanceRoutes);
  await app.register(publicRoutes);
  await app.register(catalogRoutes);
  await app.register(mcpRoutes);
  // Só o hub recebe envios de nós.
  if (isHub) await app.register(federationRoutes);
  await app.register(authRoutes);
  await app.register(agentRoutes);
  await app.register(appMcpRoutes);
  await app.register(assistantRoutes);

  if (spaEnabled()) {
    // Arquivos do build servidos a partir do disco a cada requisição (um build novo vale sem reiniciar).
    // O que não for arquivo cai no handler de 404, que devolve o index.html para as rotas do cliente.
    await app.register(fastifyStatic, { root: spaDir!, index: false });
    // "/" é um diretório para o servidor estático (que responderia 403); é a página inicial do SPA.
    app.get("/", async (_req, reply) => reply.type("text/html; charset=utf-8").send(renderSpa()));
  }

  return app;
}
