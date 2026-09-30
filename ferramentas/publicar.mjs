#!/usr/bin/env node
/**
 * Publica um agente deste repositório no seu nó do registry; o nó envia os agentes públicos ao hub.
 *
 *   npm run publicar -- <pasta>            publica agentes/<pasta> (cria o agente ou uma versão nova) e espera ele no hub
 *   npm run publicar -- <pasta> --sem-hub  não espera o hub
 *   npm run publicar -- login              só o login (abre o navegador uma vez; depois o token é renovado sozinho)
 *   npm run publicar -- sair               apaga o login guardado
 *   npm run publicar -- listar             os agentes que você tem no nó, com as versões
 *
 * O que ele faz ao publicar:
 *   1. confere agentes/<pasta>/agente.json (as mesmas regras do nó);
 *   2. conecta no agente pela URL pública (https://<MCP>/<pasta>/mcp) e lê as ferramentas (tools/list): o catálogo
 *      mostra exatamente o que o agente expõe;
 *   3. cria o agente no nó (POST /api/agents) ou publica a versão nova (POST /api/agents/:id/versions) e atualiza nome,
 *      resumo, tags e visibilidade quando mudaram;
 *   4. se o agente é público, espera o nó enviá-lo ao hub e mostra o link dele lá.
 *
 * Login: OIDC com PKCE no cliente público "<SLUG>-cli" do Keycloak do nó, com retorno em http://127.0.0.1:8976.
 * A pessoa entra pelo navegador; o token fica em .publicar/ (fora do git). Senha nenhuma passa por aqui.
 *
 * Endereços vêm de deploy/config.env (SITE, AUTH, SLUG, MCP). Para outro ambiente, use as variáveis NO_URL,
 * OIDC_ISSUER, OIDC_CLI_CLIENT e AGENTES_URL. PUBLICAR_SEM_NAVEGADOR=1 só imprime o endereço do login.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { conferirAgente, lerAgente } from "./agente-json.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORTA_RETORNO = 8976;
const RETORNO = `http://127.0.0.1:${PORTA_RETORNO}/callback`;
const ESPERA_HUB_MS = 3 * 60_000;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const comando = argv.find((a) => !a.startsWith("--"));

const falhar = (msg) => {
  console.error(`\nErro: ${msg}`);
  process.exit(1);
};
const passo = (msg) => console.log(`\n== ${msg}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

function lerEnv(arquivo) {
  if (!existsSync(arquivo)) return {};
  return Object.fromEntries(
    readFileSync(arquivo, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

const cfg = lerEnv(join(RAIZ, "deploy", "config.env"));
const semBarra = (u) => u?.replace(/\/+$/, "");
const NO_URL = semBarra(process.env.NO_URL ?? (cfg.SITE ? `https://${cfg.SITE}` : null));
const ISSUER = semBarra(process.env.OIDC_ISSUER ?? (cfg.AUTH && cfg.SLUG ? `https://${cfg.AUTH}/realms/${cfg.SLUG}` : null));
const CLIENTE = process.env.OIDC_CLI_CLIENT ?? (cfg.SLUG ? `${cfg.SLUG}-cli` : null);
const AGENTES_URL = semBarra(process.env.AGENTES_URL ?? (cfg.MCP ? `https://${cfg.MCP}` : null));

function exigirConfig() {
  const faltam = [!NO_URL && "SITE", !ISSUER && "AUTH e SLUG", !CLIENTE && "SLUG", !AGENTES_URL && "MCP"].filter(Boolean);
  if (faltam.length) falhar(`Preencha ${faltam.join(", ")} em deploy/config.env (copie de deploy/config.example.env).`);
}

// ---------------------------------------------------------------------------
// Login (OIDC + PKCE, retorno no 127.0.0.1)
// ---------------------------------------------------------------------------

const PASTA_TOKEN = join(RAIZ, ".publicar");
const arquivoToken = () => join(PASTA_TOKEN, `${new URL(ISSUER).host.replace(/[^a-z0-9.-]/gi, "_")}-${CLIENTE}.json`);
let oidc = null;

async function descoberta() {
  if (oidc) return oidc;
  const r = await fetch(`${ISSUER}/.well-known/openid-configuration`).catch((e) => falhar(`Keycloak fora do ar (${ISSUER}): ${e.message}`));
  if (!r.ok) falhar(`Keycloak respondeu ${r.status} em ${ISSUER}. O realm existe?`);
  return (oidc = await r.json());
}

function abrirNavegador(url) {
  // PUBLICAR_SEM_NAVEGADOR=1: só imprime o endereço (VM sem navegador, testes automatizados).
  if (process.env.PUBLICAR_SEM_NAVEGADOR === "1") return;
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Sem navegador (ex.: numa VM): a URL impressa basta.
  }
}

async function login() {
  const d = await descoberta();
  const verificador = randomBytes(48).toString("base64url");
  const estado = randomBytes(16).toString("base64url");
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENTE,
    redirect_uri: RETORNO,
    scope: "openid profile email",
    state: estado,
    code_challenge: createHash("sha256").update(verificador).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();

  const codigo = await new Promise((resolver, rejeitar) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? "/", RETORNO);
      if (u.pathname !== "/callback") return res.writeHead(404).end();
      const ok = u.searchParams.get("state") === estado && u.searchParams.get("code");
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
      res.end(ok ? "<p>Login feito. Pode fechar esta aba e voltar ao terminal.</p>" : "<p>Login não concluído. Tente de novo.</p>");
      srv.close();
      if (ok) resolver(u.searchParams.get("code"));
      else rejeitar(new Error(u.searchParams.get("error_description") ?? "retorno sem código"));
    });
    srv.on("error", (e) => rejeitar(new Error(`porta ${PORTA_RETORNO} ocupada? ${e.message}`)));
    srv.listen(PORTA_RETORNO, "127.0.0.1", () => {
      console.log(`\nEntre no navegador para autorizar a publicação (se ele não abrir, copie o endereço):\n${url}\n`);
      abrirNavegador(url.toString());
    });
    setTimeout(() => {
      srv.close();
      rejeitar(new Error("tempo esgotado esperando o login (5 min)"));
    }, 5 * 60_000).unref();
  });

  const tokens = await trocar({ grant_type: "authorization_code", code: codigo, redirect_uri: RETORNO, client_id: CLIENTE, code_verifier: verificador });
  guardar(tokens);
  console.log("Login feito.");
  return tokens.access_token;
}

async function trocar(corpo) {
  const d = await descoberta();
  const r = await fetch(d.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description ?? j.error ?? `token ${r.status}`);
  return j;
}

function guardar(tokens) {
  mkdirSync(PASTA_TOKEN, { recursive: true });
  writeFileSync(arquivoToken(), JSON.stringify({ refresh_token: tokens.refresh_token, guardado_em: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

/** Access token válido: renova pelo refresh token guardado; sem ele (ou vencido), faz o login. */
async function token() {
  if (existsSync(arquivoToken())) {
    const { refresh_token } = JSON.parse(readFileSync(arquivoToken(), "utf8"));
    try {
      const t = await trocar({ grant_type: "refresh_token", refresh_token, client_id: CLIENTE });
      guardar(t);
      return t.access_token;
    } catch {
      console.log("O login guardado venceu; entre de novo.");
    }
  }
  return login();
}

