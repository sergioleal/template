import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// ENV_FILE escolhe outro arquivo (ex.: rodar um nó e um hub na mesma máquina). Sem ele, procura o .env
// na pasta atual e na raiz do monorepo (npm workspaces roda os scripts em apps/api).
// Variáveis já definidas no ambiente têm precedência sobre as do arquivo.
const candidates = process.env.ENV_FILE ? [resolve(process.env.ENV_FILE)] : [resolve(".env"), resolve("../../.env")];
for (const candidate of candidates) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const emptyAsUndefined = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .transform((u) => u.replace(/\/+$/, "")),
  ID_PREFIX: z.string().regex(/^[A-Z]{2}$/, "ID_PREFIX deve ter 2 letras maiúsculas").default("ZZ"),
  WEB_DIST_DIR: z.preprocess(emptyAsUndefined, z.string().optional()),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  NODE_ENV: z.string().default("development"),
  // Enriquecimento semântico da busca (lib/enrich.ts). "none" desativa.
  SEARCH_ENRICHER: z.enum(["none", "claude-cli"]).default("none"),
  CLAUDE_CLI_PATH: z.string().optional(),
  CLAUDE_CLI_MODEL: z.string().optional(),
  // Assistente como agente do usuário (lib/assistant/agent-calls.ts): conversa por MCP com agentes do registry.
  // Desligado por padrão: com ele, a API passa a conectar nos endpoints dos agentes, só nos hosts listados.
  ASSISTANT_AGENT_CALLS: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
  // host:porta permitidos, separados por vírgula (ex.: "localhost:4100,mcp.fornecedor.example").
  ASSISTANT_AGENT_HOSTS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)),

  // Federação (lib/federation/*). hub: hospeda tenants e agrega os nós; node: instância de uma
  // empresa, que envia os agentes públicos ao hub.
  REGISTRY_MODE: z.enum(["hub", "node"]).default("hub"),
  // Código de 2 caracteres embutido nos IDs gerados aqui. No nó, é o código atribuído pelo hub.
  // No hub, é obrigatório antes de aprovar o primeiro nó. Sem ele, IDs saem totalmente aleatórios.
  NODE_CODE: z.preprocess(emptyAsUndefined, z.string().regex(/^[0-9A-HJ-NP-Z]{2}$/).optional()),
  HUB_URL: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .url()
      .transform((u) => u.replace(/\/+$/, ""))
      .optional(),
  ),
  NODE_PRIVATE_KEY_FILE: z.preprocess(emptyAsUndefined, z.string().optional()),
  FEDERATION_PUSH_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(60),

  // Login pelo Keycloak (lib/oidc.ts): realm do app e cliente confidencial "<app>-web".
  OIDC_ISSUER: z.preprocess(emptyAsUndefined, z.string().url().transform((u) => u.replace(/\/+$/, "")).optional()),
  OIDC_CLIENT_ID: z.preprocess(emptyAsUndefined, z.string().optional()),
  OIDC_CLIENT_SECRET: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Cliente público do app Android (android/): a API aceita o access token dele como Bearer em /api/*.
  // Sem ele, só vale a sessão por cookie do site.
  OIDC_APP_CLIENT_ID: z.preprocess(emptyAsUndefined, z.string().optional()),
  // Endereço do Keycloak visto pela API (na VM, http://keycloak:8080); sem ele, usa o público.
  OIDC_INTERNAL_URL: z.preprocess(emptyAsUndefined, z.string().url().optional()),
  // Assina o cookie curto que guarda o estado do login (state, PKCE, nonce) durante o vaivém pelo Keycloak.
  COOKIE_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),

  // Com o front no Cloudflare: segredo que o Worker envia em x-edge-secret; sem ele, a API recusa (lib/edge-guard.ts).
  EDGE_SECRET: z.preprocess(emptyAsUndefined, z.string().min(24).optional()),

  // Identidade exibida na interface. No nó, o nome da empresa (ex.: "Empresa Exemplo").
  REGISTRY_NAME: z.preprocess(emptyAsUndefined, z.string().max(80).optional()),
  // Cor principal da interface, em hex (#RRGGBB). Sem ela, hub e nó usam paletas padrão diferentes.
  BRAND_COLOR: z.preprocess(emptyAsUndefined, z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuração inválida:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
export const isHub = env.REGISTRY_MODE === "hub";
export const isNode = env.REGISTRY_MODE === "node";
