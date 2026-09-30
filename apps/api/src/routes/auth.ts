import type { FastifyInstance, FastifyReply } from "fastify";
import type { Me } from "@agentikal/shared";
import { createSession, destroySession, requireUser } from "../lib/auth.ts";
import { HttpError } from "../lib/errors.ts";
import { beginLogin, completeLogin, logoutUrl, oidcEnabled, safeReturnTo, type LoginTransaction } from "../lib/oidc.ts";
import { tenantFor } from "../lib/tenant.ts";
import { env } from "../env.ts";

const TX_COOKIE = "oidc_tx";
const secure = env.PUBLIC_BASE_URL.startsWith("https://");

/** Volta ao SPA com o motivo da falha (a tela de login mostra a mensagem). */
const failTo = (reply: FastifyReply, reason: string) => reply.redirect(`/login?erro=${encodeURIComponent(reason)}`);

export async function authRoutes(app: FastifyInstance) {
  /** Início do login: guarda state/PKCE/nonce num cookie assinado e redireciona ao Keycloak. */
  app.get<{ Querystring: { volta?: string } }>(
    "/api/auth/login",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!oidcEnabled()) throw new HttpError(503, "auth_not_configured", "Login não configurado neste servidor");
      const { url, tx } = await beginLogin(safeReturnTo(req.query.volta, "/painel"));
      reply.setCookie(TX_COOKIE, JSON.stringify(tx), { httpOnly: true, sameSite: "lax", secure, path: "/api/auth", maxAge: 600, signed: true });
      return reply.redirect(url);
    },
  );

  /** Retorno do Keycloak: confere o state, troca o código, liga (ou cria) o tenant e abre a sessão. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/auth/callback",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const raw = req.cookies[TX_COOKIE];
      reply.clearCookie(TX_COOKIE, { path: "/api/auth" });
      if (req.query.error) return failTo(reply, req.query.error === "access_denied" ? "Login cancelado" : "O login não foi concluído");
      const unsigned = raw ? req.unsignCookie(raw) : null;
      let tx: LoginTransaction | null = null;
      try {
        tx = unsigned?.valid && unsigned.value ? (JSON.parse(unsigned.value) as LoginTransaction) : null;
      } catch {
        tx = null;
      }
      if (!tx || !req.query.code || req.query.state !== tx.state) return failTo(reply, "O login expirou. Entre de novo.");
      try {
        const who = await completeLogin(req.query.code, tx);
        const user = await tenantFor(who);
        if (user.disabledAt) return failTo(reply, "Conta desativada");
        await createSession(reply, user.id, who.idToken);
        return reply.redirect(safeReturnTo(tx.returnTo, "/painel"));
      } catch (err) {
        req.log.warn({ err }, "login OIDC falhou");
        return failTo(reply, err instanceof HttpError ? err.message : "O login não foi concluído");
      }
    },
  );

  /** Encerra a sessão local e devolve o endereço de saída do Keycloak (o SPA navega até ele). */
  app.post("/api/auth/logout", async (req, reply) => {
    const idToken = await destroySession(req, reply);
    return { logoutUrl: await logoutUrl(idToken) };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (req) => req.user! satisfies Me);
}
