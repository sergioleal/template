/**
 * Nó: envia ao hub os agentes que mudaram desde o último envio aceito.
 *
 * Pendente = agente com revision > pushedRevision (ou nunca enviado). Roda em intervalo
 * (FEDERATION_PUSH_INTERVAL_SECONDS) e logo depois de cada mudança; também por `npm run federation:push`.
 * Só a conexão de saída do nó para o hub é necessária.
 */
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  FEDERATION_HEADERS,
  FEDERATION_MAX_BATCH,
  FEDERATION_PROTOCOL,
  type AgentSnapshot,
  type PushRequest,
  type PushResponse,
} from "@agentikal/shared";
import { db } from "../../db/client.ts";
import { agents, agentVersions, federationOutbox, users } from "../../db/schema.ts";
import { env, isNode } from "../../env.ts";
import { agentUrls } from "../documents.ts";
import { loadPrivateKey, signPush } from "./crypto.ts";

export function federationConfigError(): string | null {
  if (!isNode) return "REGISTRY_MODE não é node";
  if (!env.HUB_URL) return "HUB_URL não definido";
  if (!env.NODE_CODE) return "NODE_CODE não definido (atribuído pelo hub ao aprovar o nó)";
  if (!env.NODE_PRIVATE_KEY_FILE) return "NODE_PRIVATE_KEY_FILE não definido (gere com npm run federation:keygen)";
  return null;
}

async function buildSnapshot(agentId: string): Promise<AgentSnapshot | null> {
  const [row] = await db
    .select({ agent: agents, ownerDisplayName: users.displayName })
    .from(agents)
    .leftJoin(users, eq(users.id, agents.ownerId))
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!row) return null;
  const { agent } = row;
  if (agent.deletedAt) return { id: agent.id, revision: agent.revision, deleted: true };
  // Não listados não saem do nó: vai só o marcador, para o hub retirar o que tinha.
  if (agent.visibility !== "public") {
    return { id: agent.id, revision: agent.revision, deleted: false, visibility: agent.visibility };
  }
  const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, agent.id));
  if (!versions.length) return null;
  return {
    id: agent.id,
    revision: agent.revision,
    deleted: false,
    visibility: "public",
    name: agent.name,
    ...(agent.handle ? { handle: agent.handle } : {}),
    summary: agent.summary,
    tags: agent.tags,
    ownerDisplayName: row.ownerDisplayName ?? "—",
    url: agentUrls(agent.id).html,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    versions: versions.map((v) => ({
      version: v.version,
      description: v.description,
      remotes: v.remotes,
      tools: v.tools,
      examples: v.examples,
      auth: v.auth,
      status: v.status,
      yankedReason: v.yankedReason,
      publishedAt: v.publishedAt.toISOString(),
    })),
  };
}

