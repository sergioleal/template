import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "../src/db/client.ts";
import { refreshAllAgentIndexes } from "../src/lib/search.ts";

// Em dev roda de apps/api; no build, de apps/api/dist. As migrações ficam em apps/api/drizzle.
const folder = resolve(process.env.MIGRATIONS_DIR ?? "drizzle");
await migrate(db, { migrationsFolder: folder });
console.log(`Migrações aplicadas (${folder})`);
// Campos derivados (latest desnormalizada, documento de busca) podem mudar de formato entre versões.
console.log(`${await refreshAllAgentIndexes()} agentes reindexados`);
await sql.end();
