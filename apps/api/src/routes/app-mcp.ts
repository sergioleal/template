/**
 * MCP da aplicação (/mcp/app): as ferramentas do assistente, em nome do usuário do turno.
 *
 * Só leitura sobre o registry. Mudanças nunca acontecem aqui: o assistente propõe formulários e
 * confirmações, e quem executa é o usuário, pela API normal do painel. Com ASSISTANT_AGENT_CALLS,
 * ganha agent_tools e call_agent para conversar com outros agentes (lib/assistant/agent-calls.ts);
 * compromissos com eles também passam pela confirmação do usuário. Autenticado pelo token de turno
 * (lib/assistant/turn-token.ts), que a API passa à CLI no --mcp-config.
 */
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v4";
import { querySchema, TAG_PATTERN, type AgentTraceEntry } from "@agentikal/shared";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { userForTurnToken } from "../lib/assistant/turn-token.ts";
import { QueryError, runQuery } from "../lib/assistant/query.ts";
import { ownedAgent, ownedAgents } from "../lib/owned.ts";
import { catalogTags, searchPublicAgents } from "../lib/search.ts";
import {
  AgentCallError,
  agentCallsEnabled,
  callAgentTool,
  listAgentTools,
  resolveTarget,
} from "../lib/assistant/agent-calls.ts";
import { ensurePersonalAgent } from "../lib/personal-agent.ts";
import { recordTrace } from "../lib/assistant/trace.ts";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

