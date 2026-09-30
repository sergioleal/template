#!/usr/bin/env node
/**
 * Servidor MCP dos agentes deste nó. Cada pasta em agentes/ com um agente.mjs é um agente, servido em
 * /<pasta>/mcp (MCP streamable-http, stateless: um servidor novo por requisição).
 *
 *   node agentes/servidor.mjs            (PORT=4200, HOST=127.0.0.1)
 *   GET  /                               lista os agentes e as URLs
 *   GET  /healthz                        saúde (o compose usa)
 *   POST /<pasta>/mcp                    o agente
 *
 * PUBLIC_URL é o endereço público deste serviço (ex.: https://mcp-agentes.suaempresa.com.br), usado só
 * para listar as URLs em GET /. Em produção ele fica atrás do túnel do Cloudflare.
 */
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4200);
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const LIMITE_CORPO = 1024 * 1024;

/** Carrega os agentes: pasta → { criar, info } (info vem do agente.json, o que o publicar usa). */
async function carregarAgentes() {
  const agentes = new Map();
  for (const pasta of readdirSync(AQUI, { withFileTypes: true })) {
    if (!pasta.isDirectory() || pasta.name.startsWith(".") || pasta.name === "node_modules") continue;
    const arquivo = join(AQUI, pasta.name, "agente.mjs");
    if (!existsSync(arquivo)) continue;
    const mod = await import(pathToFileURL(arquivo).href);
    if (typeof mod.criar !== "function") throw new Error(`${pasta.name}/agente.mjs precisa exportar criar()`);
    const jsonPath = join(AQUI, pasta.name, "agente.json");
    const info = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) : {};
    agentes.set(pasta.name, { criar: mod.criar, info });
  }
  return agentes;
}

const agentes = await carregarAgentes();

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  if (req.method === "GET" && url.pathname === "/healthz") return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify([...agentes].map(([pasta, a]) => ({ pasta, nome: a.info.nome ?? pasta, url: `${PUBLIC_URL}/${pasta}/mcp` })), null, 2));
  }
  const [, pasta, resto] = url.pathname.split("/");
  const agente = agentes.get(pasta);
  if (!agente || resto !== "mcp") return res.writeHead(404).end();
  if (req.method !== "POST") return res.writeHead(405, { Allow: "POST" }).end();

  const pedacos = [];
  let tamanho = 0;
  for await (const p of req) {
    tamanho += p.length;
    if (tamanho > LIMITE_CORPO) return res.writeHead(413).end();
    pedacos.push(p);
  }
  let corpo;
  try {
    corpo = JSON.parse(Buffer.concat(pedacos).toString("utf8"));
  } catch {
    return res.writeHead(400).end();
  }
  const servidor = agente.criar();
  const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transporte.close();
    servidor.close();
  });
  try {
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, corpo);
  } catch (e) {
    console.error(`[${pasta}]`, e);
    if (!res.headersSent) res.writeHead(500).end();
  }
});

http.listen(PORT, HOST, () => {
  console.log(`Agentes em ${PUBLIC_URL} (escutando em ${HOST}:${PORT})`);
  for (const [pasta, a] of agentes) console.log(`  ${(a.info.nome ?? pasta).padEnd(28)} ${PUBLIC_URL}/${pasta}/mcp`);
});
