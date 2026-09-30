/**
 * Manutenção da busca.
 *   npm run search:reindex            recalcula latest desnormalizada e documento full-text de todos os agentes
 *   npm run search:enrich [-- --force] gera o perfil semântico via Claude CLI (agentes públicos com latest)
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, sql } from "../src/db/client.ts";
import { agents } from "../src/db/schema.ts";
import { enrichAgent } from "../src/lib/enrich.ts";
import { refreshAllAgentIndexes } from "../src/lib/search.ts";

const [command, ...flags] = process.argv.slice(2);

if (command === "reindex") {
  console.log(`${await refreshAllAgentIndexes()} agentes reindexados`);
} else if (command === "enrich") {
  const force = flags.includes("--force");
  const rows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(eq(agents.visibility, "public"), isNull(agents.deletedAt), isNotNull(agents.latestVersion)));
  let updated = 0;
  for (const [i, { id, name }] of rows.entries()) {
    try {
      const r = await enrichAgent(id, force);
      if (r === "updated") updated++;
      console.log(`[${i + 1}/${rows.length}] ${id} ${name}: ${r}`);
    } catch (err) {
      console.error(`[${i + 1}/${rows.length}] ${id} ${name}: erro — ${(err as Error).message}`);
      if (i === 0) {
        console.error("Abortando: a primeira chamada falhou (o Claude CLI está instalado e autenticado?)");
        process.exitCode = 1;
        break;
      }
    }
  }
  console.log(`${updated} perfis atualizados`);
} else {
  console.error("Uso: tsx scripts/search.ts <reindex|enrich> [--force]");
  process.exitCode = 1;
}
await sql.end();