function buildServer(userId: string, displayName: string, turnToken: string) {
  const server = new McpServer({ name: "registry-app", version: "0.1.0" });

  server.registerTool(
    "list_my_agents",
    {
      description:
        "Lista os agentes do usuário: id, endereço @ (handle), nome, resumo, visibilidade, tags, versão latest, número de versões e, " +
        "em nós federados, a situação no hub. Use para encontrar o ID de um agente pelo nome.",
      inputSchema: { query: z.string().max(120).optional().describe("Filtra por nome, resumo, ID ou handle") },
      annotations: readOnly,
    },
    async ({ query }) => {
      const q = query?.trim().toLowerCase();
      const all = await ownedAgents(userId);
      const items = all
        .filter((a) => !q || [a.name, a.summary, a.id, `@${a.handle}`].some((s) => s.toLowerCase().includes(q)))
        .map((a) => ({
          id: a.id,
          handle: `@${a.handle}`,
          name: a.name,
          summary: a.summary,
          visibility: a.visibility,
          tags: a.tags,
          latest: a.latest,
          versions: a.versions.length,
          yanked: a.versions.filter((v) => v.status === "yanked").map((v) => v.version),
          ...(a.federation ? { hub: a.federation.state } : {}),
        }));
      return json({ total: items.length, agents: items });
    },
  );

  server.registerTool(
    "get_my_agent",
    {
      description:
        "Detalhes de um agente do usuário: todas as versões com descrição, endpoints (remotes), autenticação e ferramentas.",
      inputSchema: { id: z.string().max(80).describe("ID ou endereço @ do agente") },
      annotations: readOnly,
    },
    async ({ id }) => {
      const agent = await ownedAgent(id, userId);
      return agent ? json(agent) : fail(`Agente ${id} não encontrado entre os agentes do usuário.`);
    },
  );

  server.registerTool(
    "list_tags",
    {
      description:
        "Tags em uso no catálogo público, com quantos agentes usam cada uma. Use antes de search_catalog para escolher " +
        "as tags que servem ao pedido (ex.: organizador, team-building, aluguel-de-espaco).",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => json({ tags: await catalogTags() }),
  );

  server.registerTool(
    "search_catalog",
    {
      description:
        "Busca no catálogo público desta instância por intenção (português ou inglês), com filtro de tags. Escolha as tags " +
        "entre as de list_tags (todas precisam bater); sem resultado, repita só com a tag principal.",
      inputSchema: {
        query: z.string().max(200).optional(),
        tags: z.array(z.string().regex(TAG_PATTERN)).max(10).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      annotations: readOnly,
    },
    async ({ query, tags, limit }) => {
      const started = Date.now();
      const r = await searchPublicAgents({ q: query?.trim() ?? "", tags: tags ?? [], page: 1, pageSize: limit ?? 8 });
      // Nos bastidores, cada busca do agente pessoal é uma decisão: o que procurou, com quais tags, quem achou. O
      // chat junta as buscas do turno num cartão e marca qual dos encontrados foi chamado (call_agent).
      recordTrace(turnToken, {
        at: new Date(started).toISOString(),
        agent: { id: "", handle: null, name: "Seu agente pessoal" },
        tool: "buscar_parceiros",
        kind: "decision",
        arguments: { query: query ?? "", tags: tags ?? [] },
        ok: true,
        result: {
          titulo: "Como o seu agente procurou quem chamar",
          necessidades: [
            {
              nome: query?.trim() || "(sem termo de busca)",
              motivo: "Busca no catálogo do registry",
              tags: tags ?? [],
              encontrados: r.items.map((a) => a.handle ?? a.name),
            },
          ],
        },
        ms: Date.now() - started,
      });
      return json({
        total: r.total,
        agents: r.items.map((a) => ({
          id: a.id,
          handle: a.handle,
          name: a.name,
          summary: a.summary,
          owner: a.owner.displayName,
          origin: a.origin?.node.name ?? null,
          tags: a.tags,
          latest: a.latest,
          auth: a.auth,
          tools: a.tools.map((t) => t.name),
          score: a.score,
        })),
      });
    },
  );

  server.registerTool(
    "run_query",
    {
      description:
        "Executa uma consulta agregada (a mesma gramática do componente chart/table) e devolve as linhas. " +
        "Use antes de propor um gráfico ou tabela, para conferir que a consulta é válida e tem dados.",
      inputSchema: { query: querySchema },
      annotations: readOnly,
    },
    async ({ query }) => {
      try {
        return json(await runQuery(query, userId));
      } catch (err) {
        if (err instanceof QueryError) return fail(err.message);
        throw err;
      }
    },
  );

  if (agentCallsEnabled()) registerAgentCalls(server, userId, displayName, turnToken);
  return server;
}

/** O assistente como agente do usuário: ferramentas para falar com outros agentes do registry. */
function registerAgentCalls(server: McpServer, userId: string, displayName: string, turnToken: string) {
  // Nas conexões com outros agentes, o assistente se identifica pelo endereço do agente pessoal.
  const caller = async () => `@${(await ensurePersonalAgent({ id: userId, displayName })).handle}`;
  const openWorld = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  const agentRef = z.string().max(80).describe("ID (ex.: ZZ4K7Q2M9XH2) ou endereço @ (ex.: @lago-sul) do agente");

  server.registerTool(
    "agent_tools",
    {
      description:
        "Conecta no agente e lê o tools/list ao vivo: ferramentas, schemas de entrada e requires_confirmation " +
        "(true = compromisso, como fechar negócio ou pagar: só com confirm call_agent do usuário).",
      inputSchema: { agent: agentRef },
      annotations: { ...openWorld, readOnlyHint: true, idempotentHint: true },
    },
    async ({ agent }) => {
      try {
        const target = await resolveTarget(agent, userId);
        return json({ agent: { id: target.id, handle: target.handle, name: target.name, version: target.version }, tools: await listAgentTools(target, await caller()) });
      } catch (err) {
        if (err instanceof AgentCallError) return fail(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    "call_agent",
    {
      description:
        "Chama uma ferramenta de outro agente em nome do usuário e devolve o resultado. Só para ferramentas com " +
        "requires_confirmation=false (consultar, cotar, negociar); compromissos são recusados e precisam de um confirm call_agent.",
      inputSchema: {
        agent: agentRef,
        tool: z.string().max(128),
        arguments: z.record(z.string(), z.unknown()).optional().describe("Argumentos conforme o inputSchema da ferramenta"),
      },
      annotations: openWorld,
    },
    async ({ agent, tool, arguments: args }) => {
      const started = Date.now();
      let who: AgentTraceEntry["agent"] = { id: "", handle: agent.startsWith("@") ? agent : null, name: agent };
      // Cada conversa entra nos bastidores do turno, inclusive as recusadas (ex.: pagar sem confirmação).
      const trace = (ok: boolean, result: unknown) =>
        recordTrace(turnToken, { at: new Date(started).toISOString(), agent: who, tool, arguments: args ?? {}, ok, result, ms: Date.now() - started });
      try {
        const target = await resolveTarget(agent, userId);
        who = { id: target.id, handle: target.handle, name: target.name };
        // As trocas do agente chamado com outros agentes (ex.: @tbuilder com os fornecedores) entram ao vivo.
        const r = await callAgentTool(target, await caller(), tool, args ?? {}, {
          confirmed: false,
          onConversation: (e) => recordTrace(turnToken, e),
        });
        trace(!r.isError, r.result);
        const { conversations: _, ...forModel } = r;
        return json(forModel);
      } catch (err) {
        if (err instanceof AgentCallError) {
          trace(false, err.message);
          return fail(err.message);
        }
        throw err;
      }
    },
  );
}

export async function appMcpRoutes(app: FastifyInstance) {
  app.post("/mcp/app", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (req, reply) => {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const userId = userForTurnToken(bearer);
    const [user] = userId
      ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1)
      : [];
    if (!user) {
      return reply
        .status(401)
        .send({ jsonrpc: "2.0", error: { code: -32001, message: "Token de turno inválido ou expirado" }, id: null });
    }
    const server = buildServer(user.id, user.displayName, bearer!);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}
