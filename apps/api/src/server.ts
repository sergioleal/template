import { count } from "drizzle-orm";
import { buildApp } from "./app.ts";
import { db, sql } from "./db/client.ts";
import { federationNodes } from "./db/schema.ts";
import { env, isHub, isNode } from "./env.ts";
import { federationConfigError, startPushLoop, stopPushLoop } from "./lib/federation/push.ts";

const app = await buildApp();

const shutdown = async () => {
  stopPushLoop();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.PORT, host: env.HOST });

if (isNode) {
  const problem = federationConfigError();
  if (problem) app.log.warn(`Modo nó sem federação ativa: ${problem}`);
  else {
    app.log.info(`Federação: enviando para ${env.HUB_URL} como nó ${env.NODE_CODE}`);
    startPushLoop((msg) => app.log.warn(msg));
  }
}

if (isHub && !env.NODE_CODE) {
  const [{ nodes } = { nodes: 0 }] = await db.select({ nodes: count() }).from(federationNodes);
  if (nodes > 0) {
    app.log.warn("Há nós federados mas NODE_CODE não está definido no hub: IDs novos podem cair no espaço de um nó");
  }
}
