/**
 * Assistente (harness): contrato entre o modelo, a API e o chat.
 *
 * O modelo responde sempre { message, ui[] }. `ui` usa um catálogo fechado de componentes:
 * nada de HTML livre. Componentes que mostram dados guardam uma *referência* (IDs ou uma consulta),
 * nunca os dados em si — o chat busca os valores na API com a sessão do usuário, então o modelo
 * não tem como inventar números nem mostrar o que o usuário não pode ver.
 *
 * Usa zod/v4 para gerar o JSON Schema passado ao `claude -p --json-schema`.
 */
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Consultas declarativas (gráficos e tabelas)
// ---------------------------------------------------------------------------

/** Campos permitidos por dataset. O executor (API) só aceita estes; o resto é rejeitado. */
export const QUERY_DATASETS = {
  /** Agentes do usuário. */
  my_agents: {
    dimensions: ["agent_name", "visibility", "auth", "transport", "tag", "created_at", "updated_at", "hub_status"],
    measures: ["versions_count", "tools_count"],
  },
  /** Versões dos agentes do usuário. */
  my_versions: {
    dimensions: ["agent_name", "version", "status", "auth", "tag", "published_at", "major", "is_prerelease"],
    measures: ["tools_count"],
  },
  /** Catálogo público desta instância (inclui agentes federados, no hub). */
  catalog: {
    dimensions: ["agent_name", "owner", "origin", "auth", "transport", "tag", "updated_at"],
    measures: ["tools_count", "versions_count"],
  },
} as const;
export type QueryDataset = keyof typeof QUERY_DATASETS;

export const DATE_FIELDS = ["created_at", "updated_at", "published_at"] as const;
export const DATE_BUCKETS = ["day", "week", "month", "year"] as const;

const datasetEnum = z.enum(Object.keys(QUERY_DATASETS) as [QueryDataset, ...QueryDataset[]]);
const allFields = [
  ...new Set(Object.values(QUERY_DATASETS).flatMap((d) => [...d.dimensions, ...d.measures])),
] as [string, ...string[]];
const fieldEnum = z.enum(allFields);

