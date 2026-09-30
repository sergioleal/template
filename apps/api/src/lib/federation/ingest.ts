/**
 * Hub: aplica os snapshots enviados por um nó.
 *
 * Regras de autoridade (o motivo de o envio partir do nó):
 * - um agente que o hub já conhece só aceita snapshots do nó que é a origem dele;
 * - um ID novo só é aceito se estiver no espaço do nó (código embutido no ID), então um nó
 *   nunca consegue ocupar nem sobrescrever IDs do hub ou de outro nó;
 * - revisão menor ou igual à que o hub já tem é descartada (reenvio idempotente).
 * Versões são imutáveis também na federação: um snapshot que altera uma versão já recebida é rejeitado.
 */
import { and, eq, ne } from "drizzle-orm";
import { isValidAgentId, nodeCodeOf, parseSemVer, type AgentSnapshot, type PushResponse } from "@agentikal/shared";
import { db } from "../../db/client.ts";
import { agents, agentVersions, federationNodes, type FederationNodeRow } from "../../db/schema.ts";
import { refreshAgentIndex } from "../search.ts";

type Result = PushResponse["results"][number];

class Rejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Comparação canônica: o jsonb do Postgres reordena chaves, então a ordem não pode importar.
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  }
  return v;
}
const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

async function applySnapshot(node: FederationNodeRow, snap: AgentSnapshot): Promise<Result> {
  if (!isValidAgentId(snap.id)) throw new Rejection("invalid_id", "ID inválido");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(agents).where(eq(agents.id, snap.id)).for("update").limit(1);
    if (existing) {
      if (existing.originNodeId !== node.id) {
        throw new Rejection("id_conflict", "O ID já pertence a outro registro da federação");
      }
      if (existing.revision >= snap.revision) return { id: snap.id, status: "unchanged" as const };
    } else if (nodeCodeOf(snap.id) !== node.code) {
      throw new Rejection("outside_namespace", `O ID não pertence ao espaço do nó ${node.code}`);
    }

    // Remoção ou retirada do catálogo: o hub apaga o conteúdo e guarda só a reserva do ID e a revisão.
    if (snap.deleted || snap.visibility !== "public") {
      const tombstone = {
        name: "",
        handle: null,
        summary: "",
        tags: [] as string[],
        visibility: "unlisted" as const,
        originUrl: null,
        remoteOwnerName: null,
        semanticProfile: null,
        revision: snap.revision,
        updatedAt: new Date(),
        deletedAt: snap.deleted ? new Date() : null,
      };
      if (existing) {
        await tx.delete(agentVersions).where(eq(agentVersions.agentId, snap.id));
        await tx.update(agents).set(tombstone).where(eq(agents.id, snap.id));
      } else {
        await tx.insert(agents).values({ id: snap.id, originNodeId: node.id, ...tombstone });
      }
      await refreshAgentIndex(snap.id, tx);
      return { id: snap.id, status: "applied" as const };
    }

    const current = existing
      ? await tx.select().from(agentVersions).where(eq(agentVersions.agentId, snap.id))
      : [];
    const byVersion = new Map(current.map((v) => [v.version, v]));
    for (const v of snap.versions) {
      if (!parseSemVer(v.version)) throw new Rejection("invalid_version", `Versão inválida: ${v.version}`);
      const old = byVersion.get(v.version);
      if (
        old &&
        (old.description !== v.description ||
          !sameJson(old.remotes, v.remotes) ||
          !sameJson(old.tools, v.tools) ||
          !sameJson(old.examples, v.examples) ||
          old.auth !== v.auth)
      ) {
        throw new Rejection("version_mutated", `A versão ${v.version} já foi recebida com outro conteúdo`);
      }
    }

    // No hub, o endereço do agente leva o slug do nó: @lago-sul.exemplo. O nó é a autoridade do próprio
    // espaço de handles, então quem tinha este handle antes (outro agente do mesmo nó que o trocou) o perde.
    const handle = snap.handle ? `${snap.handle}.${node.slug}` : null;
    if (handle) {
      await tx
        .update(agents)
        .set({ handle: null })
        .where(and(eq(agents.handle, handle), eq(agents.originNodeId, node.id), ne(agents.id, snap.id)));
    }
    const fields = {
      originNodeId: node.id,
      handle,
      originUrl: snap.url,
      remoteOwnerName: snap.ownerDisplayName,
      visibility: "public" as const,
      name: snap.name,
      summary: snap.summary,
      tags: snap.tags,
      revision: snap.revision,
      createdAt: new Date(snap.createdAt),
      updatedAt: new Date(snap.updatedAt),
      deletedAt: null,
    };
    if (existing) await tx.update(agents).set(fields).where(eq(agents.id, snap.id));
    else await tx.insert(agents).values({ id: snap.id, ...fields });

    for (const v of snap.versions) {
      const sv = parseSemVer(v.version)!;
      const row = {
        agentId: snap.id,
        version: v.version,
        major: sv.major,
        minor: sv.minor,
        patch: sv.patch,
        prerelease: sv.prerelease,
        description: v.description,
        remotes: v.remotes,
        tools: v.tools,
        examples: v.examples,
        auth: v.auth,
        status: v.status,
        yankedReason: v.yankedReason,
        publishedAt: new Date(v.publishedAt),
      };
      if (byVersion.has(v.version)) {
        // Só o status (yank) pode mudar numa versão publicada.
        await tx
          .update(agentVersions)
          .set({ status: v.status, yankedReason: v.yankedReason })
          .where(and(eq(agentVersions.agentId, snap.id), eq(agentVersions.version, v.version)));
      } else {
        await tx.insert(agentVersions).values(row);
      }
    }
    await refreshAgentIndex(snap.id, tx);
    return { id: snap.id, status: "applied" as const };
  });
}

export async function ingestPush(node: FederationNodeRow, snapshots: AgentSnapshot[]): Promise<Result[]> {
  const results: Result[] = [];
  for (const snap of snapshots) {
    try {
      results.push(await applySnapshot(node, snap));
    } catch (err) {
      if (!(err instanceof Rejection)) throw err;
      results.push({ id: snap.id, status: "rejected", error: err.code, message: err.message });
    }
  }
  await db.update(federationNodes).set({ lastPushAt: new Date() }).where(eq(federationNodes.id, node.id));
  return results;
}
