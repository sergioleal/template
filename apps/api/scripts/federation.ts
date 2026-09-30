/**
 * Administração da federação.
 *
 * No nó (empresa que roda a própria instância):
 *   npm run federation -- keygen [arquivo]        gera o par de chaves Ed25519 (padrão: node-key.pem)
 *   npm run federation -- push                    envia agora o que estiver pendente
 *   npm run federation -- status                  mostra configuração e pendências
 *
 * No hub (quem aprova tenants também aprova nós):
 *   npm run federation -- node:create "<Nome>" <chave-pública-base64> [código]
 *   npm run federation -- node:list
 *   npm run federation -- node:suspend <código>
 *   npm run federation -- node:activate <código>
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, count, eq, gt, isNull, or, sql as dsql } from "drizzle-orm";
import { isValidNodeCode, randomNodeCode, slugifyHandle } from "@agentikal/shared";
import { db, sql } from "../src/db/client.ts";
import { agents, federationNodes, federationOutbox } from "../src/db/schema.ts";
import { env, isHub, isNode } from "../src/env.ts";
import { generateNodeKeyPair, parsePublicKey } from "../src/lib/federation/crypto.ts";
import { federationConfigError, pushPending } from "../src/lib/federation/push.ts";

const [command, ...args] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

const requireHub = () => isHub || fail("Este comando roda no hub (REGISTRY_MODE=hub).");

/** Códigos que um nó novo não pode receber: o do hub, os de outros nós e os já usados em IDs hospedados no hub. */
async function takenCodes(): Promise<Set<string>> {
  const taken = new Set<string>(env.NODE_CODE ? [env.NODE_CODE] : []);
  for (const { code } of await db.select({ code: federationNodes.code }).from(federationNodes)) taken.add(code);
  const local = await db
    .selectDistinct({ code: dsql<string>`substr(${agents.id}, 3, 2)` })
    .from(agents)
    .where(isNull(agents.originNodeId));
  for (const { code } of local) taken.add(code);
  return taken;
}

