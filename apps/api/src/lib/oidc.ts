/**
 * Login pelo Keycloak (OpenID Connect, authorization code + PKCE), feito pela API: o navegador só vê
 * o redirecionamento e, no fim, o cookie de sessão da própria API. Nenhum token fica no navegador.
 *
 * OIDC_ISSUER é o endereço público do realm (vale para o navegador e para o `iss` dos tokens).
 * OIDC_INTERNAL_URL, se definido, é por onde a API fala com o Keycloak (na VM: http://keycloak:8080),
 * sem sair pela internet; troca só a origem das chamadas de servidor para servidor.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../env.ts";
import { HttpError } from "./errors.ts";

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

export interface OidcIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  idToken: string;
}

/** O que precisa sobreviver ao vaivém pelo Keycloak (vai num cookie assinado e curto). */
export interface LoginTransaction {
  state: string;
  verifier: string;
  nonce: string;
  returnTo: string;
}

export const oidcEnabled = () => Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);

const redirectUri = () => `${env.PUBLIC_BASE_URL}/api/auth/callback`;

/** URL pública → URL interna (mesmo caminho), para as chamadas feitas pela API. */
function internal(url: string): string {
  if (!env.OIDC_INTERNAL_URL) return url;
  const u = new URL(url);
  return env.OIDC_INTERNAL_URL.replace(/\/+$/, "") + u.pathname + u.search;
}

let discovery: Promise<Discovery> | undefined;
function discover(): Promise<Discovery> {
  discovery ??= fetch(internal(`${env.OIDC_ISSUER}/.well-known/openid-configuration`), { signal: AbortSignal.timeout(10_000) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`discovery ${r.status}`);
      return (await r.json()) as Discovery;
    })
    .catch((err) => {
      // Não guarda a falha: o Keycloak pode só estar subindo.
      discovery = undefined;
      throw err;
    });
  return discovery;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
async function keys() {
  jwks ??= createRemoteJWKSet(new URL(internal((await discover()).jwks_uri)));
  return jwks;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** Caminho relativo seguro para voltar depois do login (nada de //host ou URL absoluta). */
export function safeReturnTo(value: unknown, fallback = "/"): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}

export async function beginLogin(returnTo: string): Promise<{ url: string; tx: LoginTransaction }> {
  const d = await discover().catch(() => {
    throw new HttpError(503, "auth_unavailable", "O serviço de login está indisponível. Tente de novo em instantes.");
  });
  const tx: LoginTransaction = { state: b64url(randomBytes(16)), verifier: b64url(randomBytes(32)), nonce: b64url(randomBytes(16)), returnTo };
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: env.OIDC_CLIENT_ID!,
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: redirectUri(),
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: b64url(createHash("sha256").update(tx.verifier).digest()),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), tx };
}

export async function completeLogin(code: string, tx: LoginTransaction): Promise<OidcIdentity> {
  const d = await discover();
  const res = await fetch(internal(d.token_endpoint), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(env.OIDC_CLIENT_ID!)}:${encodeURIComponent(env.OIDC_CLIENT_SECRET!)}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: tx.verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new HttpError(401, "login_failed", `O login não foi concluído${body.error ? ` (${body.error})` : ""}`);

  const { payload } = await jwtVerify(body.id_token, await keys(), { issuer: env.OIDC_ISSUER, audience: env.OIDC_CLIENT_ID });
  if (payload.nonce !== tx.nonce) throw new HttpError(401, "login_failed", "Resposta de login inválida");
  return identity(payload, body.id_token);
}

function identity(p: JWTPayload, idToken: string): OidcIdentity {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    sub: String(p.sub),
    email: str(p.email)?.toLowerCase() ?? null,
    emailVerified: p.email_verified === true,
    name: str(p.name) ?? str(p.preferred_username),
    idToken,
  };
}

/**
 * Access token do app Android (cliente público do realm, `OIDC_APP_CLIENT_ID`), mandado como Bearer.
 * Confere assinatura e issuer, e que o token foi emitido para o app (`azp`): um token de outro cliente do
 * realm não vale aqui. Devolve a identidade, ou null se o token não vale.
 */
export async function verifyAppToken(token: string): Promise<Omit<OidcIdentity, "idToken"> | null> {
  if (!env.OIDC_ISSUER || !env.OIDC_APP_CLIENT_ID) return null;
  try {
    const { payload } = await jwtVerify(token, await keys(), { issuer: env.OIDC_ISSUER });
    if (payload.azp !== env.OIDC_APP_CLIENT_ID || !payload.sub) return null;
    const { idToken: _, ...who } = identity(payload, "");
    return who;
  } catch {
    return null;
  }
}

/** Endereço de saída no Keycloak (encerra a sessão lá também) e volta para a página inicial. */
export async function logoutUrl(idToken: string | null): Promise<string | null> {
  const d = await discover().catch(() => null);
  if (!d?.end_session_endpoint) return null;
  const url = new URL(d.end_session_endpoint);
  url.search = new URLSearchParams({
    client_id: env.OIDC_CLIENT_ID!,
    post_logout_redirect_uri: `${env.PUBLIC_BASE_URL}/`,
    ...(idToken ? { id_token_hint: idToken } : {}),
  }).toString();
  return url.toString();
}