// ---------------------------------------------------------------------------
// API do nó
// ---------------------------------------------------------------------------

let bearer = null;
async function api(metodo, caminho, corpo) {
  bearer ??= await token();
  const r = await fetch(`${NO_URL}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${bearer}`, ...(corpo ? { "content-type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  }).catch((e) => falhar(`nó fora do ar (${NO_URL}): ${e.message}`));
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (r.status === 401) falhar(`o nó recusou o login (401). Confira OIDC_APP_CLIENT_ID=${CLIENTE} no nó e rode "npm run publicar -- login".`);
  if (!r.ok) {
    const detalhes = j?.issues?.map((i) => `\n  - ${i.path}: ${i.message}`).join("") ?? "";
    const e = new Error(`${metodo} ${caminho}: ${r.status} ${j?.error ?? ""} ${j?.message ?? ""}${detalhes}`);
    e.status = r.status;
    e.codigo = j?.error;
    throw e;
  }
  return j;
}

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

async function lerFerramentas(url) {
  const cliente = new Client({ name: "publicar", version: "1.0.0" });
  try {
    await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
  } catch (e) {
    falhar(`não conectei no agente em ${url} (${e.message}). Ele precisa estar no ar nessa URL pública: suba com "npm run implantar -- up" e confira com "npm run testar -- <pasta> --url ${url}".`);
  }
  const { tools } = await cliente.listTools();
  const versao = cliente.getServerVersion()?.version;
  await cliente.close();
  return { versao, ferramentas: tools.map(({ name, title, description, inputSchema }) => ({ name, ...(title ? { title } : {}), ...(description ? { description } : {}), ...(inputSchema ? { inputSchema } : {}) })) };
}

async function publicar(pasta) {
  exigirConfig();
  const dir = join(RAIZ, "agentes", pasta);
  if (!existsSync(join(dir, "agente.mjs"))) falhar(`agentes/${pasta}/agente.mjs não existe.`);
  const problemas = conferirAgente(dir);
  if (problemas.length) falhar(`agentes/${pasta}/agente.json:\n  - ${problemas.join("\n  - ")}`);
  const a = lerAgente(dir);

  passo(`Ferramentas do agente (tools/list)`);
  const url = `${AGENTES_URL}/${pasta}/mcp`;
  const { versao: versaoServidor, ferramentas } = await lerFerramentas(url);
  console.log(`   ${url}: ${ferramentas.map((f) => f.name).join(", ") || "nenhuma"}`);
  if (versaoServidor && versaoServidor !== a.versao) console.log(`   aviso: o servidor diz versão ${versaoServidor} e o agente.json ${a.versao}. Use a mesma nos dois.`);

  passo(`Publicação no nó ${NO_URL}`);
  const versao = {
    version: a.versao,
    description: a.descricao,
    remotes: [{ type: "streamable-http", url }],
    tools: ferramentas,
    auth: a.autenticacao,
    examples: a.exemplos,
  };
  const meus = await api("GET", "/api/agents");
  let agente = meus.find((x) => x.handle === a.endereco);
  if (!agente) {
    agente = await api("POST", "/api/agents", { name: a.nome, handle: a.endereco, summary: a.resumo, visibility: a.visibilidade, tags: a.tags, firstVersion: versao }).catch((e) =>
      falhar(e.codigo === "handle_taken" ? `o endereço @${a.endereco} já é de outro agente neste nó; troque "endereco" no agente.json.` : e.message),
    );
    console.log(`   agente criado: @${agente.handle} (${agente.id}), versão ${a.versao}`);
  } else {
    const mudou = {};
    if (agente.name !== a.nome) mudou.name = a.nome;
    if (agente.summary !== a.resumo) mudou.summary = a.resumo;
    if (agente.visibility !== a.visibilidade) mudou.visibility = a.visibilidade;
    if (JSON.stringify([...agente.tags].sort()) !== JSON.stringify([...a.tags].sort())) mudou.tags = a.tags;
    if (Object.keys(mudou).length) {
      agente = await api("PATCH", `/api/agents/${agente.id}`, mudou);
      console.log(`   atualizado: ${Object.keys(mudou).join(", ")}`);
    }
    if (agente.versions.some((v) => v.version === a.versao)) {
      console.log(`   a versão ${a.versao} já está publicada (versões são imutáveis). Para mudar ferramentas ou descrição, suba "versao" no agente.json e no agente.mjs.`);
    } else {
      await api("POST", `/api/agents/${agente.id}/versions`, versao);
      console.log(`   versão ${a.versao} publicada`);
    }
  }
  console.log(`   no nó: ${NO_URL}/a/${agente.id}`);

  if (a.visibilidade !== "public") return console.log("\nAgente não listado: fica só no nó e não vai para o hub.");
  if (flag("sem-hub")) return;
  await esperarHub(agente.id, a.versao);
}

/** O nó envia ao hub logo depois da mudança (e tenta de novo a cada minuto): espera o agente aparecer lá. */
async function esperarHub(id, versao) {
  const instancia = await fetch(`${NO_URL}/api/instance`).then((r) => r.json());
  const hub = instancia.hub?.url;
  if (!hub) return console.log("\nEste nó não tem hub configurado (HUB_URL); o agente fica só no nó.");
  passo(`Cadastro no hub ${hub}`);
  const limite = Date.now() + ESPERA_HUB_MS;
  let ultimo = "";
  while (Date.now() < limite) {
    const r = await fetch(`${hub}/a/${id}/json`, { headers: { accept: "application/json" } }).catch(() => null);
    if (r?.ok) {
      const doc = await r.json();
      if (doc.version === versao) {
        console.log(`   no hub: ${hub}/a/${id} (@${doc.handle?.replace(/^@/, "")}, versão ${doc.version})`);
        return;
      }
      ultimo = `o hub ainda mostra a versão ${doc.version}`;
    } else ultimo = r ? `o hub respondeu ${r.status}` : "hub fora do ar";
    await dormir(5000);
  }
  const federacao = (await api("GET", `/api/agents/${id}`).catch(() => null))?.federation;
  falhar(
    `o agente não apareceu no hub em ${ESPERA_HUB_MS / 60_000} min (${ultimo}).` +
      (federacao ? `\n   Situação no nó: ${JSON.stringify(federacao)}` : "") +
      "\n   Confira se o administrador do hub aprovou este nó (NODE_CODE) e os logs: npm run implantar -- logs no",
  );
}

async function listar() {
  exigirConfig();
  const meus = await api("GET", "/api/agents");
  for (const a of meus.filter((x) => x.kind !== "personal")) {
    console.log(`@${a.handle}  ${a.name}  (${a.visibility}, latest ${a.latest ?? "-"})  ${NO_URL}/a/${a.id}`);
    for (const v of a.versions) console.log(`   ${v.version}  ${v.status}  ${v.publishedAt.slice(0, 10)}`);
  }
}

switch (comando) {
  case undefined:
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*/, "").replace(/^ \* ?/gm, ""));
    break;
  case "login":
    exigirConfig();
    await login();
    break;
  case "sair":
    exigirConfig();
    rmSync(arquivoToken(), { force: true });
    console.log("Login apagado.");
    break;
  case "listar":
    await listar();
    break;
  default:
    await publicar(comando);
}
