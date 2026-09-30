#!/usr/bin/env node
/**
 * Testa um agente pelo MCP, como o hub e o agente pessoal vão falar com ele.
 *
 *   npm run testar -- <pasta>                              lista as ferramentas (e confere o agente.json)
 *   npm run testar -- <pasta> <ferramenta> '<json>'        chama uma ferramenta
 *   npm run testar -- <pasta> --url https://.../mcp        contra outra URL (ex.: a pública)
 *
 * Por padrão usa o servidor local (npm run agentes:dev), em http://localhost:<PORT>/<pasta>/mcp, com PORT=4200 se não
 * definido. Rode os dois com o mesmo PORT. O servidor só vê mudanças no código se rodar com agentes:dev (recarrega
 * ao salvar); ao recarregar, o estado em memória dos agentes volta ao início.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { conferirAgente, lerAgente } from "../ferramentas/agente-json.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--url");
const urlOpcao = i >= 0 ? argv.splice(i, 2)[1] : null;
const [pasta, ferramenta, argsJson] = argv;
if (!pasta) {
  console.error("Uso: npm run testar -- <pasta> [ferramenta] ['{\"arg\": 1}'] [--url URL]");
  process.exit(1);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), pasta);
if (!existsSync(join(dir, "agente.mjs"))) {
  console.error(`agentes/${pasta}/agente.mjs não existe.`);
  process.exit(1);
}
const problemas = conferirAgente(dir);
if (problemas.length) {
  console.log(`agentes/${pasta}/agente.json tem problemas (o publicar vai recusar):`);
  for (const p of problemas) console.log(`  - ${p}`);
} else console.log(`agentes/${pasta}/agente.json ok`);

const url = urlOpcao ?? `http://localhost:${process.env.PORT ?? 4200}/${pasta}/mcp`;
const cliente = new Client({ name: "testar", version: "1.0.0" });
try {
  await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
} catch (e) {
  console.error(`Não conectei em ${url}: ${e.message}\nO servidor está no ar? (npm run agentes)`);
  process.exit(1);
}
const info = cliente.getServerVersion();
console.log(`${info?.name} ${info?.version} em ${url}`);
try {
  const versao = lerAgente(dir).versao;
  if (info?.version && versao && info.version !== versao) console.log(`aviso: agente.json diz versão ${versao} e o McpServer ${info.version}; use a mesma nos dois.`);
} catch {
  // agente.json ilegível: já apareceu nos problemas acima.
}
console.log(`instructions: ${cliente.getInstructions() ?? "(nenhuma: o catálogo fica sem descrição do fluxo)"}`);

if (!ferramenta) {
  const { tools } = await cliente.listTools();
  for (const t of tools) {
    const a = t.annotations ?? {};
    if (a.readOnlyHint === undefined && a.destructiveHint === undefined) console.log(`
aviso: ${t.name} sem annotations (readOnlyHint/destructiveHint): será tratada como compromisso.`);
    const tipo = a.readOnlyHint ? "consulta" : a.destructiveHint === false ? "sem compromisso" : "compromisso (pede confirmação)";
    console.log(`\n- ${t.name} [${tipo}]${t.title ? ` — ${t.title}` : ""}\n  ${t.description ?? "(sem descrição)"}`);
    console.log(`  argumentos: ${Object.keys(t.inputSchema?.properties ?? {}).join(", ") || "nenhum"}`);
  }
} else {
  const args = argsJson ? JSON.parse(argsJson) : {};
  const r = await cliente.callTool({ name: ferramenta, arguments: args });
  console.log(`\n${ferramenta}${r.isError ? " (erro)" : ""}:`);
  for (const c of r.content ?? []) console.log(c.type === "text" ? c.text : JSON.stringify(c));
}
await cliente.close();
