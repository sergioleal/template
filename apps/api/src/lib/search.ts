import { and, arrayContains, arrayOverlaps, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { compareSemVer, formatHandle, type CatalogItem, type CatalogQuery } from "@agentikal/shared";
import { db } from "../db/client.ts";
import { ownerAndOriginColumns, pickVersion, toOrigin } from "../db/queries.ts";
import { agents, agentVersions, federationNodes, users } from "../db/schema.ts";
import { agentUrls } from "./documents.ts";

type Executor = Pick<typeof db, "select" | "update">;

/** Minúsculas e sem acentos: "Conciliação" e "conciliacao" viram o mesmo termo. */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// "match_entries" → "match entries", para o parser do Postgres separar as palavras.
const splitIdentifiers = (s: string) => s.replace(/[_./-]+/g, " ");

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Recalcula os campos derivados da latest (versão, transportes, auth) e o documento de busca.
 * Chamar depois de qualquer mudança no agente ou nas versões dele.
 *
 * Pesos: A = nome, handle, tags e nomes de ferramentas; B = resumo e perfil semântico;
 * C = descrições das ferramentas; D = descrição da versão.
 * Indexamos em português (stemming) e em inglês (nomes/descrições de ferramentas costumam ser em inglês).
 */
export async function refreshAgentIndex(agentId: string, exec: Executor = db): Promise<void> {
  const [agent] = await exec.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return;
  const versions = await exec.select().from(agentVersions).where(eq(agentVersions.agentId, agentId));
  versions.sort((a, b) => compareSemVer(b, a));
  const latest = pickVersion(versions, { kind: "latest" });

  const tools = latest?.tools ?? [];
  const profile = agent.semanticProfile;
  const a = normalizeText([agent.name, splitIdentifiers(agent.handle ?? ""), agent.tags.join(" "), tools.map((t) => splitIdentifiers(t.name)).join(" ")].join(" "));
  const b = normalizeText(
    [agent.summary, ...(profile ? [...profile.capabilities, ...profile.keywords, ...profile.exampleQueries] : [])].join(" "),
  );
  const c = normalizeText(tools.map((t) => [t.title, t.description].filter(Boolean).join(" ")).join(" "));
  const d = normalizeText(latest?.description ?? "");

  await exec
    .update(agents)
    .set({
      latestVersion: latest?.version ?? null,
      latestTransports: [...new Set((latest?.remotes ?? []).map((r) => r.type))],
      latestAuth: latest?.auth ?? null,
      searchDoc: sql`
        setweight(to_tsvector('portuguese', ${a}), 'A') || setweight(to_tsvector('english', ${a}), 'A') ||
        setweight(to_tsvector('portuguese', ${b}), 'B') || setweight(to_tsvector('english', ${b}), 'B') ||
        setweight(to_tsvector('portuguese', ${c}), 'C') || setweight(to_tsvector('english', ${c}), 'C') ||
        setweight(to_tsvector('portuguese', ${d}), 'D')`,
    })
    .where(eq(agents.id, agentId));
}

export async function refreshAllAgentIndexes(): Promise<number> {
  const rows = await db.select({ id: agents.id }).from(agents);
  for (const { id } of rows) await refreshAgentIndex(id);
  return rows.length;
}

/**
 * Consulta em linguagem natural → tsquery com OR entre os termos (em vez do AND do plainto),
 * para "preciso de alguém que concilie extratos" casar com agentes que tenham só parte das palavras.
 * O ranking (ts_rank_cd) favorece quem casa mais termos e em campos de peso maior.
 */
function orQuery(config: "portuguese" | "english", q: string): SQL {
  return sql`replace(plainto_tsquery(${config}::regconfig, ${q})::text, '&', '|')::tsquery`;
}

// O lado inglês da consulta não conhece stopwords do português: sem este filtro, o "de" de
// "previsão de vendas" casaria com quase todos os agentes.
const PT_STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de da do das dos em no na nos nas por pelo pela pelos pelas para pra com sem " +
    "e ou que se ao aos como mais muito meu minha meus minhas seu sua eu voce me te lhe isso esse essa este esta " +
    "preciso quero gostaria algum alguma alguem alguns algumas fazer faz tem ter ser estar sobre ate"
  ).split(" "),
);
const withoutPtStopwords = (q: string) =>
  q
    .split(/\s+/)
    .filter((w) => w && !PT_STOPWORDS.has(w))
    .join(" ");

