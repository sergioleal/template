import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import type { Me } from "@agentikal/shared";
import { db } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import { env } from "../env.ts";
import { HttpError } from "./errors.ts";
import { oidcEnabled, verifyAppToken } from "./oidc.ts";
import { tenantFor } from "./tenant.ts";

export const SESSION_COOKIE = "sid";

declare module "fastify" {
  interface FastifyRequest {
    user: Me | null;
  }
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const secureCookies = env.PUBLIC_BASE_URL.startsWith("https://");

export async function createSession(reply: FastifyReply, userId: string, idToken: string | null = null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt, idToken });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    expires: expiresAt,
  });
}

/** Apaga a sessão local; devolve o id_token dela (para a saída no Keycloak). */
export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const token = req.cookies[SESSION_COOKIE];
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  if (!token) return null;
  const [row] = await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).returning({ idToken: sessions.idToken });
  return row?.idToken ?? null;
}

export async function requireUser(req: FastifyRequest): Promise<void> {
  if (!req.user) throw new HttpError(401, "unauthorized", "Faça login para continuar");
}

/** Carrega o usuário da sessão e protege rotas /api contra CSRF por checagem de Origin. */
export const authPlugin = fp(async (app: FastifyInstance) => {
  const allowedOrigin = new URL(env.PUBLIC_BASE_URL).origin;

  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req) => {
    const method = req.method.toUpperCase();
    if (req.url.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      const origin = req.headers.origin;
      if (origin && origin !== allowedOrigin) {
        throw new HttpError(403, "forbidden_origin", "Origem não permitida");
      }
    }

    // App Android: access token do Keycloak como Bearer (só em /api/*; /mcp/app usa o token de turno).
    const bearer = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (bearer && req.url.startsWith("/api/")) {
      const who = await verifyAppToken(bearer);
      if (!who) throw new HttpError(401, "unauthorized", "Token inválido ou expirado");
      const user = await tenantFor(who);
      if (user.disabledAt) throw new HttpError(403, "account_disabled", "Conta desativada");
      req.user = { id: user.id, email: user.email, displayName: user.displayName };
      return;
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const [row] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          gt(sessions.expiresAt, new Date()),
          isNull(users.disabledAt),
          // Com o Keycloak, só valem sessões abertas por ele (as do login por senha antigo, até de um backup, não).
          oidcEnabled() ? isNotNull(sessions.idToken) : undefined,
        ),
      )
      .limit(1);
    req.user = row ?? null;
  });
});
