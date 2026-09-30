/**
 * Ponte do assistente para outros agentes: com ASSISTANT_AGENT_CALLS ligado, o assistente age como o
 * agente do usuário e conversa por MCP com agentes cadastrados no registry.
 *
 * Travas:
 * - O modelo aponta um agente pelo ID ou @handle, nunca por URL: o endpoint vem do cadastro (latest).
 * - Só agentes que o usuário pode ver (públicos, ou dele) e só hosts de ASSISTANT_AGENT_HOSTS.
 *   Redirects são recusados, para um endpoint permitido não desviar a chamada para outro host.
 * - Compromissos precisam do usuário: ferramentas que não se declaram só leitura (readOnlyHint) nem
 *   não destrutivas (destructiveHint: false) no tools/list do próprio agente só rodam depois de um
 *   clique em "confirm" no chat (POST /api/assistant/agent-call). Sem anotação conta como compromisso,
 *   como no padrão do MCP.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LoggingMessageNotificationSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { formatHandle, type AgentTraceEntry } from "@agentikal/shared";
import { isWithdrawnRemote, loadAgent, pickVersion, resolveAgentRef } from "../../db/queries.ts";
import { env } from "../../env.ts";

// Um organizador como o @tbuilder (IA + várias trocas com fornecedores) leva mais que uma consulta simples.
const CALL_TIMEOUT_MS = 120_000;
const MAX_RESULT_CHARS = 8_000;

export class AgentCallError extends Error {}

/**
 * Trocas que o agente chamado teve com outros agentes durante a chamada (ex.: o @tbuilder com os fornecedores):
 * ao vivo, em notificações de log com este logger, e no fim, em `_meta` do resultado. Entram nos bastidores do
 * turno com `via` = o agente chamado. O conteúdo vem de fora: validado, limitado e exibido só como texto.
 */
export const CONVERSATIONS_KEY = "al.agentik/conversas";
const MAX_CONVERSATIONS = 60;
const MAX_CONVERSATION_CHARS = 6_000;

const conversationSchema = z.object({
  at: z.string().max(40),
  agent: z.object({
    id: z.string().max(40).default(""),
    handle: z.string().max(80).nullable().default(null),
    name: z.string().max(120),
  }),
  tool: z.string().max(128),
  arguments: z.record(z.unknown()).default({}),
  ok: z.boolean(),
  result: z.unknown(),
  ms: z.number().nonnegative().max(3_600_000),
  kind: z.literal("decision").optional(),
});

function conversation(raw: unknown, via: NonNullable<AgentTraceEntry["via"]>): AgentTraceEntry | null {
  const parsed = conversationSchema.safeParse(raw);
  if (!parsed.success) return null;
  const e: AgentTraceEntry = { ...parsed.data, result: parsed.data.result ?? null, via };
  if (JSON.stringify(e.result ?? null).length > MAX_CONVERSATION_CHARS) e.result = "(resposta longa demais para os bastidores)";
  if (JSON.stringify(e.arguments).length > MAX_CONVERSATION_CHARS) e.arguments = {};
  return e;
}

export const agentCallsEnabled = () => env.ASSISTANT_AGENT_CALLS;

export interface AgentTarget {
  id: string;
  handle: string | null;
  name: string;
  version: string;
  url: string;
}

/** Resolve o agente e o endpoint streamable-http da latest, aplicando as travas de visibilidade e de host. */
export async function resolveTarget(ref: string, userId: string): Promise<AgentTarget> {
  const id = await resolveAgentRef(ref);
  const found = id ? await loadAgent(id) : null;
  if (!found || found.agent.deletedAt || isWithdrawnRemote(found.agent)) {
    throw new AgentCallError(`Agente ${ref} não encontrado.`);
  }
  if (found.agent.visibility !== "public" && found.agent.ownerId !== userId) {
    throw new AgentCallError(`Agente ${ref} não encontrado.`);
  }
  const latest = pickVersion(found.versions, { kind: "latest" });
  const remote = latest?.remotes.find((r) => r.type === "streamable-http");
  if (!latest || !remote) throw new AgentCallError(`${found.agent.name} não tem endpoint streamable-http publicado.`);
  const host = new URL(remote.url).host.toLowerCase();
  if (!env.ASSISTANT_AGENT_HOSTS.includes(host)) {
    throw new AgentCallError(`O host ${host} de ${found.agent.name} não está liberado para o assistente (ASSISTANT_AGENT_HOSTS).`);
  }
  return {
    id: found.agent.id,
    handle: found.agent.handle ? formatHandle(found.agent.handle) : null,
    name: found.agent.name,
    version: latest.version,
    url: remote.url,
  };
}

