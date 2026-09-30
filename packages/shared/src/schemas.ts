import { z } from "zod";
import { parseSemVer } from "./semver.ts";
import { handleSchema } from "./handle.ts";

export const REMOTE_TYPES = ["streamable-http", "sse"] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .url("URL inválida")
  .refine((u) => /^https?:$/.test(new URL(u).protocol), "A URL deve usar http ou https");

/** Endpoint MCP, no mesmo formato de `remotes` do server.json do MCP Registry. */
export const remoteSchema = z.object({
  type: z.enum(REMOTE_TYPES),
  url: httpUrl,
});
export type Remote = z.infer<typeof remoteSchema>;

/** Como um cliente se autentica no agente. Ajuda outro agente a decidir se consegue conectar. */
export const AUTH_TYPES = ["none", "api_key", "oauth2", "other"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

/**
 * Ferramenta exposta pelo agente, no formato de um item de `tools/list` do MCP.
 * O dono informa (o registry não consulta o agente); é o principal insumo da busca por capacidade.
 */
export const agentToolSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.\-/]{1,128}$/, "Nome de ferramenta inválido (letras, números, _ . - /)"),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  inputSchema: z.record(z.unknown()).optional(),
});
export type AgentTool = z.infer<typeof agentToolSchema>;

export const toolsSchema = z
  .array(agentToolSchema)
  .max(200, "No máximo 200 ferramentas")
  .refine((ts) => new Set(ts.map((t) => t.name)).size === ts.length, "Nomes de ferramenta repetidos");

/**
 * Aceita o que o dono costuma colar: a resposta de tools/list ({ tools: [...] }),
 * o objeto `result` dela, ou só o array.
 */
export function extractTools(input: unknown): unknown {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (Array.isArray(o.tools)) return o.tools;
    if (o.result && typeof o.result === "object" && Array.isArray((o.result as Record<string, unknown>).tools)) {
      return (o.result as Record<string, unknown>).tools;
    }
  }
  return input;
}

/**
 * Frases de exemplo de conversa com o agente, escritas pelo dono: aparecem no /ex do chat, e o usuário toca
 * numa para mandá-la ao seu agente pessoal (ex.: "Pede ao @tbuilder para organizar um team building…").
 */
export const examplesSchema = z
  .array(z.string().trim().min(3, "Frase muito curta").max(300, "No máximo 300 caracteres por frase"))
  .max(20, "No máximo 20 frases")
  .transform((es) => [...new Set(es)]);

export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(TAG_PATTERN, "Tags: letras minúsculas, números e hífen (até 32)"),
  )
  .max(10, "No máximo 10 tags")
  .transform((ts) => [...new Set(ts)]);

export const versionStringSchema = z
  .string()
  .trim()
  .max(128)
  .refine((v) => parseSemVer(v) !== null, "Use o formato x.y.z (ex.: 1.0.0 ou 1.1.0-beta.1)");

export const agentNameSchema = z.string().trim().min(2, "Nome muito curto").max(120);
export const agentSummarySchema = z.string().trim().max(280);

/**
 * public   → aparece no catálogo público e na busca do MCP, e pode ser indexado;
 * unlisted → fora do catálogo e da busca; acessível só por quem tem o link /a/<id>.
 */
