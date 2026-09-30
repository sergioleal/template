/**
 * Assistente: conversas, turnos (SSE) e o executor de consultas usado pelos gráficos do chat.
 * Cada turno roda `claude -p` com o MCP da aplicação (/mcp/app) autenticado por um token de turno.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { z as z4 } from "zod/v4";
import {
  assistantReplySchema,
  querySchema,
  type AssistantConversation,
  type AssistantMessage,
  type AssistantReply,
  type TurnEvent,
} from "@agentikal/shared";
import { db } from "../db/client.ts";
import { assistantConversations, assistantMessages } from "../db/schema.ts";
import { env } from "../env.ts";
import { requireUser } from "../lib/auth.ts";
import { HttpError, notFound } from "../lib/errors.ts";
import { CliError, runClaude } from "../lib/claude-cli.ts";
import { systemPrompt, transcript } from "../lib/assistant/prompt.ts";
import { issueTurnToken } from "../lib/assistant/turn-token.ts";
import { QueryError, runQuery } from "../lib/assistant/query.ts";
import { AgentCallError, agentCallsEnabled, callAgentTool, resolveTarget } from "../lib/assistant/agent-calls.ts";
import { ensurePersonalAgent } from "../lib/personal-agent.ts";
import { loadOwnedAgent } from "../db/queries.ts";
import { startTrace } from "../lib/assistant/trace.ts";
import { exampleGroups } from "../lib/assistant/examples.ts";

const REPLY_JSON_SCHEMA = (() => {
  const s = z4.toJSONSchema(assistantReplySchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
})();

const TOOL_LABELS: Record<string, string> = {
  list_my_agents: "Consultando seus agentes",
  get_my_agent: "Lendo os detalhes do agente",
  list_tags: "Vendo as tags do catálogo",
  search_catalog: "Buscando no catálogo",
  run_query: "Calculando os dados",
  agent_tools: "Lendo as ferramentas de um agente",
  call_agent: "Falando com um agente",
};

/** Rótulo do progresso: nas conversas com agentes, mostra com quem e o quê (ex.: "@lago-sul · negociar"). */
function progressLabel(tool: string, input: unknown): string {
  const i = (input ?? {}) as { agent?: unknown; tool?: unknown };
  if (tool === "call_agent" && typeof i.agent === "string" && typeof i.tool === "string") {
    return `Falando com ${i.agent} · ${i.tool}`;
  }
  if (tool === "agent_tools" && typeof i.agent === "string") return `Lendo as ferramentas de ${i.agent}`;
  return TOOL_LABELS[tool] ?? "Trabalhando";
}

// Um turno por usuário por vez; poucos processos da CLI em paralelo no servidor.
const MAX_CONCURRENT = 3;
const busy = new Set<string>();
// Chamadas confirmadas a agentes em andamento, por referência do componente.
const callsInFlight = new Set<string>();
let running = 0;

type Row = typeof assistantMessages.$inferSelect;

function toMessage(r: Row): AssistantMessage {
  const createdAt = r.createdAt.toISOString();
  if (r.role === "assistant") {
    return {
      id: r.id,
      role: "assistant",
      reply: r.content.reply as AssistantReply,
      createdAt,
      costUsd: r.costUsd,
      ...(r.content.trace?.length ? { trace: r.content.trace } : {}),
    };
  }
  if (r.role === "event") return { id: r.id, role: "event", text: r.content.text ?? "", ref: r.content.ref ?? null, createdAt };
  return { id: r.id, role: "user", text: r.content.text ?? "", createdAt };
}

