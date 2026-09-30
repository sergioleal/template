import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isValidAgentId, LATEST, normalizeAgentId, parseVersionSelector, type VersionSelector } from "@agentikal/shared";
import { isWithdrawnRemote, loadAgent, pickVersion, resolveAgentRef, type AgentWithVersions } from "../db/queries.ts";
import { agentUrls, toAgentDocument, toPersonalDocument, toVersionList } from "../lib/documents.ts";
import { HttpError, notFound } from "../lib/errors.ts";
import { renderSpa, spaEnabled, type PageMeta } from "../lib/spa.ts";

type Params = { id: string; sel?: string };
type Representation = "json" | "negotiate";

const CACHE_FLOATING = "public, max-age=60";
const CACHE_EXACT = "public, max-age=300";

/** Navegadores pedem text/html; curl e clientes de API recebem JSON por padrão. */
function wantsHtml(req: FastifyRequest): boolean {
  return spaEnabled() && (req.headers.accept ?? "").includes("text/html");
}

/**
 * Valida o ID do caminho. IDs em minúsculas ou com hífens são redirecionados para a forma canônica.
 * Retorna null quando já respondeu com redirect.
 */
async function loadFromParams(req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
  const raw = req.params.id;
  // /a/@lago-sul → /a/<ID>. Temporário (302): o handle pode trocar de agente, o ID não.
  if (raw.startsWith("@")) {
    const resolved = await resolveAgentRef(raw);
    if (!resolved) throw notFound(`Nenhum agente com o endereço ${raw}`);
    reply.header("Cache-Control", CACHE_FLOATING).redirect(req.url.replace(/^\/a\/[^/?]+/, `/a/${resolved}`), 302);
    return null;
  }
  const id = normalizeAgentId(raw);
  if (!isValidAgentId(id)) throw new HttpError(400, "invalid_id", "ID inválido (formato ou dígito verificador)");
  if (id !== raw) {
    reply.redirect(req.url.replace(`/a/${raw}`, `/a/${id}`), 301);
    return null;
  }
  const found = await loadAgent(id);
  if (!found) throw notFound("Agente não encontrado");
  if (found.agent.deletedAt) throw new HttpError(410, "gone", "Este agente foi removido");
  if (isWithdrawnRemote(found.agent)) throw notFound("Este agente não está publicado neste registry");
  if (found.agent.visibility !== "public") reply.header("X-Robots-Tag", "noindex");
  return found;
}

function parseSelector(sel: string | undefined): VersionSelector {
  if (sel === undefined) return { kind: "latest" };
  const selector = parseVersionSelector(sel);
  if (!selector) throw new HttpError(400, "invalid_version", "Versão inválida: use x.y.z, x.y, x ou latest");
  return selector;
}

function sendHtml(reply: FastifyReply, meta: PageMeta) {
  return reply.header("Vary", "Accept").type("text/html; charset=utf-8").send(renderSpa(meta));
}

export async function publicRoutes(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply) => {
    // Os documentos públicos são somente leitura e feitos para consumo por máquinas.
    if (req.url.startsWith("/a/")) reply.header("Access-Control-Allow-Origin", "*");
  });

  const agentHandler = (mode: Representation) => async (req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
    const found = await loadFromParams(req, reply);
    if (!found) return reply;
    // Agente pessoal: sem versões; o documento diz quem é o agente e de quem ele é.
    if (found.agent.kind === "personal") {
      if (req.params.sel !== undefined) throw notFound("Agentes pessoais não têm versões");
      if (mode === "negotiate" && wantsHtml(req)) return sendHtml(reply, pageMeta(found, undefined, undefined));
      reply.header("Cache-Control", CACHE_FLOATING);
      if (mode === "negotiate") reply.header("Vary", "Accept");
      return toPersonalDocument(found.agent, found.ownerDisplayName);
    }
    const selector = parseSelector(req.params.sel);
    const requested = req.params.sel ?? LATEST;
    const version = pickVersion(found.versions, selector);

    if (mode === "negotiate" && wantsHtml(req)) {
      // O SPA mostra o erro de versão inexistente; aqui só preenchemos as meta tags quando possível.
      return sendHtml(reply, pageMeta(found, version?.version, req.params.sel));
    }
    if (!version) {
      throw notFound(
        selector.kind === "exact"
          ? `Versão ${requested} não encontrada`
          : `Nenhuma versão publicada corresponde a "${requested}"`,
      );
    }
    reply.header("Cache-Control", selector.kind === "exact" ? CACHE_EXACT : CACHE_FLOATING);
    if (mode === "negotiate") reply.header("Vary", "Accept");
    return toAgentDocument(found.agent, found.ownerDisplayName, version, requested, found.origin);
  };

  const versionsHandler = (mode: Representation) => async (req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
    const found = await loadFromParams(req, reply);
    if (!found) return reply;
    if (found.agent.kind === "personal") throw notFound("Agentes pessoais não têm versões");
    if (mode === "negotiate" && wantsHtml(req)) {
      const urls = agentUrls(found.agent.id);
      return sendHtml(reply, {
        title: `${found.agent.name} — versões`,
        description: found.agent.summary,
        url: `${urls.html}/versions`,
        jsonUrl: `${urls.html}/versions/json`,
        noindex: found.agent.visibility !== "public",
      });
    }
    reply.header("Cache-Control", CACHE_FLOATING);
    if (mode === "negotiate") reply.header("Vary", "Accept");
    return toVersionList(found.agent, found.versions);
  };

  /** Para navegadores, erros (400/404/410) também devolvem o SPA, que exibe a mensagem ao buscar o JSON. */
  const withHtmlErrors =
    (handler: (req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
      try {
        return await handler(req, reply);
      } catch (err) {
        if (!(err instanceof HttpError) || !wantsHtml(req)) throw err;
        return reply.status(err.statusCode).header("Vary", "Accept").type("text/html; charset=utf-8").send(renderSpa());
      }
    };

  app.get("/a/:id/json", agentHandler("json"));
  app.get("/a/:id/v/:sel/json", agentHandler("json"));
  app.get("/a/:id/versions/json", versionsHandler("json"));

  app.get("/a/:id", withHtmlErrors(agentHandler("negotiate")));
  app.get("/a/:id/v/:sel", withHtmlErrors(agentHandler("negotiate")));
  app.get("/a/:id/versions", withHtmlErrors(versionsHandler("negotiate")));
}

function pageMeta(found: AgentWithVersions, version: string | undefined, sel: string | undefined): PageMeta {
  const urls = agentUrls(found.agent.id, sel);
  const suffix = version ? ` ${version}` : "";
  return {
    title: `${found.agent.name}${suffix}`,
    description: found.agent.summary || `Agente ${found.agent.id} no registry`,
    url: found.origin?.url || urls.html,
    jsonUrl: urls.json,
    noindex: found.agent.visibility !== "public",
  };
}
