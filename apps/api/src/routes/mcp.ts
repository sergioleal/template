/**
 * O próprio registry como servidor MCP (Streamable HTTP, stateless, em /mcp).
 * Um agente adiciona este servidor e descobre em tempo de execução com quem falar:
 *   search_agents → escolhe um candidato → get_agent → conecta direto no endpoint MCP do agente.
 */
import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  AUTH_TYPES,
  isValidAgentId,
  LATEST,
  normalizeAgentId,
  parseVersionSelector,
  REMOTE_TYPES,
  TAG_PATTERN,
} from "@agentikal/shared";
import { isWithdrawnRemote, loadAgent, pickVersion, resolveAgentRef } from "../db/queries.ts";
import { toAgentDocument, toPersonalDocument, toVersionList } from "../lib/documents.ts";
import { catalogTags, searchPublicAgents } from "../lib/search.ts";

const SERVER_INSTRUCTIONS = `Registry de agentes MCP. Use para descobrir agentes com quem conversar.
1. search_agents com a necessidade em linguagem natural (ex.: "conciliar extratos bancários") e, se quiser, filtros. list_tags mostra as tags em uso, para escolher os filtros.
2. Escolha pelo resumo e pelas ferramentas; confira detalhes com get_agent (endpoints, autenticação, schemas das ferramentas).
3. Conecte-se diretamente ao endpoint MCP do agente (campo remotes). O registry não intermedia a conversa.
Cada agente tem um ID permanente de 12 caracteres (ex.: ZZ4K7Q2M9XH2) e um endereço @ legível (ex.: @lago-sul); get_agent e list_versions aceitam os dois.
O endereço pode mudar de dono; para reprodutibilidade, guarde o ID e fixe a versão exata retornada.`;

class ToolError extends Error {}

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data as Record<string, unknown>,
});

const toolError = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

async function loadPublicAgent(rawId: string) {
  if (rawId.trim().startsWith("@")) {
    const resolved = await resolveAgentRef(rawId);
    if (!resolved) throw new ToolError(`Nenhum agente com o endereço ${rawId.trim()}.`);
    rawId = resolved;
  }
  const id = normalizeAgentId(rawId);
  if (!isValidAgentId(id)) throw new ToolError(`ID inválido: "${rawId}" (formato ou dígito verificador).`);
  const found = await loadAgent(id);
  if (!found) throw new ToolError(`Agente ${id} não encontrado.`);
  if (found.agent.deletedAt) throw new ToolError(`O agente ${id} foi removido pelo dono.`);
  if (isWithdrawnRemote(found.agent)) throw new ToolError(`Agente ${id} não encontrado.`);
  return found;
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function buildServer() {
  const server = new McpServer(
    { name: "agentikal-registry", title: "Agentikal Registry", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "search_agents",
    {
      title: "Buscar agentes",
      description:
        "Busca agentes públicos do registry pela necessidade descrita em linguagem natural (português ou inglês). " +
        "Retorna os candidatos mais relevantes com ID, endereço @, resumo, ferramentas, endpoints MCP, autenticação e score (0–1). " +
        "Sem query, lista os atualizados mais recentemente.",
      inputSchema: {
        query: z.string().max(200).optional().describe("O que você precisa, ex.: 'agendar consulta médica'"),
        tags: z.array(z.string().regex(TAG_PATTERN)).max(10).optional().describe("Só agentes com todas estas tags"),
        transport: z.enum(REMOTE_TYPES).optional().describe("Só agentes com este transporte MCP"),
        auth: z.enum(AUTH_TYPES).optional().describe("Só agentes com este tipo de autenticação"),
        limit: z.number().int().min(1).max(20).optional().describe("Máximo de resultados (padrão 5)"),
      },
      annotations: readOnly,
    },
    async ({ query, tags, transport, auth, limit }) => {
      const { total, items } = await searchPublicAgents({
        q: query?.trim() ?? "",
        tags: tags ?? [],
        transport,
        auth,
        page: 1,
        pageSize: limit ?? 5,
      });
      return json({
        total,
        results: items.map(({ updatedAt: _u, remoteTypes: _r, ...rest }) => rest),
      });
    },
  );

  server.registerTool(
    "list_tags",
    {
      title: "Tags do catálogo",
      description:
        "Tags usadas pelos agentes públicos do registry, com quantos agentes usam cada uma. Use para escolher os filtros " +
        "`tags` de search_agents (ex.: quais tags servem para montar um evento).",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => json({ tags: await catalogTags() }),
  );

  server.registerTool(
    "get_agent",
    {
      title: "Detalhes de um agente",
      description:
        "Documento completo de um agente: endpoints MCP (remotes), autenticação, ferramentas com inputSchema e descrição. " +
        "Para agentes pessoais (kind: personal, o agente de uma pessoa), devolve só quem é o agente e de quem ele é: use para conferir quem está falando com você. " +
        "version aceita 'latest' (padrão), uma linha ('1', '1.2') ou uma versão exata ('1.2.3').",
      inputSchema: {
        id: z.string().max(80).describe("ID (ex.: ZZ4K7Q2M9XH2) ou endereço @ (ex.: @lago-sul)"),
        version: z.string().max(128).optional().describe("Seletor de versão (padrão: latest)"),
      },
      annotations: readOnly,
    },
    async ({ id, version }) => {
      try {
        const found = await loadPublicAgent(id);
        // Agente pessoal (de uma pessoa, age pelo assistente dela): não tem versões nem endpoint.
        if (found.agent.kind === "personal") return json(toPersonalDocument(found.agent, found.ownerDisplayName));
        const requested = version?.trim() || LATEST;
        const selector = parseVersionSelector(requested);
        if (!selector) throw new ToolError(`Versão inválida: "${requested}". Use x.y.z, x.y, x ou latest.`);
        const v = pickVersion(found.versions, selector);
        if (!v) throw new ToolError(`Nenhuma versão de ${found.agent.id} corresponde a "${requested}".`);
        return json(toAgentDocument(found.agent, found.ownerDisplayName, v, requested, found.origin));
      } catch (err) {
        if (err instanceof ToolError) return toolError(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    "list_versions",
    {
      title: "Versões de um agente",
      description: "Lista as versões publicadas de um agente, da mais nova para a mais antiga, indicando a latest e as retiradas.",
      inputSchema: { id: z.string().max(80).describe("ID ou endereço @ do agente") },
      annotations: readOnly,
    },
    async ({ id }) => {
      try {
        const found = await loadPublicAgent(id);
        if (found.agent.kind === "personal") throw new ToolError(`${found.agent.id} é um agente pessoal e não tem versões.`);
        return json(toVersionList(found.agent, found.versions));
      } catch (err) {
        if (err instanceof ToolError) return toolError(err.message);
        throw err;
      }
    },
  );

  return server;
}

export async function mcpRoutes(app: FastifyInstance) {
  app.post("/mcp", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    // Stateless: servidor e transporte novos por requisição, sem sessão em memória.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  const notAllowed = { jsonrpc: "2.0", error: { code: -32000, message: "Método não permitido (servidor stateless)" }, id: null };
  app.get("/mcp", async (_req, reply) => reply.status(405).header("Allow", "POST").send(notAllowed));
  app.delete("/mcp", async (_req, reply) => reply.status(405).header("Allow", "POST").send(notAllowed));
}
