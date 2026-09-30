import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AgentKind, AgentTool, AgentTraceEntry, AuthType, Remote, VersionStatus, Visibility } from "@agentikal/shared";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** Perfil semântico gerado por LLM (opcional) a partir da versão latest; alimenta a busca. */
export interface SemanticProfile {
  /** Versão de onde o perfil foi gerado; perfis de versões antigas são regerados. */
  version: string;
  capabilities: string[];
  keywords: string[];
  exampleQueries: string[];
  generatedAt: string;
  generator: string;
}

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Cada login é um tenant: dono dos próprios agentes. As contas vivem no Keycloak (realm do app, cadastro
 * fechado); aqui fica o tenant, ligado à conta pelo `sub` (ou pelo e-mail no primeiro login).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  // Identificador da conta no Keycloak.
  oidcSub: text("oidc_sub").unique(),
  // Legado (login local, antes do Keycloak); não é mais usado para entrar.
  passwordHash: text("password_hash"),
  ...timestamps,
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    // Guardamos só o hash SHA-256 do token; o token em si fica apenas no cookie.
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // id_token do Keycloak: permite encerrar a sessão lá também no logout.
    idToken: text("id_token"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * Hub: nós federados aprovados. Cada nó tem um código de 2 caracteres (embutido nos IDs que gera)
 * e uma chave pública Ed25519 que assina os envios.
 */
export const federationNodes = pgTable("federation_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: char("code", { length: 2 }).notNull().unique(),
  name: text("name").notNull(),
  /** Sufixo dos handles dos agentes deste nó no hub: @lago-sul.<slug>. */
  slug: text("slug").notNull().unique(),
  /** Chave pública Ed25519 em SPKI/DER, base64. */
  publicKey: text("public_key").notNull(),
  status: text("status").$type<"active" | "suspended">().notNull().default("active"),
  ...timestamps,
  lastPushAt: timestamp("last_push_at", { withTimezone: true }),
});

