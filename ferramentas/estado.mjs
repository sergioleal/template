#!/usr/bin/env node
/**
 * Em que ponto está a montagem do nó e qual é o próximo passo. Só lê: não muda nada, não mostra segredos.
 *
 *   npm run estado            checagem completa (inclui SSH, endereços públicos e hub)
 *   npm run estado -- --local só o que dá para ver nesta máquina (rápido, sem rede)
 *   npm run estado -- --json  o mesmo, em JSON (para scripts e IAs)
 *
 * Cada item sai como ok, falta ou aviso. O primeiro "falta" define o próximo passo, e quem precisa agir
 * ("pessoa" ou "ia") vem junto: login, contas e aprovação no hub são da pessoa.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conferirAgente } from "./agente-json.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const soLocal = argv.includes("--local");
const emJson = argv.includes("--json");

function lerEnv(arquivo) {
  if (!existsSync(arquivo)) return null;
  return Object.fromEntries(
    readFileSync(arquivo, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}
const tem = (cmd, args = ["--version"]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const buscar = async (url, ms = 8000) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: "application/json" } });
    return { status: r.status, corpo: r.ok ? await r.json().catch(() => null) : null };
  } catch {
    return { status: 0, corpo: null };
  }
};

const itens = [];
/** situacao: ok | falta | aviso. quem: pessoa | ia (quem resolve). */
const item = (id, situacao, texto, passo = null, quem = "ia") => itens.push({ id, situacao, texto, passo, quem });

// --- Esta máquina ---
const [maior] = process.versions.node.split(".").map(Number);
item("node", maior >= 22 ? "ok" : "falta", `Node.js ${process.versions.node}`, "Instale o Node.js 22 ou mais novo", "pessoa");
item("dependencias", existsSync(join(RAIZ, "node_modules", "@modelcontextprotocol")) ? "ok" : "falta", "dependências instaladas", "npm install");
item("ssh", tem("ssh", ["-V"]) ? "ok" : "falta", "ssh disponível", "Instale o cliente OpenSSH", "pessoa");
const cfPath = process.platform === "win32" && existsSync("C:\\Program Files (x86)\\cloudflared\\cloudflared.exe") ? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe" : "cloudflared";
item("cloudflared", tem(cfPath) ? "ok" : "falta", "cloudflared instalado", "Instale o cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/", "pessoa");

// --- Agentes deste repositório ---
const pastas = readdirSync(join(RAIZ, "agentes"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(RAIZ, "agentes", d.name, "agente.mjs")))
  .map((d) => d.name);
const agentes = pastas.map((p) => ({ pasta: p, json: JSON.parse(readFileSync(join(RAIZ, "agentes", p, "agente.json"), "utf8")) }));
item("agentes", pastas.length ? "ok" : "falta", `agentes: ${pastas.join(", ") || "nenhum"}`, "Crie um agente em agentes/<pasta> (copie agentes/reserva-salas)");
for (const p of pastas) {
  const problemas = conferirAgente(join(RAIZ, "agentes", p));
  if (problemas.length) item(`agente:${p}`, "falta", `agentes/${p}/agente.json: ${problemas.join("; ")}`, `Corrija agentes/${p}/agente.json (npm run testar -- ${p})`);
}
if (pastas.includes("reserva-salas") && pastas.length > 1)
  item("exemplo", "aviso", "o agente de exemplo reserva-salas ainda está em agentes/", "Pergunte à pessoa se o exemplo fica; se não, apague agentes/reserva-salas (ou deixe unlisted) antes de implantar");

// --- Configuração ---
const cfg = lerEnv(join(RAIZ, "deploy", "config.env"));
const campos = ["VM_IP", "SLUG", "NOME", "SITE", "API", "AUTH", "MCP", "HUB_URL"];
if (!cfg) item("config", "falta", "deploy/config.env", "cp deploy/config.example.env deploy/config.env e preencha com os dados da pessoa (VM, nome, domínio)");
else {
  const faltam = campos.filter((c) => !cfg[c] || /suaempresa/.test(cfg[c]));
  item("config", faltam.length ? "falta" : "ok", faltam.length ? `deploy/config.env sem ${faltam.join(", ")}` : "deploy/config.env preenchido", "Pergunte à pessoa e preencha os campos que faltam", faltam.some((c) => c === "VM_IP") ? "pessoa" : "ia");
}
const chave = existsSync(join(RAIZ, "deploy", "segredos", "no.pem"));
item("chave", chave ? "ok" : "falta", "chave do nó (deploy/segredos/no.pem)", "npm run implantar -- chave");
const aprovado = Boolean(cfg?.NODE_CODE && cfg?.ID_PREFIX);
item(
  "aprovacao",
  aprovado ? "ok" : "falta",
  aprovado ? `nó aprovado no hub (NODE_CODE ${cfg.NODE_CODE})` : "aprovação do hub (NODE_CODE e ID_PREFIX)",
  "A pessoa manda a chave pública (npm run implantar -- chave) ao administrador do hub e devolve NODE_CODE e ID_PREFIX, que vão no deploy/config.env",
  "pessoa",
);
const tunelLogin = existsSync(join(homedir(), ".cloudflared", "cert.pem"));
item("cloudflare-tunel", tunelLogin ? "ok" : "falta", "login do cloudflared nesta máquina (cert.pem; precisa ser do domínio do config.env)", "A pessoa roda: cloudflared tunnel login (e escolhe o domínio do config.env)", "pessoa");

