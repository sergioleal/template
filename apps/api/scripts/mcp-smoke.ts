/**
 * Teste de fumaça do servidor MCP do registry com o cliente oficial do SDK.
 *   npm run mcp:smoke --workspace @agentikal/api [-- http://localhost:3000/mcp]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env } from "../src/env.ts";

const url = new URL(process.argv[2] ?? `http://127.0.0.1:${env.PORT}/mcp`);
const client = new Client({ name: "registry-smoke", version: "0.0.1" });
await client.connect(new StreamableHTTPClientTransport(url));

const info = client.getServerVersion();
console.log(`Conectado: ${info?.name} ${info?.version}`);
console.log(`Instruções: ${client.getInstructions()?.split("\n")[0]}`);

const { tools } = await client.listTools();
console.log(`Ferramentas: ${tools.map((t) => t.name).join(", ")}`);

const text = (r: Awaited<ReturnType<typeof client.callTool>>) =>
  (r.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";

const search = await client.callTool({ name: "search_agents", arguments: { query: "agendar consulta médica", limit: 3 } });
const found = JSON.parse(text(search)) as { total: number; results: { id: string; name: string; score?: number }[] };
console.log(`search_agents → ${found.total}: ${found.results.map((r) => `${r.name} (${r.score})`).join(" | ")}`);

const top = found.results[0];
if (top) {
  const agent = JSON.parse(text(await client.callTool({ name: "get_agent", arguments: { id: top.id } })));
  console.log(`get_agent → ${agent.name} ${agent.version}, auth=${agent.auth}, remotes=${agent.remotes.map((r: { url: string }) => r.url).join(", ")}`);
  console.log(`            ferramentas: ${agent.tools.map((t: { name: string }) => t.name).join(", ")}`);
  const versions = JSON.parse(text(await client.callTool({ name: "list_versions", arguments: { id: top.id } })));
  console.log(`list_versions → latest=${versions.latest}, ${versions.versions.length} versões`);
  const exact = JSON.parse(text(await client.callTool({ name: "get_agent", arguments: { id: top.id, version: "1.1" } })));
  console.log(`get_agent version=1.1 → ${exact.version}`);
}

const bad = await client.callTool({ name: "get_agent", arguments: { id: "ZZ0000000001" } });
console.log(`get_agent ID inválido → isError=${bad.isError}: ${text(bad)}`);

await client.close();