/** Identidade estável do agente. O ID nunca muda nem é reutilizado; remoção é lógica (410 Gone). */
export const agents = pgTable(
  "agents",
  {
    id: char("id", { length: 12 }).primaryKey(),
    /** Dono local. Nulo nos agentes recebidos de um nó federado (ver originNodeId). */
    ownerId: uuid("owner_id").references(() => users.id),
    /** Hub: nó de onde o agente veio. Nulo nos agentes hospedados no próprio registry. */
    originNodeId: uuid("origin_node_id").references(() => federationNodes.id),
    originUrl: text("origin_url"),
    remoteOwnerName: text("remote_owner_name"),
    /** Incrementada a cada mudança; ordena os snapshots da federação (a maior vence). */
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    /**
     * mcp: agente publicado, com versões e endpoints. personal: o agente do próprio usuário (o assistente),
     * um por tenant; tem endereço @ e página, mas nenhuma versão, e nunca vai ao catálogo nem ao hub.
     */
    kind: text("kind").$type<AgentKind>().notNull().default("mcp"),
    name: text("name").notNull(),
    /**
     * Endereço @, sem o @ (packages/shared/src/handle.ts). Único na instância, inclusive entre removidos,
     * para ninguém herdar o endereço de um agente apagado. No hub, agentes de nós levam o sufixo do nó.
     * Nulo só em agentes recebidos de nós que ainda não enviam handle.
     */
    handle: text("handle").unique(),
    summary: text("summary").notNull().default(""),
    visibility: text("visibility").$type<Visibility>().notNull().default("unlisted"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    semanticProfile: jsonb("semantic_profile").$type<SemanticProfile>(),
    // Desnormalização da versão latest (lib/search.ts), para filtros exatos na busca.
    latestVersion: text("latest_version"),
    latestTransports: text("latest_transports").array().notNull().default(sql`'{}'::text[]`),
    latestAuth: text("latest_auth").$type<AuthType>(),
    /** Mantido pela aplicação (lib/search.ts): nome, tags, resumo, ferramentas e descrição da latest. */
    searchDoc: tsvector("search_doc"),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("agents_owner_idx").on(t.ownerId),
    // Catálogo: só agentes públicos e não removidos, ordenados por atualização.
    index("agents_catalog_idx").on(t.updatedAt).where(sql`${t.visibility} = 'public' and ${t.deletedAt} is null`),
    index("agents_search_idx").using("gin", t.searchDoc),
    index("agents_tags_idx").using("gin", t.tags),
    check("agents_visibility_check", sql`${t.visibility} in ('public', 'unlisted')`),
    check("agents_kind_check", sql`${t.kind} in ('mcp', 'personal') and (${t.kind} = 'mcp' or ${t.visibility} = 'unlisted')`),
    // Um agente pessoal (vivo) por usuário.
    uniqueIndex("agents_personal_owner_idx").on(t.ownerId).where(sql`${t.kind} = 'personal' and ${t.deletedAt} is null`),
    // Todo agente tem exatamente uma autoridade: um dono local ou um nó de origem.
    check("agents_authority_check", sql`(${t.ownerId} is null) <> (${t.originNodeId} is null)`),
    index("agents_origin_idx").on(t.originNodeId),
  ],
);

/** Nó: o que já foi enviado ao hub. Agentes com revision > pushedRevision estão pendentes. */
export const federationOutbox = pgTable("federation_outbox", {
  agentId: char("agent_id", { length: 12 })
    .primaryKey()
    .references(() => agents.id),
  pushedRevision: bigint("pushed_revision", { mode: "number" }).notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
});

/** Versão publicada: imutável, exceto pelo status (yank). */
export const agentVersions = pgTable(
  "agent_versions",
  {
    agentId: char("agent_id", { length: 12 })
      .notNull()
      .references(() => agents.id),
    version: text("version").notNull(),
    major: integer("major").notNull(),
    minor: integer("minor").notNull(),
    patch: integer("patch").notNull(),
    prerelease: text("prerelease"),
    description: text("description").notNull(),
    remotes: jsonb("remotes").$type<Remote[]>().notNull(),
    tools: jsonb("tools").$type<AgentTool[]>().notNull().default(sql`'[]'::jsonb`),
    // Frases de exemplo de conversa com o agente (o /ex do chat), escritas pelo dono.
    examples: jsonb("examples").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    auth: text("auth").$type<AuthType>(),
    status: text("status").$type<VersionStatus>().notNull().default("published"),
    yankedReason: text("yanked_reason"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.version] }),
    index("agent_versions_order_idx").on(t.agentId, t.major, t.minor, t.patch),
    check("agent_versions_status_check", sql`${t.status} in ('published', 'yanked')`),
  ],
);

export type AgentRow = typeof agents.$inferSelect;
export type AgentVersionRow = typeof agentVersions.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type FederationNodeRow = typeof federationNodes.$inferSelect;

/** Assistente: conversas de cada usuário. */
export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Nova conversa"),
    // Agente do usuário sobre o qual é a conversa (app Android: escolhe o agente e conversa); null = geral.
    agentId: char("agent_id", { length: 12 }).references(() => agents.id, { onDelete: "set null" }),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assistant_conversations_user_idx").on(t.userId, t.updatedAt),
    index("assistant_conversations_agent_idx").on(t.userId, t.agentId, t.updatedAt),
  ],
);

/**
 * Mensagens: `user` (texto), `assistant` (resposta estruturada { message, ui }) e `event`
 * (o que o usuário fez a partir de um componente, ex.: enviou o formulário de publicação).
 */
export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => assistantConversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "event">().notNull(),
    content: jsonb("content").$type<{ text?: string; reply?: unknown; ref?: string; trace?: AgentTraceEntry[] }>().notNull(),
    costUsd: doublePrecision("cost_usd"),
    ...timestamps,
  },
  (t) => [
    index("assistant_messages_conversation_idx").on(t.conversationId, t.createdAt),
    check("assistant_messages_role_check", sql`${t.role} in ('user', 'assistant', 'event')`),
  ],
);