const noRedirects: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" });

/** caller: endereço @ do agente pessoal de quem chama, enviado como clientInfo.name. */
async function withClient<T>(target: AgentTarget, caller: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: caller, version: "1.0.0" });
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(target.url), { fetch: noRedirects }), { signal });
    return await fn(client);
  } catch (err) {
    if (err instanceof AgentCallError) throw err;
    throw new AgentCallError(`Falha ao falar com ${target.handle ?? target.name}: ${(err as Error).message}`);
  } finally {
    await client.close().catch(() => {});
  }
}

export const needsConfirmation = (tool: Pick<Tool, "annotations">) =>
  !(tool.annotations?.readOnlyHint === true || tool.annotations?.destructiveHint === false);

/** tools/list ao vivo do agente, com a indicação de quais ferramentas exigem confirmação do usuário. */
export async function listAgentTools(target: AgentTarget, caller: string) {
  const { tools } = await withClient(target, caller, (c) => c.listTools());
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    requires_confirmation: needsConfirmation(t),
  }));
}

export interface AgentCallResult {
  agent: { id: string; handle: string | null; name: string; version: string };
  tool: string;
  isError: boolean;
  /** structuredContent quando o agente manda; senão, o texto. Truncado em MAX_RESULT_CHARS. */
  result: unknown;
  /** As trocas que o agente chamado teve com outros agentes, se contou (ver CONVERSATIONS_KEY). */
  conversations: AgentTraceEntry[];
}

/**
 * Chama uma ferramenta do agente. Sem `confirmed`, recusa ferramentas que exigem confirmação:
 * a anotação é conferida no tools/list ao vivo, e não no manifesto cadastrado.
 */
export async function callAgentTool(
  target: AgentTarget,
  caller: string,
  tool: string,
  args: Record<string, unknown>,
  { confirmed, onConversation }: { confirmed: boolean; onConversation?: (e: AgentTraceEntry) => void },
): Promise<AgentCallResult> {
  const via = { id: target.id, handle: target.handle, name: target.name };
  const conversations: AgentTraceEntry[] = [];
  const add = (raw: unknown) => {
    if (conversations.length >= MAX_CONVERSATIONS) return;
    const e = conversation(raw, via);
    if (!e) return;
    conversations.push(e);
    onConversation?.(e);
  };
  return withClient(target, caller, async (c) => {
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
      if (n.params.logger === CONVERSATIONS_KEY) add(n.params.data);
    });
    const { tools } = await c.listTools();
    const def = tools.find((t) => t.name === tool);
    if (!def) throw new AgentCallError(`${target.handle ?? target.name} não tem a ferramenta ${tool}.`);
    if (!confirmed && needsConfirmation(def)) {
      throw new AgentCallError(
        `${tool} é um compromisso (não se declara só leitura nem não destrutiva): proponha ao usuário um confirm ` +
          `call_agent com agent_id, tool e arguments_json; a chamada só acontece quando ele confirmar.`,
      );
    }
    const r = await c.callTool({ name: tool, arguments: args }, undefined, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    // Sem notificações ao vivo (cliente ou transporte sem stream), as trocas vêm no _meta do resultado.
    if (conversations.length === 0) {
      const meta = (r._meta as Record<string, unknown> | undefined)?.[CONVERSATIONS_KEY];
      if (Array.isArray(meta)) meta.forEach(add);
    }
    const text = (r.content as { type: string; text?: string }[] | undefined)?.find((x) => x.type === "text")?.text ?? "";
    let result: unknown = r.structuredContent ?? text;
    const serialized = JSON.stringify(result);
    if (serialized.length > MAX_RESULT_CHARS) result = `${serialized.slice(0, MAX_RESULT_CHARS)}… (truncado)`;
    return {
      agent: { id: target.id, handle: target.handle, name: target.name, version: target.version },
      tool,
      isError: Boolean(r.isError),
      result,
      conversations,
    };
  });
}