/** Tags dos agentes do catálogo público, com quantos usam cada uma (as mais usadas primeiro). */
export async function catalogTags(limit = 300): Promise<{ tag: string; agents: number }[]> {
  const rows = await db.execute<{ tag: string; agents: number }>(sql`
    select t.tag, count(*)::int as agents
    from ${agents}, unnest(${agents.tags}) as t(tag)
    where ${agents.visibility} = 'public' and ${agents.deletedAt} is null and ${agents.latestVersion} is not null
    group by t.tag
    order by agents desc, t.tag
    limit ${limit}`);
  return [...rows];
}

/** Busca pública: só agentes públicos, não removidos e com uma versão latest resolvível. */
export async function searchPublicAgents(query: CatalogQuery): Promise<{ total: number; items: CatalogItem[] }> {
  const { q, tags, transport, auth, page, pageSize } = query;
  const nq = normalizeText(q);

  const conditions: SQL[] = [eq(agents.visibility, "public"), isNull(agents.deletedAt), isNotNull(agents.latestVersion)];
  if (tags.length) conditions.push(arrayContains(agents.tags, tags));
  if (transport) conditions.push(arrayOverlaps(agents.latestTransports, [transport]));
  if (auth) conditions.push(eq(agents.latestAuth, auth));

  let score: SQL | undefined;
  if (nq) {
    const tsq = sql`(${orQuery("portuguese", nq)} || ${orQuery("english", withoutPtStopwords(nq))})`;
    const like = `%${escapeLike(q)}%`;
    // "@lago" busca pelo endereço; o handle exato vence qualquer outro resultado.
    const hq = q.trim().replace(/^@/, "").toLowerCase();
    const handleLike = `${escapeLike(hq)}%`;
    conditions.push(
      or(
        sql`${agents.searchDoc} @@ ${tsq}`,
        ilike(agents.name, like),
        ilike(agents.handle, handleLike),
        eq(agents.id, q.toUpperCase()),
      )!,
    );
    // ts_rank_cd normalizado para 0–1 (flag 32); casar o nome ou o começo do handle dá bônus.
    score = sql<number>`(ts_rank_cd(coalesce(${agents.searchDoc}, ''::tsvector), ${tsq}, 32)
      + case when ${agents.name} ilike ${like} then 0.5 else 0 end
      + case when ${agents.handle} = ${hq} then 1 when ${agents.handle} ilike ${handleLike} then 0.5 else 0 end)`;
  }
  const where = and(...conditions);

  const [[{ total } = { total: 0 }], rows] = await Promise.all([
    db.select({ total: count() }).from(agents).where(where),
    db
      .select({ agent: agents, ...ownerAndOriginColumns, score: score ?? sql<number>`0` })
      .from(agents)
      .leftJoin(users, eq(users.id, agents.ownerId))
      .leftJoin(federationNodes, eq(federationNodes.id, agents.originNodeId))
      .where(where)
      .orderBy(...(score ? [desc(score)] : []), desc(agents.updatedAt), agents.id)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  const latestRows = rows.length
    ? await db
        .select({ v: agentVersions })
        .from(agentVersions)
        .innerJoin(agents, and(eq(agents.id, agentVersions.agentId), eq(agentVersions.version, agents.latestVersion)))
        .where(inArray(agentVersions.agentId, rows.map((r) => r.agent.id)))
    : [];
  const latestById = new Map(latestRows.map(({ v }) => [v.agentId, v]));

  const items = rows.flatMap((row): CatalogItem[] => {
    const { agent, ownerDisplayName, score: s } = row;
    const v = latestById.get(agent.id);
    if (!v) return [];
    return [
      {
        id: agent.id,
        handle: agent.handle ? formatHandle(agent.handle) : null,
        name: agent.name,
        summary: agent.summary,
        owner: { displayName: ownerDisplayName },
        origin: toOrigin(row, agent),
        tags: agent.tags,
        latest: v.version,
        remotes: v.remotes,
        remoteTypes: [...new Set(v.remotes.map((r) => r.type))],
        auth: v.auth,
        tools: v.tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}) })),
        updatedAt: agent.updatedAt.toISOString(),
        ...(score ? { score: Math.round(Math.min(1, Number(s)) * 1000) / 1000 } : {}),
        links: agentUrls(agent.id),
      },
    ];
  });

  return { total, items };
}
