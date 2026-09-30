/** Visão do dono sobre os próprios agentes; usada pelo painel e pelo assistente. */
import type { OwnedAgent } from "@agentikal/shared";
import { listOwnedAgents, loadOwnedAgent, resolveAgentRef } from "../db/queries.ts";
import type { AgentRow, AgentVersionRow } from "../db/schema.ts";
import { isNode } from "../env.ts";
import { toOwnedAgent } from "./documents.ts";
import { federationStatuses } from "./federation/status.ts";

/** No nó, inclui a situação de cada agente em relação ao hub. */
export async function presentOwned(items: { agent: AgentRow; versions: AgentVersionRow[] }[]): Promise<OwnedAgent[]> {
  const statuses = isNode ? await federationStatuses(items.map((i) => i.agent)) : null;
  return items.map(({ agent, versions }) => {
    const owned = toOwnedAgent(agent, versions);
    const federation = statuses?.get(agent.id);
    return federation ? { ...owned, federation } : owned;
  });
}

export async function ownedAgents(userId: string): Promise<OwnedAgent[]> {
  return presentOwned(await listOwnedAgents(userId));
}

export async function ownedAgent(id: string, userId: string): Promise<OwnedAgent | null> {
  const resolved = await resolveAgentRef(id);
  const found = resolved ? await loadOwnedAgent(resolved, userId) : null;
  return found ? (await presentOwned([found]))[0]! : null;
}