async function main() {
  switch (command) {
    case "keygen": {
      const file = resolve(args[0] ?? "node-key.pem");
      if (existsSync(file)) fail(`${file} já existe; não vou sobrescrever uma chave.`);
      const { privateKeyPem, publicKey } = generateNodeKeyPair();
      writeFileSync(file, privateKeyPem, { mode: 0o600 });
      console.log(`Chave privada salva em ${file} (não compartilhe; aponte NODE_PRIVATE_KEY_FILE para ela).`);
      console.log(`\nChave pública — envie ao administrador do hub:\n${publicKey}`);
      break;
    }

    case "push": {
      if (!isNode) fail("Este comando roda no nó (REGISTRY_MODE=node).");
      const s = await pushPending();
      console.log(`Enviados ${s.sent}: ${s.applied} aplicados, ${s.unchanged} sem mudança, ${s.rejected.length} rejeitados.`);
      for (const r of s.rejected) console.log(`  ${r.id}: ${r.error} — ${r.message}`);
      break;
    }

    case "status": {
      console.log(`Modo: ${env.REGISTRY_MODE}  código: ${env.NODE_CODE ?? "(não definido)"}`);
      if (isNode) {
        console.log(`Hub: ${env.HUB_URL ?? "(não definido)"}  ${federationConfigError() ?? "configuração ok"}`);
        const [{ pending } = { pending: 0 }] = await db
          .select({ pending: count() })
          .from(agents)
          .leftJoin(federationOutbox, eq(federationOutbox.agentId, agents.id))
          .where(or(isNull(federationOutbox.agentId), gt(agents.revision, federationOutbox.pushedRevision)));
        const errors = await db
          .select({ id: federationOutbox.agentId, error: federationOutbox.lastError })
          .from(federationOutbox)
          .where(dsql`${federationOutbox.lastError} is not null`);
        console.log(`Pendentes: ${pending}`);
        for (const e of errors) console.log(`  ${e.id}: ${e.error}`);
      } else {
        const nodes = await db.select().from(federationNodes).orderBy(federationNodes.createdAt);
        console.log(`Nós: ${nodes.length}`);
      }
      break;
    }

    case "node:create": {
      requireHub();
      const [name, publicKey, wanted] = args;
      if (!name?.trim() || !publicKey) fail('Uso: node:create "<Nome>" <chave-pública-base64> [código]');
      if (!env.NODE_CODE) {
        fail("Defina NODE_CODE no hub antes de aprovar nós, para os IDs novos do hub não caírem no espaço de um nó.");
      }
      try {
        parsePublicKey(publicKey);
      } catch (err) {
        fail(`Chave pública inválida: ${(err as Error).message}`);
      }
      const taken = await takenCodes();
      let code: string;
      if (wanted) {
        const c = wanted.toUpperCase();
        if (!isValidNodeCode(c)) fail("Código inválido: 2 caracteres entre 0-9 e A-Z, sem I e O.");
        if (taken.has(c)) fail(`O código ${c} já está em uso (hub, outro nó ou IDs existentes).`);
        code = c;
      } else {
        if (taken.size >= 34 * 34) fail("Não há códigos de nó livres.");
        do code = randomNodeCode();
        while (taken.has(code));
      }
      // Sufixo dos handles dos agentes do nó no hub (@lago-sul.<slug>).
      let slug = slugifyHandle(name);
      const [slugTaken] = await db
        .select({ id: federationNodes.id })
        .from(federationNodes)
        .where(eq(federationNodes.slug, slug))
        .limit(1);
      if (slugTaken) slug = `${slug.slice(0, 29).replace(/-+$/, "")}-${code.toLowerCase()}`;
      await db.insert(federationNodes).values({ code, name: name.trim(), slug, publicKey: publicKey.trim() });
      console.log(`Nó aprovado: ${name.trim()} → código ${code}, handles @<agente>.${slug}\n`);
      console.log("Configuração para o .env do nó:");
      console.log(`REGISTRY_MODE=node\nNODE_CODE=${code}\nID_PREFIX=${env.ID_PREFIX}\nHUB_URL=${env.PUBLIC_BASE_URL}\nNODE_PRIVATE_KEY_FILE=node-key.pem`);
      break;
    }

    case "node:list": {
      requireHub();
      const rows = await db
        .select({
          code: federationNodes.code,
          name: federationNodes.name,
          status: federationNodes.status,
          lastPushAt: federationNodes.lastPushAt,
          agents: count(agents.id),
        })
        .from(federationNodes)
        .leftJoin(
          agents,
          and(eq(agents.originNodeId, federationNodes.id), eq(agents.visibility, "public"), isNull(agents.deletedAt)),
        )
        .groupBy(federationNodes.id)
        .orderBy(federationNodes.createdAt);
      if (!rows.length) console.log("Nenhum nó aprovado.");
      for (const r of rows) {
        const last = r.lastPushAt ? r.lastPushAt.toISOString() : "nunca";
        console.log(`${r.code}  ${r.status.padEnd(9)}  ${String(r.agents).padStart(4)} agentes  último envio: ${last}  ${r.name}`);
      }
      break;
    }

    case "node:suspend":
    case "node:activate": {
      requireHub();
      const code = args[0]?.toUpperCase();
      if (!code) fail(`Uso: ${command} <código>`);
      const status = command === "node:suspend" ? "suspended" : "active";
      const updated = await db
        .update(federationNodes)
        .set({ status })
        .where(and(eq(federationNodes.code, code)))
        .returning({ code: federationNodes.code });
      if (!updated.length) fail(`Nó ${code} não encontrado.`);
      console.log(`Nó ${code}: ${status === "suspended" ? "suspenso (envios recusados; agentes já recebidos continuam)" : "ativo"}.`);
      break;
    }

    default:
      fail("Comandos: keygen, push, status, node:create, node:list, node:suspend, node:activate");
  }
}

try {
  await main();
} catch (err) {
  if (!process.exitCode) {
    console.error(err);
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