async function send(body: PushRequest): Promise<PushResponse> {
  const raw = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const signature = signPush(loadPrivateKey(env.NODE_PRIVATE_KEY_FILE!), timestamp, raw);
  const res = await fetch(`${env.HUB_URL}/federation/v1/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [FEDERATION_HEADERS.node]: env.NODE_CODE!,
      [FEDERATION_HEADERS.timestamp]: timestamp,
      [FEDERATION_HEADERS.signature]: signature,
    },
    body: raw,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => null)) as (PushResponse & { message?: string }) | null;
  if (!res.ok || !data) throw new Error(`Hub respondeu ${res.status}: ${data?.message ?? res.statusText}`);
  return data;
}

export interface PushSummary {
  sent: number;
  applied: number;
  unchanged: number;
  rejected: { id: string; error?: string; message?: string }[];
}

/** Envia tudo o que estiver pendente, em lotes. Falha de rede mantém o item pendente; rejeição do hub, não. */
export async function pushPending(): Promise<PushSummary> {
  const configError = federationConfigError();
  if (configError) throw new Error(`Federação não configurada: ${configError}`);

  const summary: PushSummary = { sent: 0, applied: 0, unchanged: 0, rejected: [] };
  const pending = await db
    .select({ id: agents.id, revision: agents.revision, everSent: federationOutbox.agentId })
    .from(agents)
    .leftJoin(federationOutbox, eq(federationOutbox.agentId, agents.id))
    .where(
      and(
        isNull(agents.originNodeId),
        // O agente pessoal nunca sai deste registry, nem como marcador.
        eq(agents.kind, "mcp"),
        or(isNull(federationOutbox.agentId), gt(agents.revision, federationOutbox.pushedRevision)),
      ),
    )
    .orderBy(asc(agents.updatedAt));

  for (let i = 0; i < pending.length; i += FEDERATION_MAX_BATCH) {
    const batch = pending.slice(i, i + FEDERATION_MAX_BATCH);
    const now = new Date();
    const snapshots: AgentSnapshot[] = [];
    for (const p of batch) {
      const snap = await buildSnapshot(p.id);
      if (!snap) continue;
      // Agente que nunca foi enviado e não é público: o hub não precisa nem saber que ele existe.
      if (!p.everSent && (snap.deleted || snap.visibility !== "public")) {
        await recordAttempt(p.id, snap.revision, now, null);
        continue;
      }
      snapshots.push(snap);
    }
    if (!snapshots.length) continue;

    let response: PushResponse;
    try {
      response = await send({ protocol: FEDERATION_PROTOCOL, agents: snapshots });
    } catch (err) {
      // Só atualiza registros existentes: sem linha no outbox, o agente continua "nunca enviado".
      const message = (err as Error).message;
      for (const s of snapshots) {
        await db
          .update(federationOutbox)
          .set({ lastAttemptAt: now, lastError: message })
          .where(eq(federationOutbox.agentId, s.id));
      }
      throw err;
    }
    summary.sent += snapshots.length;
    const revisionById = new Map(snapshots.map((s) => [s.id, s.revision]));
    for (const r of response.results) {
      if (r.status === "rejected") {
        // Rejeição é definitiva para esta revisão: marca como tratada e registra o motivo;
        // o agente volta a ser enviado na próxima mudança.
        summary.rejected.push({ id: r.id, error: r.error, message: r.message });
        await recordAttempt(r.id, revisionById.get(r.id) ?? 0, now, `${r.error}: ${r.message}`);
      } else {
        summary[r.status]++;
        await recordAttempt(r.id, revisionById.get(r.id) ?? 0, now, null);
      }
    }
  }
  return summary;
}

async function recordAttempt(agentId: string, pushedRevision: number, at: Date, error: string | null) {
  await db
    .insert(federationOutbox)
    .values({ agentId, pushedRevision, lastAttemptAt: at, lastError: error })
    .onConflictDoUpdate({
      target: federationOutbox.agentId,
      set: { pushedRevision, lastAttemptAt: at, lastError: error },
    });
}

/** Incrementa a revisão do agente; chamar em toda mudança que o hub precisa receber. */
export const bumpRevision = () => sql`${agents.revision} + 1`;

let timer: NodeJS.Timeout | undefined;
let running: Promise<void> | null = null;
let again = false;

/** Dispara um envio sem bloquear a requisição; envios concorrentes são agrupados. */
export function schedulePush(log: (msg: string) => void = console.error): void {
  if (federationConfigError()) return;
  if (running) {
    again = true;
    return;
  }
  running = pushPending()
    .then((s) => {
      if (s.rejected.length) log(`[federation] ${s.rejected.length} rejeitado(s): ${JSON.stringify(s.rejected)}`);
    })
    .catch((err) => log(`[federation] envio falhou: ${(err as Error).message}`))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        schedulePush(log);
      }
    });
}

export function startPushLoop(log: (msg: string) => void): void {
  if (federationConfigError() || timer) return;
  schedulePush(log);
  timer = setInterval(() => schedulePush(log), env.FEDERATION_PUSH_INTERVAL_SECONDS * 1000);
  timer.unref();
}

export function stopPushLoop(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