const toConversation = (c: typeof assistantConversations.$inferSelect): AssistantConversation => ({
  id: c.id,
  title: c.title,
  agentId: c.agentId,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

async function ownConversation(req: FastifyRequest<{ Params: { id: string } }>) {
  const id = req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Conversa não encontrada");
  const [c] = await db
    .select()
    .from(assistantConversations)
    .where(and(eq(assistantConversations.id, id), eq(assistantConversations.userId, req.user!.id)))
    .limit(1);
  if (!c) throw notFound("Conversa não encontrada");
  return c;
}

function sse(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  // O turno continua mesmo se o navegador sair (recarregar a página não descarta o trabalho):
  // depois que a conexão fecha, os eventos são só descartados.
  return (event: TurnEvent) => {
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

export async function assistantRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /** O agente pessoal do usuário: é quem responde no chat e quem fala com outros agentes. */
  app.get("/api/assistant/agent", async (req) => {
    const me = await ensurePersonalAgent(req.user!);
    return { id: me.id, handle: `@${me.handle}`, name: me.name, agentCalls: agentCallsEnabled() };
  });

  /** Frases do /ex: as gerais e as dos agentes que declararam frases (os do usuário e os públicos). */
  app.get("/api/assistant/examples", async (req) => ({ groups: await exampleGroups(req.user!.id) }));

  /** Conversas do usuário; `?agent=<ID>` só as sobre esse agente (app Android). */
  app.get<{ Querystring: { agent?: string } }>("/api/assistant/conversations", async (req) => {
    const agent = req.query.agent?.trim().toUpperCase();
    const rows = await db
      .select()
      .from(assistantConversations)
      .where(
        and(
          eq(assistantConversations.userId, req.user!.id),
          agent ? eq(assistantConversations.agentId, agent) : undefined,
        ),
      )
      .orderBy(desc(assistantConversations.updatedAt))
      .limit(50);
    return rows.map(toConversation);
  });

  /** Nova conversa; `{ agentId }` a liga a um agente do usuário, que vira o assunto do assistente. */
  app.post("/api/assistant/conversations", async (req, reply) => {
    const { agentId } = z.object({ agentId: z.string().trim().toUpperCase().optional() }).parse(req.body ?? {});
    if (agentId && !(await loadOwnedAgent(agentId, req.user!.id))) throw notFound("Agente não encontrado");
    const [c] = await db.insert(assistantConversations).values({ userId: req.user!.id, agentId: agentId ?? null }).returning();
    return reply.status(201).send(toConversation(c!));
  });

  app.get<{ Params: { id: string } }>("/api/assistant/conversations/:id", async (req) => {
    const c = await ownConversation(req);
    const rows = await db
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, c.id))
      .orderBy(asc(assistantMessages.createdAt));
    return { conversation: toConversation(c), messages: rows.map(toMessage) };
  });

  app.delete<{ Params: { id: string } }>("/api/assistant/conversations/:id", async (req, reply) => {
    const c = await ownConversation(req);
    await db.delete(assistantConversations).where(eq(assistantConversations.id, c.id));
    return reply.status(204).send();
  });

  /** Registra o que o usuário fez a partir de um componente (a ação em si já foi feita pela API normal). */
  app.post<{ Params: { id: string } }>("/api/assistant/conversations/:id/events", async (req, reply) => {
    const c = await ownConversation(req);
    const { text, ref } = z
      .object({ text: z.string().trim().min(1).max(2000), ref: z.string().max(80).optional() })
      .parse(req.body);
    const [row] = await db
      .insert(assistantMessages)
      .values({ conversationId: c.id, role: "event", content: { text, ref } })
      .returning();
    await db.update(assistantConversations).set({ updatedAt: new Date() }).where(eq(assistantConversations.id, c.id));
    return reply.status(201).send(toMessage(row!));
  });

  /** Um turno: grava a mensagem, roda a CLI com o MCP da aplicação e devolve eventos por SSE. */
  app.post<{ Params: { id: string } }>(
    "/api/assistant/conversations/:id/turn",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const c = await ownConversation(req);
      const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
      const userId = req.user!.id;
      if (busy.has(userId)) throw new HttpError(409, "turn_in_progress", "Aguarde a resposta anterior terminar");
      if (running >= MAX_CONCURRENT) throw new HttpError(503, "assistant_busy", "O assistente está ocupado; tente em instantes");

      const history = await db
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.conversationId, c.id))
        .orderBy(asc(assistantMessages.createdAt));
      const [userRow] = await db
        .insert(assistantMessages)
        .values({ conversationId: c.id, role: "user", content: { text } })
        .returning();

      const me = await ensurePersonalAgent(req.user!);
      // O agente escolhido no app, se ainda for do usuário (o pessoal é o próprio assistente: conversa geral).
      const focus = c.agentId && c.agentId !== me.id ? await loadOwnedAgent(c.agentId, userId) : null;
      const send = sse(reply);
      send({ type: "message", message: toMessage(userRow!) });
      busy.add(userId);
      running++;
      const { token, revoke } = issueTurnToken(userId);
      // Bastidores: cada conversa com outro agente vai ao chat na hora e é gravada com a resposta.
      const trace = startTrace(token, (entry) => send({ type: "trace", entry }));
      try {
        const result = await runClaude({
          system: systemPrompt(req.user!, me, focus ? { id: focus.agent.id, handle: focus.agent.handle, name: focus.agent.name } : null),
          input: transcript(
            history.map((h) =>
              h.role === "assistant"
                ? { role: "assistant" as const, reply: h.content.reply as AssistantReply }
                : { role: h.role, text: h.content.text ?? "" },
            ),
            text,
          ),
          jsonSchema: REPLY_JSON_SCHEMA,
          effort: "medium",
          // Negociar com vários agentes leva mais chamadas por turno.
          timeoutMs: agentCallsEnabled() ? 480_000 : 240_000,
          mcp: {
            servers: {
              app: {
                type: "http",
                url: `http://127.0.0.1:${env.PORT}/mcp/app`,
                headers: { Authorization: `Bearer ${token}` },
              },
            },
            allowedTools: ["mcp__app"],
          },
          onEvent: (ev) => {
            if (ev.type === "tool_use") {
              const tool = ev.name.replace(/^mcp__app__/, "");
              send({ type: "progress", label: progressLabel(tool, ev.input) });
            }
          },
        });

        const parsed = assistantReplySchema.safeParse(result.structured);
        if (!parsed.success) throw new CliError("O assistente respondeu fora do formato esperado");
        const [row] = await db
          .insert(assistantMessages)
          .values({ conversationId: c.id, role: "assistant", content: { reply: parsed.data, ...(trace.entries.length ? { trace: trace.entries } : {}) }, costUsd: result.costUsd })
          .returning();
        await db
          .update(assistantConversations)
          .set({ updatedAt: new Date(), ...(history.length === 0 ? { title: text.slice(0, 60) } : {}) })
          .where(eq(assistantConversations.id, c.id));
        send({ type: "message", message: toMessage(row!) });
      } catch (err) {
        req.log.warn({ err }, "assistant turn failed");
        const message = err instanceof CliError ? err.message : "Falha ao gerar a resposta do assistente";
        // Gravada na conversa: quem recarregou a página vê a falha em vez de esperar para sempre.
        const [failed] = await db
          .insert(assistantMessages)
          .values({ conversationId: c.id, role: "event", content: { text: `O agente não conseguiu responder: ${message}` } })
          .returning();
        send({ type: "message", message: toMessage(failed!) });
        send({ type: "error", message });
      } finally {
        trace.stop();
        revoke();
        busy.delete(userId);
        running--;
        reply.raw.end();
      }
    },
  );

  /**
   * Executa um confirm call_agent que o usuário clicou. O cliente manda só a referência do componente
   * (`${id da mensagem}:${índice}`): a chamada executada é a que o assistente propôs, sem edição, e
   * cada componente roda uma vez só (um pagamento não se repete por duplo clique ou reenvio).
   * O resultado entra na conversa como evento, gravado pelo servidor.
   */
  app.post<{ Params: { id: string } }>(
    "/api/assistant/conversations/:id/agent-call",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!agentCallsEnabled()) throw new HttpError(404, "not_found", "Chamadas a agentes estão desligadas nesta instância");
      const c = await ownConversation(req);
      const { ref } = z.object({ ref: z.string().regex(/^[0-9a-f-]{36}:\d{1,2}$/i) }).parse(req.body);
      const [messageId, index] = [ref.split(":")[0]!, Number(ref.split(":")[1])];

      const [msg] = await db
        .select()
        .from(assistantMessages)
        .where(and(eq(assistantMessages.id, messageId), eq(assistantMessages.conversationId, c.id)))
        .limit(1);
      const component = msg?.role === "assistant" ? (msg.content.reply as AssistantReply).ui[index] : undefined;
      if (component?.type !== "confirm" || component.action !== "call_agent" || !component.tool) {
        throw new HttpError(400, "invalid_ref", "Este componente não é uma chamada a agente");
      }
      const events = await db
        .select({ content: assistantMessages.content })
        .from(assistantMessages)
        .where(and(eq(assistantMessages.conversationId, c.id), eq(assistantMessages.role, "event")));
      if (events.some((e) => e.content.ref === ref) || callsInFlight.has(ref)) {
        throw new HttpError(409, "already_done", "Esta ação já foi executada");
      }

      let args: Record<string, unknown>;
      try {
        const parsed: unknown = component.arguments_json ? JSON.parse(component.arguments_json) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        args = parsed as Record<string, unknown>;
      } catch {
        throw new HttpError(400, "invalid_arguments", "Os argumentos propostos não são um objeto JSON");
      }

      callsInFlight.add(ref);
      try {
        let text: string;
        try {
          const target = await resolveTarget(component.agent_id, req.user!.id);
          const caller = `@${(await ensurePersonalAgent(req.user!)).handle}`;
          const r = await callAgentTool(target, caller, component.tool, args, { confirmed: true });
          const who = r.agent.handle ?? r.agent.name;
          const verb = r.isError ? "Falhou" : "Confirmou";
          text = `${verb} ${r.tool} com ${who} (${r.agent.id} v${r.agent.version}): ${JSON.stringify(r.result)}`;
        } catch (err) {
          if (!(err instanceof AgentCallError)) throw err;
          text = `Falhou ${component.tool} com ${component.agent_id}: ${err.message}`;
        }
        const [row] = await db
          .insert(assistantMessages)
          .values({ conversationId: c.id, role: "event", content: { text: text.slice(0, 10_000), ref } })
          .returning();
        await db.update(assistantConversations).set({ updatedAt: new Date() }).where(eq(assistantConversations.id, c.id));
        return reply.status(201).send(toMessage(row!));
      } finally {
        callsInFlight.delete(ref);
      }
    },
  );

  /** Executa a consulta de um gráfico ou tabela do chat, com a sessão do usuário. */
  app.post("/api/assistant/query", async (req) => {
    const q = querySchema.safeParse((req.body as { query?: unknown } | undefined)?.query);
    if (!q.success) throw new HttpError(400, "invalid_query", q.error.issues[0]?.message ?? "Consulta inválida");
    try {
      return await runQuery(q.data, req.user!.id);
    } catch (err) {
      if (err instanceof QueryError) throw new HttpError(400, "invalid_query", err.message);
      throw err;
    }
  });
}
