/** Nó: situação de cada agente em relação ao hub, para o painel do dono. */
import { inArray } from "drizzle-orm";
import type { FederationStatus } from "@agentikal/shared";
import { db } from "../../db/client.ts";
import { federationOutbox, type AgentRow } from "../../db/schema.ts";

export async function federationStatuses(rows: AgentRow[]): Promise<Map<string, FederationStatus>> {
  const out = new Map<string, FederationStatus>();
  if (!rows.length) return out;
  const outbox = await db
    .select()
    .from(federationOutbox)
    .where(
      inArray(
        federationOutbox.agentId,
        rows.map((r) => r.id),
      ),
    );
  const byId = new Map(outbox.map((o) => [o.agentId, o]));

  for (const agent of rows) {
    const o = byId.get(agent.id);
    const isPublic = agent.visibility === "public" && !agent.deletedAt;
    const base = { lastAttemptAt: o?.lastAttemptAt?.toISOString() ?? null, error: o?.lastError ?? null };
    let state: FederationStatus["state"];
    if (o?.lastError) state = "error";
    else if (!o) state = isPublic ? "pending" : "local";
    else if (agent.revision > o.pushedRevision) state = "pending";
    else state = isPublic ? "synced" : "local";
    out.set(agent.id, { state, ...base });
  }
  return out;
}
