#!/usr/bin/env node
/**
 * Implantação do nó numa VM qualquer (Ubuntu 22.04+ com SSH) + Cloudflare (túnel, DNS e Worker).
 *
 *   npm run implantar -- chave                          gera a chave do nó e mostra o que mandar ao administrador do hub
 *   npm run implantar -- up                             prepara a VM, sobe tudo e publica o site (pode repetir)
 *   npm run implantar -- agentes                        só reconstrói e reinicia os agentes (depois de editar agentes/)
 *   npm run implantar -- usuario <email> "<Nome>"       cria uma conta no login do nó (a senha temporária aparece uma vez)
 *   npm run implantar -- senha <email>                  nova senha temporária para uma conta
 *   npm run implantar -- status                         serviços na VM e resposta dos endereços públicos
 *   npm run implantar -- logs [serviço]                 últimas linhas do log (no, agentes, keycloak, tunnel…)
 *   npm run implantar -- backup                         copia os bancos da VM para deploy/segredos/backups/<data>/
 *
 * Lê deploy/config.env (copie de deploy/config.example.env). Segredos são gerados na primeira vez em deploy/segredos/
 * (fora do git): segredos.env e no.pem. Antes do primeiro `up`, uma vez nesta máquina:
 *   cloudflared tunnel login      (escolha o domínio dos endereços do config.env)
 *   npx wrangler login
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY = join(RAIZ, "deploy");
const SEGREDOS = join(DEPLOY, "segredos");
const CHAVE_NO = join(SEGREDOS, "no.pem");
const REMOTO = "/opt/agentes/deploy";
const FONTES_REMOTO = "/opt/agentes/src";
const COMPOSE = `docker compose -f ${REMOTO}/docker-compose.yml`;
const WRANGLER_PRODUCAO = join(RAIZ, "apps", "edge", "wrangler.producao.jsonc");
// O que o build das imagens usa (o resto do repositório não vai para a VM).
const FONTES = [".dockerignore", "package.json", "package-lock.json", "tsconfig.base.json", "packages/shared", "apps/api", "apps/web/package.json", "apps/edge/package.json", "agentes"];
const EXCLUIR = ["node_modules", "dist", ".env", ".env.*", "*.pem", "*.log"];

const args = process.argv.slice(2);
const comando = args[0];

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const passo = (msg) => console.log(`\n\x1b[36m== ${msg}\x1b[0m`);
const info = (msg) => console.log(`   ${msg}`);
const falhar = (msg) => {
  console.error(`\n\x1b[31mErro: ${msg}\x1b[0m`);
  process.exit(1);
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const aspas = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;

function rodar(cmd, cmdArgs, { entrada, capturar = false, podeFalhar = false, shell = false, cwd } = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    input: entrada,
    cwd,
    encoding: "utf8",
    stdio: capturar || entrada !== undefined ? ["pipe", capturar ? "pipe" : "inherit", capturar ? "pipe" : "inherit"] : "inherit",
    shell,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) falhar(`${cmd}: ${r.error.message}`);
  if (r.status !== 0 && !podeFalhar) falhar(`${cmd} ${cmdArgs.slice(0, 3).join(" ")} terminou com código ${r.status}\n${r.stderr ?? ""}`);
  return { ok: r.status === 0, saida: (r.stdout ?? "").trim() };
}

const npx = (a, o) => rodar(process.platform === "win32" ? "npx.cmd" : "npx", a, { ...o, shell: process.platform === "win32" });
const npm = (a, o) => rodar(process.platform === "win32" ? "npm.cmd" : "npm", a, { ...o, shell: process.platform === "win32" });

function cloudflared() {
  const win = "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
  return process.platform === "win32" && existsSync(win) ? win : "cloudflared";
}

function lerEnv(arquivo) {
  if (!existsSync(arquivo)) return {};
  return Object.fromEntries(
    readFileSync(arquivo, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const cfg = lerEnv(join(DEPLOY, "config.env"));
const expandir = (p) => (p?.startsWith("~") ? join(homedir(), p.slice(1)) : p);

function exigir(...campos) {
  if (!existsSync(join(DEPLOY, "config.env"))) falhar("Crie deploy/config.env a partir de deploy/config.example.env.");
  const faltam = campos.filter((c) => !cfg[c]);
  if (faltam.length) falhar(`Preencha em deploy/config.env: ${faltam.join(", ")}`);
  if (cfg.SLUG && !/^[a-z][a-z0-9-]{1,30}$/.test(cfg.SLUG)) falhar("SLUG: letras minúsculas, números e hífen, começando por letra.");
  if (cfg.NODE_CODE && !/^[0-9A-HJ-NP-Z]{2}$/.test(cfg.NODE_CODE)) falhar("NODE_CODE: os 2 caracteres que o hub atribuiu.");
  if (cfg.ID_PREFIX && !/^[A-Z]{2}$/.test(cfg.ID_PREFIX)) falhar("ID_PREFIX: as 2 letras que o hub atribuiu.");
}

/** Segredos do nó, criados na primeira vez (os que já existem ficam como estão). */
function segredos() {
  mkdirSync(SEGREDOS, { recursive: true });
  const arquivo = join(SEGREDOS, "segredos.env");
  const atuais = lerEnv(arquivo);
  const novos = {
    POSTGRES_PASSWORD: randomBytes(24).toString("base64url"),
    KEYCLOAK_ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
    OIDC_CLIENT_SECRET: randomBytes(32).toString("base64url"),
    COOKIE_SECRET: randomBytes(32).toString("base64url"),
    EDGE_SECRET: randomBytes(32).toString("base64url"),
  };
  const faltam = Object.entries(novos).filter(([k]) => !atuais[k]);
  if (faltam.length) {
    const cabecalho = existsSync(arquivo) ? readFileSync(arquivo, "utf8").trimEnd() : "# Segredos do nó, gerados pelo deploy/implantar.mjs. Não versionar.";
    writeFileSync(arquivo, `${cabecalho}\n${faltam.map(([k, v]) => `${k}=${v}`).join("\n")}\n`, { mode: 0o600 });
    info(`deploy/segredos/segredos.env: ${faltam.map(([k]) => k).join(", ")} gerado(s)`);
  }
  return lerEnv(arquivo);
}

