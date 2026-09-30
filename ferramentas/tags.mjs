#!/usr/bin/env node
/**
 * Tags em uso no catálogo do hub (ferramenta list_tags do MCP público), para escolher as do seu agente
 * reaproveitando as que já existem: é por elas que os agentes pessoais acham o seu.
 *
 *   npm run tags               todas, da mais usada para a menos
 *   npm run tags -- show       só as que contêm "show"
 *
 * O hub vem de HUB_URL em deploy/config.env (sem ele, https://registry.agentik.al).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = join(RAIZ, "deploy", "config.env");
const hubCfg = existsSync(config) ? /^HUB_URL=(.+)$/m.exec(readFileSync(config, "utf8"))?.[1]?.trim() : null;
const HUB = (process.env.HUB_URL ?? hubCfg ?? "https://registry.agentik.al").replace(/\/+$/, "");
const filtro = (process.argv[2] ?? "").toLowerCase();

const cliente = new Client({ name: "tags", version: "1.0.0" });
try {
  await cliente.connect(new StreamableHTTPClientTransport(new URL(`${HUB}/mcp`)));
} catch (e) {
  console.error(`Não conectei no hub (${HUB}/mcp): ${e.message}`);
  process.exit(1);
}
const r = await cliente.callTool({ name: "list_tags", arguments: {} });
await cliente.close();
const texto = r.content?.find((c) => c.type === "text")?.text ?? "{}";
const dados = r.structuredContent ?? JSON.parse(texto);
const tags = (dados.tags ?? dados).filter((t) => !filtro || t.tag.includes(filtro));
console.log(`${tags.length} tag(s) em ${HUB}${filtro ? ` com "${filtro}"` : ""}:`);
for (const t of tags) console.log(`  ${t.tag.padEnd(32)} ${t.agents} agente(s)`);
