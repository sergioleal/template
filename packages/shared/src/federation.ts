/**
 * Protocolo de federação nó → hub (v1).
 *
 * O nó envia snapshots completos dos agentes que mudaram. Snapshot completo (e não delta) deixa o
 * envio idempotente: reenviar é seguro, e o hub descarta o que tiver revisão menor ou igual à que já tem.
 * Privacidade: agentes não listados vão só como marcador ({ id, revision, visibility: "unlisted" }),
 * sem conteúdo, para o hub retirar o que tinha recebido quando o agente era público.
 */
import { z } from "zod";
import { AUTH_TYPES, agentToolSchema, remoteSchema, tagsSchema, VISIBILITIES } from "./schemas.ts";
import { HANDLE_PATTERN } from "./handle.ts";

export const FEDERATION_PROTOCOL = "1";
export const FEDERATION_MAX_BATCH = 50;

/** Cabeçalhos da requisição assinada. A assinatura cobre `${timestamp}\n${sha256(body) em hex}`. */
export const FEDERATION_HEADERS = {
  node: "x-registry-node",
  timestamp: "x-registry-timestamp",
  signature: "x-registry-signature",
} as const;

/** Janela aceita entre o relógio do nó e o do hub, contra reenvio de requisições capturadas. */
export const FEDERATION_MAX_SKEW_MS = 5 * 60_000;

const isoDate = z.string().datetime({ offset: true });

export const snapshotVersionSchema = z.object({
  version: z.string().max(128),
  description: z.string().max(20_000),
  remotes: z.array(remoteSchema).min(1).max(10),
  tools: z.array(agentToolSchema).max(200),
  auth: z.enum(AUTH_TYPES).nullable(),
  // Nós antigos não mandam: sem frases.
  examples: z.array(z.string().max(300)).max(20).default([]),
  status: z.enum(["published", "yanked"]),
  yankedReason: z.string().max(500).nullable(),
  publishedAt: isoDate,
});

const publicSnapshot = z.object({
  id: z.string().length(12),
  revision: z.number().int().positive(),
  deleted: z.literal(false),
  visibility: z.literal("public"),
  name: z.string().min(1).max(120),
  /** Handle local no nó, sem o @ (o hub acrescenta o slug do nó). Opcional: nós antigos não enviam. */
  handle: z.string().regex(HANDLE_PATTERN).optional(),
  summary: z.string().max(280),
  tags: tagsSchema,
  ownerDisplayName: z.string().min(1).max(200),
  /** URL canônica da página do agente no nó. */
  url: z.string().url().max(2048),
  createdAt: isoDate,
  updatedAt: isoDate,
  versions: z.array(snapshotVersionSchema).min(1).max(500),
});

/** Agente que deixou de ser público no nó: o hub remove o conteúdo e mantém só a reserva do ID. */
const withdrawnSnapshot = z.object({
  id: z.string().length(12),
  revision: z.number().int().positive(),
  deleted: z.literal(false),
  visibility: z.enum(VISIBILITIES).exclude(["public"]),
});

const deletedSnapshot = z.object({
  id: z.string().length(12),
  revision: z.number().int().positive(),
  deleted: z.literal(true),
});

export const agentSnapshotSchema = z.union([publicSnapshot, withdrawnSnapshot, deletedSnapshot]);
export type AgentSnapshot = z.infer<typeof agentSnapshotSchema>;
export type PublicAgentSnapshot = z.infer<typeof publicSnapshot>;

export const pushRequestSchema = z.object({
  protocol: z.literal(FEDERATION_PROTOCOL),
  agents: z.array(agentSnapshotSchema).min(1).max(FEDERATION_MAX_BATCH),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export type PushItemStatus = "applied" | "unchanged" | "rejected";

export interface PushResponse {
  protocol: typeof FEDERATION_PROTOCOL;
  node: string;
  results: { id: string; status: PushItemStatus; error?: string; message?: string }[];
}