// ---------------------------------------------------------------------------
// SSH
// ---------------------------------------------------------------------------

const usuario = () => cfg.VM_USUARIO || "root";
const comSudo = (cmd) => (usuario() === "root" ? cmd : `sudo -n ${cmd}`);

function sshArgs() {
  const chave = expandir(cfg.SSH_CHAVE);
  // Keepalive: o docker build passa minutos sem saída, e um NAT no caminho derruba a conexão ociosa.
  return [
    ...(chave ? ["-i", chave] : []),
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=8",
    `${usuario()}@${cfg.VM_IP}`,
  ];
}

/** Roda um script bash na VM, como root (via stdin: sem problemas de aspas). */
function ssh(script, o = {}) {
  return rodar("ssh", [...sshArgs(), comSudo("bash -s")], { entrada: `set -e\n${script}\n`, capturar: o.capturar ?? false, podeFalhar: o.podeFalhar });
}

/** tar local → comando remoto (envio de arquivos). */
function enviarTar(dirLocal, itens, destino, excluir = []) {
  return new Promise((ok, erro) => {
    const a = spawn("tar", ["--format", "ustar", "-cf", "-", ...excluir.map((e) => `--exclude=${e}`), "-C", dirLocal, ...itens], { stdio: ["ignore", "pipe", "inherit"] });
    const b = spawn("ssh", [...sshArgs(), comSudo(`sh -c ${aspas(`mkdir -p ${destino} && tar xf - -C ${destino}`)}`)], { stdio: ["pipe", "inherit", "inherit"] });
    a.stdout.pipe(b.stdin);
    const codigos = [];
    const fim = () => codigos.length === 2 && (codigos.every((c) => c === 0) ? ok() : erro(new Error(`envio falhou (${codigos.join(", ")})`)));
    a.on("close", (c) => (codigos.push(c), fim()));
    b.on("close", (c) => (codigos.push(c), fim()));
  });
}

async function esperarSsh() {
  passo(`VM ${cfg.VM_IP}: SSH como ${usuario()}`);
  for (let i = 0; i < 12; i++) {
    if (rodar("ssh", [...sshArgs(), comSudo("true")], { capturar: true, podeFalhar: true }).ok) return info("ok");
    await dormir(5000);
  }
  falhar(`sem SSH em ${usuario()}@${cfg.VM_IP} com a chave ${cfg.SSH_CHAVE ?? "(padrão)"}` + (usuario() === "root" ? "" : " (o usuário precisa de sudo sem senha)"));
}