/** mcp: agente publicado (versões, endpoints). personal: o agente do próprio usuário no registry (o assistente). */
export const AGENT_KINDS = ["mcp", "personal"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const VISIBILITIES = ["public", "unlisted"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const visibilitySchema = z.enum(VISIBILITIES);

export const publishVersionSchema = z.object({
  version: versionStringSchema,
  description: z.string().trim().min(1, "Descrição obrigatória").max(20_000),
  remotes: z
    .array(remoteSchema)
    .min(1, "Informe ao menos uma URL MCP")
    .max(10)
    .refine((rs) => new Set(rs.map((r) => r.url)).size === rs.length, "URLs repetidas"),
  tools: toolsSchema.default([]),
  auth: z.enum(AUTH_TYPES).nullable().default(null),
  examples: examplesSchema.default([]),
});
export type PublishVersionInput = z.input<typeof publishVersionSchema>;

export const createAgentSchema = z.object({
  name: agentNameSchema,
  /** Endereço @; se ausente, a API deriva um do nome. */
  handle: handleSchema.optional(),
  summary: agentSummarySchema.default(""),
  visibility: visibilitySchema.default("unlisted"),
  tags: tagsSchema.default([]),
  firstVersion: publishVersionSchema,
});
export type CreateAgentInput = z.input<typeof createAgentSchema>;

export const updateAgentSchema = z
  .object({ name: agentNameSchema, handle: handleSchema, summary: agentSummarySchema, visibility: visibilitySchema, tags: tagsSchema })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Nada para atualizar");
export type UpdateAgentInput = z.input<typeof updateAgentSchema>;

export const yankVersionSchema = z.object({
  reason: z.string().trim().max(500).default(""),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(1024),
});

export type VersionStatus = "published" | "yanked";

/** Origem de um agente que vive num nó federado; null nos agentes hospedados no próprio registry. */
export interface AgentOrigin {
  node: { code: string; name: string };
  /** URL canônica do agente no nó de origem. */
  url: string;
}

/**
 * Documento de um agente pessoal (/a/<id>/json, get_agent): quem é o agente e de quem ele é.
 * Serve para a outra ponta de uma conversa conferir com quem está falando; não há versões nem endpoints.
 */
export interface PersonalAgentDocument {
  schemaVersion: "1";
  kind: "personal";
  id: string;
  handle: string;
  name: string;
  summary: string;
  owner: { displayName: string };
  createdAt: string;
  links: { self: string; html: string };
}

/** Documento público servido em /a/<id>/json e /a/<id>/v/<versão>/json. */
export interface AgentDocument {
  schemaVersion: "1";
  kind: "mcp";
  id: string;
  /** Endereço com @ (ex.: "@lago-sul"); null em agentes federados de nós que ainda não enviam handle. */
  handle: string | null;
  name: string;
  summary: string;
  owner: { displayName: string };
  origin: AgentOrigin | null;
  visibility: Visibility;
  tags: string[];
  version: string;
  /** Seletor pedido na URL quando diferente da versão resolvida (ex.: "1" → "1.4.2"). */
  requested?: string;
  status: VersionStatus;
  yankedReason?: string;
  description: string;
  remotes: Remote[];
  auth: AuthType | null;
  tools: AgentTool[];
  /** Frases de exemplo de conversa com o agente (o /ex do chat). */
  examples: string[];
  publishedAt: string;
  links: { self: string; html: string; latest: string; versions: string };
}

export interface VersionListItem {
  version: string;
  status: VersionStatus;
  publishedAt: string;
  links: { json: string; html: string };
}

export interface VersionListDocument {
  schemaVersion: "1";
  id: string;
  name: string;
  latest: string | null;
  versions: VersionListItem[];
}

/** Item do catálogo público (GET /api/catalog) e do search_agents do MCP. */
export interface CatalogItem {
  id: string;
  handle: string | null;
  name: string;
  summary: string;
  owner: { displayName: string };
  origin: AgentOrigin | null;
  tags: string[];
  latest: string;
  remotes: Remote[];
  remoteTypes: RemoteType[];
  auth: AuthType | null;
  tools: { name: string; description?: string }[];
  updatedAt: string;
  /** Relevância da busca (0–1); ausente quando não há termo de busca. */
  score?: number;
  links: { html: string; json: string };
}

export interface CatalogPage {
  schemaVersion: "1";
  query: string;
  total: number;
  page: number;
  pageSize: number;
  items: CatalogItem[];
}

const csv = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim().toLowerCase()).filter(Boolean));

export const catalogQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  tags: csv.default([]),
  transport: z.enum(REMOTE_TYPES).optional(),
  auth: z.enum(AUTH_TYPES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/** Visão do dono (painel), servida em /api/agents. */
export interface OwnedAgent {
  id: string;
  kind: AgentKind;
  /** Sem o @. */
  handle: string;
  name: string;
  summary: string;
  visibility: Visibility;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  latest: string | null;
  /** Presente só quando a instância é um nó federado. */
  federation?: FederationStatus;
  versions: {
    version: string;
    status: VersionStatus;
    yankedReason: string | null;
    description: string;
    remotes: Remote[];
    auth: AuthType | null;
    tools: AgentTool[];
    examples: string[];
    publishedAt: string;
  }[];
}

/** Como a instância se apresenta (GET /api/instance): a interface muda entre hub e nó. */
export interface InstanceInfo {
  mode: "hub" | "node";
  name: string;
  brandColor: string | null;
  nodeCode: string | null;
  /** Só no nó: para onde os agentes públicos são enviados. */
  hub: { url: string } | null;
}

/** Só no nó: situação do agente em relação ao hub. */
export interface FederationStatus {
  /** synced: o hub tem a revisão atual; pending: há mudança a enviar; error: o hub rejeitou ou falhou;
   *  local: nunca foi público, então não sai deste registry. */
  state: "synced" | "pending" | "error" | "local";
  lastAttemptAt: string | null;
  error: string | null;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
}

export interface ApiError {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}
