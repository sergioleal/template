import { and, eq, isNull, sql } from "drizzle-orm";
import {
  compareSemVer,
  isValidAgentId,
  normalizeAgentId,
  parseHandleAddress,
  resolveVersion,
  type AgentOrigin,
  type VersionSelector,
} from "@agentikal/shared";
import { db } from "./client.ts";
import { agents, agentVersions, federationNodes, users, type AgentRow, type AgentVersionRow } from "./schema.ts";

export interface AgentWithVersions {
  agent: AgentRow;
  ownerDisplayName: string;
  /** Nó de origem (agente recebido pela federação); null quando hospedado aqui. */
  origin: AgentOrigin | null;
  /** Ordenadas da mais nova para a mais antiga (precedência semver). */
  versions: AgentVersionRow[];
}

/**
 * Colunas para juntar dono local e nó de origem numa consulta de agentes
 * (usar com leftJoin(users) e leftJoin(federationNodes)).
 */
export const ownerAndOriginColumns = {
  ownerDisplayName: sql<string>`coalesce(${users.displayName}, ${agents.remoteOwnerName}, '—')`,
  originCode: federationNodes.code,
  originName: federationNodes.name,
};

export const toOrigin = (r: { originCode: string | null; originName: string | null }, agent: AgentRow): AgentOrigin | null =>
  r.originCode && r.originName ? { node: { code: r.originCode, name: r.originName }, url: agent.originUrl ?? "" } : null;

/**
 * Resolve uma referência a agente: ID (em qualquer caixa, com ou sem hífens) ou endereço @handle.
 * Retorna o ID canônico, ou null se a referência não for válida ou o handle não existir.
 */
export async function resolveAgentRef(ref: string): Promise<string | null> {
  const trimmed = ref.trim();
  if (trimmed.startsWith("@")) {
    const handle = parseHandleAddress(trimmed);
    if (!handle) return null;
    const [row] = await db.select({ id: agents.id }).from(agents).where(eq(agents.handle, handle)).limit(1);
    return row?.id ?? null;
  }
  const id = normalizeAgentId(trimmed);
  return isValidAgentId(id) ? id : null;
}

/** Carrega o agente (inclusive removido) com todas as versões. Agentes têm poucas versões, então ordenamos em memória. */
export async function loadAgent(id: string): Promise<AgentWithVersions | null> {
  const [row] = await db
    .select({ agent: agents, ...ownerAndOriginColumns })
    .from(agents)
    .leftJoin(users, eq(users.id, agents.ownerId))
    .leftJoin(federationNodes, eq(federationNodes.id, agents.originNodeId))
    .where(eq(agents.id, id))
    .limit(1);
  if (!row) return null;
  const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, id));
  versions.sort((a, b) => compareSemVer(b, a));
  return { agent: row.agent, ownerDisplayName: row.ownerDisplayName, origin: toOrigin(row, row.agent), versions };
}

/** Agente federado que o nó retirou do catálogo: o hub não tem conteúdo para mostrar. */
export const isWithdrawnRemote = (agent: AgentRow) => Boolean(agent.originNodeId) && agent.visibility !== "public";

export function pickVersion(versions: AgentVersionRow[], selector: VersionSelector): AgentVersionRow | null {
  return resolveVersion(
    versions.map((v) => ({ ...v, yanked: v.status === "yanked" })),
    selector,
  );
}

export async function listOwnedAgents(ownerId: string) {
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.ownerId, ownerId), isNull(agents.deletedAt)))
    .orderBy(agents.createdAt);
  const versions = rows.length
    ? await db.select().from(agentVersions).innerJoin(agents, eq(agents.id, agentVersions.agentId)).where(
        and(eq(agents.ownerId, ownerId), isNull(agents.deletedAt)),
      )
    : [];
  const byAgent = new Map<string, AgentVersionRow[]>();
  for (const { agent_versions: v } of versions) {
    const list = byAgent.get(v.agentId) ?? [];
    list.push(v);
    byAgent.set(v.agentId, list);
  }
  return rows.map((agent) => {
    const vs = (byAgent.get(agent.id) ?? []).sort((a, b) => compareSemVer(b, a));
    return { agent, versions: vs };
  });
}

/** Busca um agente do dono; agentes de outros donos ou removidos são indistinguíveis de inexistentes. */
export async function loadOwnedAgent(id: string, ownerId: string): Promise<AgentWithVersions | null> {
  const found = await loadAgent(id);
  if (!found || found.agent.ownerId !== ownerId || found.agent.deletedAt) return null;
  return found;
}