// ---------------------------------------------------------------------------
// Etapas do up
// ---------------------------------------------------------------------------

function preparar() {
  passo("VM: Docker, swap, firewall e atualizações automáticas");
  ssh(`export DEBIAN_FRONTEND=noninteractive
cloud-init status --wait >/dev/null 2>&1 || true
for i in $(seq 1 60); do fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1 || break; sleep 5; done
echo 'DPkg::Lock::Timeout "300";' > /etc/apt/apt.conf.d/90agentes-lock
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh >/tmp/docker-install.log 2>&1; fi
if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo "/swapfile none swap sw 0 0" >> /etc/fstab; fi
if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null && ufw --force enable >/dev/null; fi
if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then apt-get -qq update && apt-get -y -qq install unattended-upgrades >/dev/null; fi
printf 'APT::Periodic::Update-Package-Lists "1";\\nAPT::Periodic::Unattended-Upgrade "1";\\n' > /etc/apt/apt.conf.d/20auto-upgrades
mkdir -p ${REMOTO}
echo "   $(docker --version)"`);
}

/** Túnel do nó e DNS dos três hostnames que passam por ele; devolve o ID e a credencial. */
function tunel() {
  passo("Cloudflare: túnel e DNS");
  const cf = cloudflared();
  if (!existsSync(join(homedir(), ".cloudflared", "cert.pem"))) falhar("Rode `cloudflared tunnel login` antes (uma vez), escolhendo o domínio do config.env.");
  const nome = `agentes-${cfg.SLUG}`;
  const lista = () => JSON.parse(rodar(cf, ["tunnel", "list", "--output", "json"], { capturar: true }).saida || "[]");
  let t = lista().find((x) => x.name === nome);
  let cred = t && join(homedir(), ".cloudflared", `${t.id}.json`);
  if (t && !existsSync(cred)) {
    info("credencial do túnel ausente nesta máquina; recriando o túnel");
    rodar(cf, ["tunnel", "cleanup", nome], { podeFalhar: true, capturar: true });
    rodar(cf, ["tunnel", "delete", "-f", nome], { capturar: true });
    t = null;
  }
  if (!t) {
    rodar(cf, ["tunnel", "create", nome], { capturar: true });
    t = lista().find((x) => x.name === nome);
    cred = join(homedir(), ".cloudflared", `${t.id}.json`);
  }
  const hosts = [cfg.API, cfg.AUTH, cfg.MCP];
  for (const h of hosts) rodar(cf, ["tunnel", "route", "dns", "--overwrite-dns", nome, h], { capturar: true });
  info(`túnel ${nome} (${t.id}); DNS ${hosts.join(", ")}`);
  return { id: t.id, cred };
}