// --- Rede (VM, Cloudflare, hub) ---
if (!soLocal) {
  // Comando inteiro numa string: no Windows o npx é um .cmd e só roda pelo shell.
  const wr = spawnSync("npx wrangler whoami", { cwd: RAIZ, encoding: "utf8", shell: true, timeout: 60000 });
  const logado = wr.status === 0 && !/not authenticated|not logged in/i.test(`${wr.stdout}${wr.stderr}`);
  item("cloudflare-worker", logado ? "ok" : "falta", "login do wrangler", "A pessoa roda: npx wrangler login", "pessoa");

  if (cfg?.VM_IP) {
    const chaveSsh = cfg.SSH_CHAVE?.startsWith("~") ? join(homedir(), cfg.SSH_CHAVE.slice(1)) : cfg.SSH_CHAVE;
    const r = spawnSync("ssh", [...(chaveSsh ? ["-i", chaveSsh] : []), "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new", `${cfg.VM_USUARIO || "root"}@${cfg.VM_IP}`, "true"], { stdio: "ignore" });
    item("vm", r.status === 0 ? "ok" : "falta", `SSH em ${cfg.VM_USUARIO || "root"}@${cfg.VM_IP}`, "A pessoa autoriza a chave SSH (SSH_CHAVE) na VM, ou corrige VM_IP/VM_USUARIO", "pessoa");
  }
  if (cfg?.SITE && !/suaempresa/.test(cfg.SITE)) {
    const site = await buscar(`https://${cfg.SITE}/api/instance`);
    item("no-no-ar", site.corpo?.mode === "node" ? "ok" : "falta", `nó em https://${cfg.SITE} (${site.status || "sem resposta"})`, "npm run implantar -- up");
  }
  if (cfg?.MCP && !/suaempresa/.test(cfg.MCP)) {
    const mcp = await buscar(`https://${cfg.MCP}/`);
    const noAr = Array.isArray(mcp.corpo) ? mcp.corpo.map((a) => a.pasta).filter(Boolean) : [];
    const faltam = pastas.filter((p) => !noAr.includes(p));
    item(
      "agentes-no-ar",
      mcp.status === 200 && faltam.length === 0 ? "ok" : "falta",
      mcp.status === 200 ? `agentes na VM: ${noAr.join(", ") || "nenhum"}` : `servidor dos agentes em https://${cfg.MCP} (${mcp.status || "sem resposta"})`,
      "npm run implantar -- agentes",
    );
  }
  const loginGuardado = existsSync(join(RAIZ, ".publicar")) && readdirSync(join(RAIZ, ".publicar")).length > 0;
  item(
    "conta",
    loginGuardado ? "ok" : "aviso",
    loginGuardado ? "login da publicação guardado" : "sem login da publicação ainda",
    'A pessoa cria a conta dela (npm run implantar -- usuario <email> "<Nome>") e entra quando o publicar abrir o navegador',
    "pessoa",
  );
  if (cfg?.HUB_URL) {
    for (const a of agentes.filter((x) => (x.json.visibilidade ?? "public") === "public")) {
      const r = await buscar(`${cfg.HUB_URL.replace(/\/+$/, "")}/api/catalog?q=${encodeURIComponent(a.json.endereco)}&pageSize=20`);
      const doc = r.corpo?.items?.find((x) => x.handle?.startsWith(`@${a.json.endereco}.`));
      const versao = doc?.latest ?? doc?.version;
      item(
        `hub:${a.pasta}`,
        doc ? (versao && versao !== a.json.versao ? "aviso" : "ok") : "falta",
        doc ? `${a.pasta} no hub como ${doc.handle}${versao ? ` (versão ${versao}${versao !== a.json.versao ? `, local ${a.json.versao}` : ""})` : ""}` : `${a.pasta} ainda não está no hub`,
        `Confirme com a pessoa e rode: npm run publicar -- ${a.pasta}`,
      );
    }
  }
}

const proximo = itens.find((i) => i.situacao === "falta") ?? itens.find((i) => i.situacao === "aviso");
if (emJson) {
  console.log(JSON.stringify({ itens, proximo }, null, 2));
} else {
  const icone = { ok: "✓", falta: "✗", aviso: "!" };
  for (const i of itens) console.log(`${icone[i.situacao]} ${i.texto}`);
  console.log(proximo ? `\nPróximo passo (${proximo.quem === "pessoa" ? "a pessoa" : "a IA"}): ${proximo.passo}` : "\nTudo pronto: os agentes estão no hub.");
}