export const querySchema = z
  .object({
    dataset: datasetEnum,
    filters: z
      .array(
        z
          .object({
            field: fieldEnum,
            op: z.enum(["=", "!=", "in", ">=", "<=", "contains"]),
            value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
          })
          .strict(),
      )
      .max(10)
      .optional(),
    group_by: z
      .array(
        z
          .object({
            field: fieldEnum,
            bucket: z.enum(DATE_BUCKETS).optional().describe("Obrigatório para campos de data"),
          })
          .strict(),
      )
      .max(2)
      .optional(),
    metric: z
      .object({
        op: z.enum(["count", "count_distinct", "sum", "avg"]),
        field: fieldEnum.optional().describe("Obrigatório exceto em count"),
      })
      .strict(),
    sort: z.enum(["value_desc", "value_asc", "label_asc"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type Query = z.infer<typeof querySchema>;

/** Resultado de uma consulta: linhas com as dimensões agrupadas e o valor. */
export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Componentes de UI
// ---------------------------------------------------------------------------

const remote = z.object({ type: z.enum(["streamable-http", "sse"]), url: z.string() }).strict();
const auth = z.enum(["none", "api_key", "oauth2", "other"]);

/** Formulários de ações: o modelo só preenche valores iniciais; campos e envio são do código. */
const formComponent = z.discriminatedUnion("form", [
  z
    .object({
      type: z.literal("form"),
      form: z.literal("create_agent"),
      initial: z
        .object({
          name: z.string(),
          handle: z.string().describe("Endereço @ sem o @, ex.: lago-sul"),
          summary: z.string(),
          tags: z.array(z.string()),
          visibility: z.enum(["public", "unlisted"]),
          version: z.string(),
          description: z.string(),
          remotes: z.array(remote),
          auth: auth,
          tools_json: z.string().describe("tools/list em JSON, se o usuário informou"),
        })
        .partial()
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("form"),
      form: z.literal("publish_version"),
      agent_id: z.string(),
      initial: z
        .object({
          version: z.string(),
          description: z.string(),
          remotes: z.array(remote),
          auth: auth,
          tools_json: z.string(),
        })
        .partial()
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("form"),
      form: z.literal("edit_agent"),
      agent_id: z.string(),
      initial: z
        .object({
          name: z.string(),
          handle: z.string(),
          summary: z.string(),
          tags: z.array(z.string()),
          visibility: z.enum(["public", "unlisted"]),
        })
        .partial()
        .strict(),
    })
    .strict(),
]);

/**
 * Ações de um clique que mudam dados ou assumem compromissos: sempre confirmadas pelo usuário.
 * call_agent: chamada a uma ferramenta de outro agente que exige confirmação (fechar negócio, pagar);
 * agent_id aceita ID ou @handle.
 */
const confirmComponent = z
  .object({
    type: z.literal("confirm"),
    action: z.enum(["yank_version", "unyank_version", "delete_agent", "set_visibility", "call_agent"]),
    agent_id: z.string(),
    tool: z.string().optional().describe("call_agent: ferramenta do agente"),
    arguments_json: z.string().optional().describe("call_agent: argumentos da ferramenta, em JSON"),
    version: z.string().optional(),
    visibility: z.enum(["public", "unlisted"]).optional(),
    reason: z.string().optional(),
    summary: z.string().describe("Uma frase dizendo o que acontece ao confirmar"),
  })
  .strict();

const agentCardsComponent = z
  .object({
    type: z.literal("agent_cards"),
    source: z.enum(["mine", "catalog"]),
    ids: z.array(z.string()).min(1).max(12),
    choose: z
      .boolean()
      .optional()
      .describe("true: cada card ganha o botão 'Conversar com este', que envia a escolha do usuário como a próxima mensagem"),
  })
  .strict();

const chartComponent = z
  .object({
    type: z.literal("chart"),
    chart: z.enum(["bar", "stacked_bar", "line", "area", "pie"]),
    title: z.string(),
    query: querySchema,
  })
  .strict();

const tableComponent = z
  .object({
    type: z.literal("table"),
    title: z.string(),
    query: querySchema,
  })
  .strict();

export const uiComponentSchema = z.union([
  formComponent,
  confirmComponent,
  agentCardsComponent,
  chartComponent,
  tableComponent,
]);
export type UiComponent = z.infer<typeof uiComponentSchema>;
export type FormComponent = Extract<UiComponent, { type: "form" }>;
export type ConfirmComponent = Extract<UiComponent, { type: "confirm" }>;

export const assistantReplySchema = z
  .object({
    message: z.string().describe("Resposta em Markdown para o usuário, em português: curta, só o essencial"),
    details: z
      .string()
      .optional()
      .describe("Markdown que o chat mostra recolhido em 'Detalhes': tabelas, rodadas de negociação, comprovantes, explicações longas"),
    ui: z.array(uiComponentSchema).max(4),
  })
  .strict();
export type AssistantReply = z.infer<typeof assistantReplySchema>;

// ---------------------------------------------------------------------------
// Conversa
// ---------------------------------------------------------------------------

/**
 * Uma conversa do assistente (o agente pessoal do usuário) com outro agente: a ferramenta chamada,
 * o que foi enviado e o que voltou. É o que o chat mostra como os bastidores da negociação.
 */
export interface AgentTraceEntry {
  at: string;
  agent: { id: string; handle: string | null; name: string };
  tool: string;
  arguments: Record<string, unknown>;
  /** false: o agente respondeu com erro, ou a chamada não aconteceu (ex.: compromisso sem confirmação). */
  ok: boolean;
  /** Resposta do agente (structuredContent ou texto), ou o motivo da falha. */
  result: unknown;
  ms: number;
  /**
   * Quem fez a chamada, quando não foi o agente pessoal: um agente que ele chamou e que contou as próprias trocas
   * (ex.: o @tbuilder negociando com os fornecedores). Ausente = o agente pessoal.
   */
  via?: { id: string; handle: string | null; name: string };
  /**
   * "decision": não é uma troca, é uma escolha que o agente explica (ex.: o @tbuilder dizendo de que o evento precisa
   * e quais parceiros achou). O chat mostra formatada, antes das trocas. result: { titulo, necessidades: [{ nome,
   * motivo, tags, encontrados }] }.
   */
  kind?: "decision";
}

export type AssistantMessage =
  | { id: string; role: "user"; text: string; createdAt: string }
  | {
      id: string;
      role: "assistant";
      reply: AssistantReply;
      createdAt: string;
      costUsd: number | null;
      /** Conversas com outros agentes durante o turno, na ordem (ausente quando não houve). */
      trace?: AgentTraceEntry[];
    }
  /**
   * Algo que o usuário fez a partir de um componente (enviou formulário, confirmou ação).
   * `ref` = `${id da mensagem do assistente}:${índice do componente}`, para o chat mostrar o componente como concluído.
   */
  | { id: string; role: "event"; text: string; ref: string | null; createdAt: string };

/** Grupo de frases do /ex: as gerais (agent null) ou as de um agente, escritas pelo dono na versão. */
export interface ExampleGroup {
  title: string;
  agent: { id: string; handle: string | null; name: string } | null;
  phrases: string[];
}

export interface AssistantConversation {
  id: string;
  title: string;
  /** Agente do usuário sobre o qual é a conversa (escolhido no app); null = conversa geral. */
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Eventos do turno, enviados por SSE enquanto a CLI trabalha. */
export type TurnEvent =
  | { type: "progress"; label: string }
  | { type: "message"; message: AssistantMessage }
  /** Uma conversa com outro agente, assim que ela termina. */
  | { type: "trace"; entry: AgentTraceEntry }
  | { type: "error"; message: string };