async function enviarConfiguracao(t, s) {
  passo("VM: configuração");
  if (!existsSync(CHAVE_NO)) falhar("Falta a chave do nó: rode `npm run implantar -- chave` e peça a aprovação ao hub.");
  const palco = join(tmpdir(), `agentes-${randomBytes(4).toString("hex")}`);
  for (const sub of ["env", "secrets", "cloudflared", "keycloak", "postgres/init"]) mkdirSync(join(palco, sub), { recursive: true });
  copyFileSync(join(DEPLOY, "docker-compose.yml"), join(palco, "docker-compose.yml"));
  cpSync(join(DEPLOY, "postgres", "init"), join(palco, "postgres", "init"), { recursive: true });
  const realm = readFileSync(join(DEPLOY, "keycloak", "realm.template.json"), "utf8")
    .replaceAll("{{REALM}}", cfg.SLUG)
    .replaceAll("{{NOME}}", (cfg.NOME || cfg.SLUG).replace(/["\\]/g, ""))
    .replaceAll("{{SITE}}", cfg.SITE);
  JSON.parse(realm);
  writeFileSync(join(palco, "keycloak", "realm.json"), realm);
  writeFileSync(
    join(palco, "env", "no.env"),
    [
      "# API do nó na VM, gerado pelo deploy/implantar.mjs. DATABASE_URL, PORT e NODE_PRIVATE_KEY_FILE vêm do compose.",
      "NODE_ENV=production",
      "HOST=0.0.0.0",
      `PUBLIC_BASE_URL=https://${cfg.SITE}`,
      "REGISTRY_MODE=node",
      `NODE_CODE=${cfg.NODE_CODE}`,
      `ID_PREFIX=${cfg.ID_PREFIX}`,
      `HUB_URL=${cfg.HUB_URL.replace(/\/+$/, "")}`,
      `REGISTRY_NAME=${cfg.NOME || cfg.SLUG}`,
      ...(cfg.COR ? [`BRAND_COLOR=${cfg.COR}`] : []),
      `EDGE_SECRET=${s.EDGE_SECRET}`,
      `OIDC_ISSUER=https://${cfg.AUTH}/realms/${cfg.SLUG}`,
      `OIDC_CLIENT_ID=${cfg.SLUG}-web`,
      `OIDC_CLIENT_SECRET=${s.OIDC_CLIENT_SECRET}`,
      "OIDC_INTERNAL_URL=http://keycloak:8080",
      `COOKIE_SECRET=${s.COOKIE_SECRET}`,
      // O comando de publicação (ferramentas/publicar.mjs) entra por este cliente público e usa o token como Bearer.
      `OIDC_APP_CLIENT_ID=${cfg.SLUG}-cli`,
      "",
    ].join("\n"),
  );
  copyFileSync(CHAVE_NO, join(palco, "secrets", "no.pem"));
  copyFileSync(t.cred, join(palco, "cloudflared", `${t.id}.json`));
  writeFileSync(
    join(palco, "cloudflared", "config.yml"),
    [
      `tunnel: ${t.id}`,
      `credentials-file: /etc/cloudflared/${t.id}.json`,
      "",
      "ingress:",
      `  - hostname: ${cfg.API}`,
      "    service: http://no:3100",
      `  - hostname: ${cfg.MCP}`,
      "    service: http://agentes:4200",
      // Keycloak: só login, conta e recursos; o console de administração não sai da VM.
      `  - hostname: ${cfg.AUTH}`,
      "    path: ^/(realms|resources)/",
      "    service: http://keycloak:8080",
      `  - hostname: ${cfg.AUTH}`,
      "    service: http_status:404",
      "  - service: http_status:404",
      "",
    ].join("\n"),
  );
  // O token do assistente vem do ambiente; sem ele, preserva o que já estiver na VM.
  let claude = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "";
  if (!claude) claude = ssh(`grep -s '^CLAUDE_CODE_OAUTH_TOKEN=' ${REMOTO}/.env | cut -d= -f2- || true`, { capturar: true, podeFalhar: true }).saida;
  writeFileSync(
    join(palco, ".env"),
    [
      `POSTGRES_PASSWORD=${s.POSTGRES_PASSWORD}`,
      `KEYCLOAK_ADMIN_PASSWORD=${s.KEYCLOAK_ADMIN_PASSWORD}`,
      `REALM_WEB_SECRET=${s.OIDC_CLIENT_SECRET}`,
      `AUTH_HOST=${cfg.AUTH}`,
      `MCP_URL=https://${cfg.MCP}`,
      `BUILD_CONTEXT=${FONTES_REMOTO}`,
      `INSTALL_CLAUDE=${claude ? "true" : "false"}`,
      `CLAUDE_CODE_OAUTH_TOKEN=${claude}`,
      "",
    ].join("\n"),
  );
  await enviarTar(palco, ["."], REMOTO);
  ssh(`cd ${REMOTO}
find cloudflared -name '*.json' ! -name '${t.id}.json' -delete
chmod 600 .env env/*.env secrets/* cloudflared/*.json
chown -R 1000:1000 secrets && chown 65532:65532 cloudflared/*.json
${COMPOSE} config --quiet && echo "   compose válido"`);
}

async function construirImagens(servicos = ["no", "agentes"]) {
  passo("Código: envio e build das imagens na VM");
  if (!existsSync(join(RAIZ, "package-lock.json"))) falhar("Falta package-lock.json: rode `npm install` na raiz.");
  ssh(`rm -rf ${FONTES_REMOTO}`);
  await enviarTar(RAIZ, FONTES, FONTES_REMOTO, EXCLUIR);
  // O compose constrói a partir de BUILD_CONTEXT (no .env da VM): o código enviado para ${FONTES_REMOTO}.
  ssh(`${COMPOSE} build -q ${servicos.map((x) => (x === "no" ? "migrate no" : x)).join(" ")} && echo "   imagens prontas: ${servicos.join(", ")}"
docker image prune -f >/dev/null`);
}

function subir() {
  passo("VM: subindo a stack");
  // O cloudflared só lê o config.yml ao iniciar: reinicia para valer o que acabou de ser enviado.
  ssh(`${COMPOSE} up -d --remove-orphans >/dev/null 2>&1 || ${COMPOSE} up -d --remove-orphans
${COMPOSE} restart tunnel >/dev/null 2>&1
${COMPOSE} ps --format '   {{.Service}}: {{.Status}}'`);
}

function worker(s) {
  passo(`Cloudflare: site ${cfg.SITE} (Worker)`);
  if (!existsSync(join(RAIZ, "node_modules"))) npm(["ci", "--no-audit", "--no-fund"], { cwd: RAIZ });
  npm(["run", "build", "--workspace", "@agentikal/web"], { cwd: RAIZ });
  writeFileSync(
    WRANGLER_PRODUCAO,
    JSON.stringify(
      {
        $schema: "../../node_modules/wrangler/config-schema.json",
        name: `agentes-${cfg.SLUG}`,
        main: "src/worker.ts",
        compatibility_date: "2026-09-01",
        assets: { directory: "../web/dist", binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: true },
        observability: { enabled: true },
        workers_dev: false,
        routes: [{ pattern: cfg.SITE, custom_domain: true }],
        vars: { API_ORIGIN: `https://${cfg.API}` },
      },
      null,
      2,
    ) + "\n",
  );
  // Primeiro o deploy (o secret put numa conta sem o Worker pergunta se deve criá-lo); depois o segredo.
  npx(["wrangler", "deploy", "-c", WRANGLER_PRODUCAO], { cwd: RAIZ });
  npx(["wrangler", "secret", "put", "EDGE_SECRET", "-c", WRANGLER_PRODUCAO], { entrada: s.EDGE_SECRET, cwd: RAIZ });
}

async function verificar() {
  passo("Verificação pelos endereços públicos");
  const alvos = [
    { nome: `https://${cfg.SITE}/api/instance`, testar: async (r) => r.ok && (await r.json()).mode === "node" },
    { nome: `https://${cfg.AUTH}/realms/${cfg.SLUG}/.well-known/openid-configuration`, testar: async (r) => r.ok },
    { nome: `https://${cfg.MCP}/`, testar: async (r) => r.ok },
  ];
  for (let i = 0; i < 12; i++) {
    const res = await Promise.all(
      alvos.map(async (a) => {
        try {
          const r = await fetch(a.nome, { signal: AbortSignal.timeout(10000) });
          return { a, status: r.status, ok: await a.testar(r) };
        } catch {
          return { a, status: 0, ok: false };
        }
      }),
    );
    if (res.every((r) => r.ok) || i === 11) {
      for (const r of res) info(`${r.a.nome} → ${r.status}${r.ok ? "" : " (ainda não)"}`);
      return res.every((r) => r.ok);
    }
    await dormir(5000);
  }
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

function chave() {
  exigir("NOME", "SITE");
  mkdirSync(SEGREDOS, { recursive: true });
  if (!existsSync(CHAVE_NO)) {
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(CHAVE_NO, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    info("chave do nó criada em deploy/segredos/no.pem (não compartilhe; guarde uma cópia)");
  }
  const publica = createPublicKey(createPrivateKey(readFileSync(CHAVE_NO))).export({ type: "spki", format: "der" }).toString("base64");
  console.log(`
Mande ao administrador do hub (${cfg.HUB_URL || "https://registry.agentik.al"}):

  Nome do nó:     ${cfg.NOME}
  Site:           https://${cfg.SITE}
  Chave pública:  ${publica}

Ele aprova com:
  npm run federation -- node:create "${cfg.NOME}" ${publica}

e devolve NODE_CODE e ID_PREFIX. Preencha os dois em deploy/config.env e rode: npm run implantar -- up`);
}

async function up() {
  exigir("VM_IP", "SLUG", "NOME", "SITE", "API", "AUTH", "MCP", "HUB_URL", "NODE_CODE", "ID_PREFIX");
  const s = segredos();
  await esperarSsh();
  preparar();
  const t = tunel();
  await enviarConfiguracao(t, s);
  await construirImagens();
  subir();
  if (!args.includes("--sem-site")) worker(s);
  const ok = await verificar();
  console.log(
    ok
      ? `\n\x1b[32mPronto.\x1b[0m Site: https://${cfg.SITE}\nPróximo passo: crie sua conta com  npm run implantar -- usuario <email> "<Nome>"  e publique com  npm run publicar -- <pasta>`
      : "\n\x1b[33mA stack subiu, mas algum endereço ainda não responde. Rode `npm run implantar -- status` em instantes.\x1b[0m",
  );
}

async function agentes() {
  exigir("VM_IP");
  await esperarSsh();
  await construirImagens(["agentes"]);
  passo("VM: reiniciando os agentes");
  ssh(`${COMPOSE} up -d --no-deps agentes >/dev/null 2>&1 && ${COMPOSE} ps agentes --format '   {{.Service}}: {{.Status}}'`);
  if (cfg.MCP) {
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`https://${cfg.MCP}/`).catch(() => null);
      if (r?.ok) return console.log(`\n${JSON.stringify(await r.json(), null, 2)}`);
      await dormir(5000);
    }
    info(`https://${cfg.MCP}/ ainda não responde`);
  }
}

/** Conta no Keycloak do nó (cadastro fechado), com senha temporária que a pessoa troca no primeiro login. */
function criarUsuario(nova) {
  exigir("VM_IP", "SLUG", "SITE");
  const [, email, ...nome] = args;
  if (!email?.includes("@") || (nova && nome.length === 0)) falhar(nova ? 'Uso: npm run implantar -- usuario <email> "<Nome>"' : "Uso: npm run implantar -- senha <email>");
  const login = email.toLowerCase();
  const [primeiro, ...resto] = nome.join(" ").trim().split(/\s+/);
  const senha = randomBytes(9).toString("base64url");
  const passos = [
    "K=/opt/keycloak/bin/kcadm.sh",
    `$K config credentials --server http://localhost:8080 --realm master --user admin --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null`,
    ...(nova
      ? [`$K create users -r ${cfg.SLUG} -s username=${aspas(login)} -s email=${aspas(login)} -s firstName=${aspas(primeiro)} -s lastName=${aspas(resto.join(" ") || "-")} -s enabled=true -s emailVerified=true >/dev/null`]
      : []),
    `$K set-password -r ${cfg.SLUG} --username ${aspas(login)} --new-password "$NOVA_SENHA" --temporary`,
  ].join(" && ");
  passo(`${nova ? "Conta" : "Nova senha"} em https://${cfg.SITE}`);
  ssh(`${COMPOSE} exec -T -e NOVA_SENHA=${aspas(senha)} keycloak sh -c ${aspas(passos)}`);
  info(`${login}: senha temporária (troque no primeiro login): ${senha}`);
}

async function status() {
  exigir("VM_IP");
  passo("VM");
  const r = ssh(`${COMPOSE} ps --format '   {{.Service}}: {{.Status}}' 2>/dev/null || echo '   (sem stack)'`, { capturar: true, podeFalhar: true });
  console.log(r.ok ? r.saida : "   sem acesso SSH");
  if (cfg.SITE) await verificar();
}

function logs() {
  exigir("VM_IP");
  const servico = args[1] ?? "";
  ssh(`${COMPOSE} logs --tail 80 ${servico}`);
}

async function backup() {
  exigir("VM_IP");
  const dir = join(SEGREDOS, "backups", new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15));
  mkdirSync(dir, { recursive: true });
  passo(`Backup → ${dir}`);
  for (const db of ["registry", "keycloak"]) {
    const arquivo = join(dir, `${db}.dump`);
    await new Promise((ok, erro) => {
      const p = spawn("ssh", [...sshArgs(), comSudo(`${COMPOSE} exec -T db pg_dump -U registry -Fc ${db}`)], { stdio: ["ignore", "pipe", "inherit"] });
      p.stdout.pipe(createWriteStream(arquivo));
      p.on("close", (c) => (c === 0 ? ok() : erro(new Error(`pg_dump ${db}: código ${c}`))));
    });
    info(`${db}.dump: ${Math.round(statSync(arquivo).size / 1024)} KB`);
  }
}

process.chdir(RAIZ);
const comandos = { chave, up, agentes, usuario: () => criarUsuario(true), senha: () => criarUsuario(false), status, logs, backup };
if (!comandos[comando]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*/, "").replace(/^ \* ?/gm, ""));
} else {
  await Promise.resolve(comandos[comando]()).catch((e) => falhar(e.message));
}
