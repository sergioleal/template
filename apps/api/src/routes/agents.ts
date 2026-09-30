import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  createAgentSchema,
  generateAgentId,
  parseSemVer,
  publishVersionSchema,
  updateAgentSchema,
  yankVersionSchema,
  type OwnedAgent,
} from "@agentikal/shared";
import { db } from "../db/client.ts";
import { listOwnedAgents, loadOwnedAgent } from "../db/queries.ts";
import { agents, agentVersions } from "../db/schema.ts";
import { requireUser } from "../lib/auth.ts";
import { toOwnedAgent } from "../lib/documents.ts";
import { scheduleEnrichment } from "../lib/enrich.ts";
import { refreshAgentIndex } from "../lib/search.ts";
import { bumpRevision, schedulePush } from "../lib/federation/push.ts";
import { HttpError, isUniqueViolation, notFound, violatedConstraint } from "../lib/errors.ts";
import { availableHandle, HANDLE_CONSTRAINT, handleTaken } from "../lib/handles.ts";
import { ensurePersonalAgent } from "../lib/personal-agent.ts";
import { env } from "../env.ts";
import { presentOwned as present } from "../lib/owned.ts";

type IdParams = { id: string };
type VersionParams = { id: string; version: string };

type PublishedVersion = ReturnType<typeof publishVersionSchema.parse>;

function versionRow(agentId: string, input: PublishedVersion) {
  const sv = parseSemVer(input.version)!;
  return {
    agentId,
    version: input.version,
    major: sv.major,
    minor: sv.minor,
    patch: sv.patch,
    prerelease: sv.prerelease,
    description: input.description,
    remotes: input.remotes,
    tools: input.tools,
    examples: input.examples,
    auth: input.auth,
  };
}

async function ownedOr404(req: FastifyRequest<{ Params: IdParams }>) {
  const found = await loadOwnedAgent(req.params.id.toUpperCase(), req.user!.id);
  if (!found) throw notFound("Agente não encontrado");
  return found;
}

async function reloadOwned(id: string, ownerId: string) {
  const found = await loadOwnedAgent(id, ownerId);
  if (!found) throw notFound("Agente não encontrado");
  return (await present([found]))[0]!;
}

/** Painel do dono. Todas as rotas exigem login e só enxergam agentes do próprio usuário (tenant). */
export async function agentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/agents", async (req) => {
    // O agente pessoal aparece no painel desde o primeiro acesso.
    await ensurePersonalAgent(req.user!);
    return present(await listOwnedAgents(req.user!.id));
  });

  app.post("/api/agents", async (req, reply) => {
    const input = createAgentSchema.parse(req.body);
    const handle = input.handle ?? (await availableHandle(input.name));
    // Colisão de ID é astronomicamente improvável (34^9), mas tratamos com retry.
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = generateAgentId(env.ID_PREFIX, env.NODE_CODE);
      try {
        await db.transaction(async (tx) => {
          await tx.insert(agents).values({
            id,
            ownerId: req.user!.id,
            name: input.name,
            handle,
            summary: input.summary,
            visibility: input.visibility,
            tags: input.tags,
          });
          await tx.insert(agentVersions).values(versionRow(id, input.firstVersion));
          await refreshAgentIndex(id, tx);
        });
        scheduleEnrichment(id);
        schedulePush();
        return reply.status(201).send(await reloadOwned(id, req.user!.id));
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (violatedConstraint(err) === HANDLE_CONSTRAINT) throw handleTaken(handle);
      }
    }
    throw new HttpError(500, "id_generation_failed", "Não foi possível gerar um ID único");
  });

  app.get<{ Params: IdParams }>("/api/agents/:id", async (req) => {
    const found = await ownedOr404(req);
    return (await present([found]))[0]!;
  });

  app.patch<{ Params: IdParams }>("/api/agents/:id", async (req) => {
    const { agent } = await ownedOr404(req);
    const input = updateAgentSchema.parse(req.body);
    if (agent.kind === "personal" && (input.visibility !== undefined || input.tags !== undefined || (input.name !== undefined && input.name !== agent.name))) {
      throw new HttpError(400, "personal_agent", "O agente pessoal se chama \"Agente pessoal\" para todo mundo, é sempre não listado e não tem tags; só o endereço e o resumo mudam");
    }
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(agents)
          .set({ ...input, updatedAt: new Date(), revision: bumpRevision() })
          .where(eq(agents.id, agent.id));
        await refreshAgentIndex(agent.id, tx);
      });
    } catch (err) {
      if (input.handle && violatedConstraint(err) === HANDLE_CONSTRAINT) throw handleTaken(input.handle);
      throw err;
    }
    schedulePush();
    return reloadOwned(agent.id, req.user!.id);
  });

  /** Remoção lógica: o ID continua reservado e as URLs públicas passam a responder 410 Gone. */
  app.delete<{ Params: IdParams }>("/api/agents/:id", async (req, reply) => {
    const { agent } = await ownedOr404(req);
    if (agent.kind === "personal") throw new HttpError(409, "personal_agent", "O agente pessoal não pode ser removido");
    await db
      .update(agents)
      .set({ deletedAt: new Date(), updatedAt: new Date(), revision: bumpRevision() })
      .where(eq(agents.id, agent.id));
    schedulePush();
    return reply.status(204).send();
  });

  /** Versões são imutáveis: republicar o mesmo número é conflito. */
  app.post<{ Params: IdParams }>("/api/agents/:id/versions", async (req, reply) => {
    const { agent } = await ownedOr404(req);
    if (agent.kind === "personal") throw new HttpError(409, "personal_agent", "Agentes pessoais não publicam versões");
    const input = publishVersionSchema.parse(req.body);
    try {
      await db.transaction(async (tx) => {
        await tx.insert(agentVersions).values(versionRow(agent.id, input));
        await tx.update(agents).set({ updatedAt: new Date(), revision: bumpRevision() }).where(eq(agents.id, agent.id));
        await refreshAgentIndex(agent.id, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, "version_exists", `A versão ${input.version} já foi publicada; publique uma nova versão`);
      }
      throw err;
    }
    scheduleEnrichment(agent.id);
    schedulePush();
    return reply.status(201).send(await reloadOwned(agent.id, req.user!.id));
  });

  const setYank = (yanked: boolean) => async (req: FastifyRequest<{ Params: VersionParams }>) => {
    const { agent, versions } = await ownedOr404(req);
    const v = versions.find((x) => x.version === req.params.version);
    if (!v) throw notFound(`Versão ${req.params.version} não encontrada`);
    const reason = yanked ? yankVersionSchema.parse(req.body ?? {}).reason : null;
    await db.transaction(async (tx) => {
      await tx
        .update(agentVersions)
        .set({ status: yanked ? "yanked" : "published", yankedReason: reason || null })
        .where(and(eq(agentVersions.agentId, agent.id), eq(agentVersions.version, v.version)));
      await tx.update(agents).set({ revision: bumpRevision() }).where(eq(agents.id, agent.id));
      await refreshAgentIndex(agent.id, tx);
    });
    scheduleEnrichment(agent.id);
    schedulePush();
    return reloadOwned(agent.id, req.user!.id);
  };

  app.post<{ Params: VersionParams }>("/api/agents/:id/versions/:version/yank", setYank(true));
  app.post<{ Params: VersionParams }>("/api/agents/:id/versions/:version/unyank", setYank(false));
}
