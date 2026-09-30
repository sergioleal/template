/**
 * Frases do /ex do chat: as gerais (o que o agente pessoal faz no registry) e as de cada agente, escritas pelo dono
 * na versão (agent_versions.examples). Entram os agentes do usuário e os públicos do catálogo que declararam frases,
 * os do usuário primeiro.
 */
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { ExampleGroup } from "@agentikal/shared";
import { db } from "../../db/client.ts";
import { agents, agentVersions } from "../../db/schema.ts";

const GERAIS: ExampleGroup[] = [
  {
    title: "Seus agentes e o catálogo",
    agent: null,
    phrases: [
      "Quais agentes eu tenho e qual a versão latest de cada um?",
      "Mostre um gráfico de versões publicadas por mês",
      "Quero registrar um agente novo",
      "Quantos agentes do catálogo usam cada tipo de autenticação?",
    ],
  },
  {
    title: "Agentes que você pode contatar",
    agent: null,
    phrases: ["Quais agentes você consegue contatar e por quê?", "Quem é você e qual é o seu endereço?"],
  },
];

const MAX_AGENTES = 12;

export async function exampleGroups(userId: string): Promise<ExampleGroup[]> {
  const rows = await db
    .select({ id: agents.id, handle: agents.handle, name: agents.name, ownerId: agents.ownerId, examples: agentVersions.examples })
    .from(agents)
    .innerJoin(agentVersions, and(eq(agentVersions.agentId, agents.id), eq(agentVersions.version, agents.latestVersion)))
    .where(
      and(
        isNull(agents.deletedAt),
        eq(agents.kind, "mcp"),
        or(eq(agents.visibility, "public"), eq(agents.ownerId, userId)),
        sql`jsonb_array_length(${agentVersions.examples}) > 0`,
      ),
    )
    .orderBy(sql`(${agents.ownerId} = ${userId}) desc`, desc(agents.updatedAt))
    .limit(MAX_AGENTES);
  return [
    ...GERAIS,
    ...rows.map((r) => ({
      title: r.name,
      agent: { id: r.id, handle: r.handle ? `@${r.handle}` : null, name: r.name },
      phrases: r.examples,
    })),
  ];
}
