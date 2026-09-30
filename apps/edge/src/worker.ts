/**
 * Worker do registry (Cloudflare Workers + Static Assets).
 *
 * - Arquivos do build do SPA saem direto dos assets (com fallback para index.html nas rotas do cliente).
 * - /api, /mcp, /federation e /healthz são repassados à API Node, mantendo a mesma origem para o
 *   navegador (cookies de sessão e a checagem de Origin contra CSRF continuam valendo). Respostas em
 *   stream (SSE do assistente, MCP) passam sem buffer.
 * - /a/<id>… faz a negociação de conteúdo que a API fazia: navegador recebe o SPA, com <title>,
 *   Open Graph, canonical e noindex injetados pelo HTMLRewriter a partir do JSON do agente; clientes
 *   que não pedem HTML (curl, outros agentes) recebem o JSON da API.
 */

interface Env {
  ASSETS: Fetcher;
  API_ORIGIN: string;
  /** Segredo compartilhado com a API (wrangler secret put EDGE_SECRET); prova que a chamada veio do Worker. */
  EDGE_SECRET?: string;
}

const withEdgeSecret = (headers: Headers, env: Env) => {
  if (env.EDGE_SECRET) headers.set("x-edge-secret", env.EDGE_SECRET);
  return headers;
};

const API_PREFIXES = ["/api/", "/mcp", "/federation/"];

function isApiPath(path: string) {
  return path === "/healthz" || API_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));
}

/** Repassa a requisição à API, preservando método, corpo, cookies e Origin. */
async function proxy(request: Request, env: Env, path = new URL(request.url).pathname): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(path + url.search, env.API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  // A API usa trustProxy: o IP real vale para o rate limit (login, turnos do assistente).
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers.set("x-forwarded-for", ip);
  headers.delete("host");
  withEdgeSecret(headers, env);
  let res: Response;
  try {
    res = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
  } catch {
    return unavailable();
  }
  if (isOriginDown(res)) return unavailable();
  // Redirecionamentos da API (ex.: ID em minúsculas → canônico) apontam para caminhos relativos; mantêm a origem do Worker.
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * Origem fora do ar: VM desligada, túnel sem conector, erros de gateway do Cloudflare (502, 504, 52x).
 * Um 503 com JSON é da própria API (ex.: assistente ocupado) e passa adiante.
 */
function isOriginDown(res: Response): boolean {
  if (res.status === 502 || res.status === 504 || (res.status >= 520 && res.status <= 530)) return true;
  return res.status === 503 && !(res.headers.get("content-type") ?? "").includes("json");
}

function unavailable(): Response {
  return new Response(
    JSON.stringify({ error: "service_unavailable", message: "Serviço temporariamente indisponível. Tente novamente em alguns minutos." }),
    { status: 503, headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60", "cache-control": "no-store" } },
  );
}

const AGENT_PAGE = /^\/a\/([^/]+)(?:\/v\/([^/]+)|\/(versions))?\/?$/;

interface AgentDoc {
  id: string;
  name: string;
  summary: string;
  version: string;
  visibility?: string;
  origin?: { url: string } | null;
  links?: { html: string; self: string };
}

/** Página de agente: SPA com meta tags do agente, ou JSON para quem não pede HTML. */
async function agentPage(request: Request, env: Env, match: RegExpMatchArray): Promise<Response> {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) return proxy(request, env);

  const [, id, sel, versions] = match;
  const jsonPath = versions ? `/a/${id}/json` : sel ? `/a/${id}/v/${sel}/json` : `/a/${id}/json`;
  const [shell, api] = await Promise.all([
    env.ASSETS.fetch(new Request(new URL("/index.html", request.url), { headers: { accept: "text/html" } })),
    fetch(new URL(jsonPath, env.API_ORIGIN), { headers: withEdgeSecret(new Headers({ accept: "application/json" }), env) }).catch(() => null),
  ]);

  // Erros (400/404/410) continuam indo para o SPA, que mostra a mensagem; o status acompanha.
  // Com a origem fora do ar, o SPA vai com 503 e mostra a tela de serviço indisponível.
  const status = !api || isOriginDown(api) ? 503 : api.ok ? 200 : api.status;
  const doc = api?.ok ? ((await api.json()) as AgentDoc) : null;
  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("vary", "Accept");
  if (!doc) return new Response(shell.body, { status, headers });

  const self = new URL(request.url);
  const canonical = doc.origin?.url || `${self.origin}${self.pathname}`;
  const title = versions ? `${doc.name} — versões` : `${doc.name} ${doc.version}`;
  const description = (doc.summary || `Agente ${doc.id} no registry`).slice(0, 300);
  const noindex = doc.visibility && doc.visibility !== "public";
  if (noindex) headers.set("x-robots-tag", "noindex");

  const meta = [
    ["meta", { name: "description", content: description }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: title }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { property: "og:url", content: canonical }],
    ["link", { rel: "canonical", href: canonical }],
    ["link", { rel: "alternate", type: "application/json", href: `${self.origin}${jsonPath}` }],
    ...(noindex ? [["meta", { name: "robots", content: "noindex" }] as const] : []),
  ] as const;

  const rewritten = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on("head", {
      element(el) {
        for (const [tag, attrs] of meta) {
          const html = Object.entries(attrs)
            .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
            .join(" ");
          el.append(`<${tag} ${html}>`, { html: true });
        }
      },
    })
    .transform(new Response(shell.body, { status, headers }));
  return rewritten;
}

function escapeAttr(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    // JSON explícito (/a/<id>/json, /a/<id>/v/<sel>/json, /a/<id>/versions/json) vai direto para a API.
    if (path.startsWith("/a/") && path.endsWith("/json")) return proxy(request, env);
    if (isApiPath(path)) return proxy(request, env);
    const agent = path.match(AGENT_PAGE);
    if (agent && (request.method === "GET" || request.method === "HEAD")) return agentPage(request, env, agent);
    // O resto é o SPA: arquivo existente ou index.html (not_found_handling = single-page-application).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
