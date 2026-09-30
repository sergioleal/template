# Template: seus agentes no Agentikal Registry

Este repositório é um ponto de partida para uma empresa ou pessoa publicar os **próprios agentes MCP** no
[Agentikal Registry](https://registry.agentik.al). Você sobe, numa VM sua, um **nó** do registry (o mesmo código da
"Empresa Exemplo") com os seus agentes. O nó envia os agentes públicos ao **hub**, onde qualquer pessoa os encontra
e o agente pessoal de cada uma conversa com eles.

Uma IA pode fazer o caminho inteiro com você (criar o agente, montar a infraestrutura e publicar) pela skill
`agentikal-no`: veja [Com uma IA](#com-uma-ia-claude-code-codex-cursor). As regras para ela estão em [AGENTS.md](AGENTS.md).

```
                        Cloudflare                                   Sua VM (Docker)
                 ┌──────────────────────────┐         ┌───────────────────────────────────────────┐
 navegador ────▶ │ Worker  https://SITE     │── API ─▶│ no        API do nó (registry, modo node) │
                 │ (site + repasse da API)  │  túnel  │ agentes   servidor MCP: /<pasta>/mcp      │
 hub e agentes ─▶│ https://MCP  (túnel)     │────────▶│ keycloak  login do nó                     │
 pessoais        │ https://AUTH (túnel)     │────────▶│ db        Postgres (nó + contas)          │
                 └──────────────────────────┘         │ tunnel    cloudflared (só saída)          │
                                                      │ backup    pg_dump diário                  │
        hub (registry.agentik.al) ◀── envio assinado (Ed25519) dos agentes públicos ── no         │
                                                      └───────────────────────────────────────────┘
```

A VM não abre nenhuma porta de entrada além do SSH: tudo chega pelo túnel do Cloudflare. Serve qualquer provedor
(DigitalOcean, AWS, Hetzner, Azure, uma máquina própria), desde que seja Ubuntu 22.04+ com SSH.

## O que tem aqui

| Pasta | O que é |
|---|---|
| `agentes/` | **Seus agentes.** Cada pasta com `agente.mjs` é um agente MCP, servido em `https://<MCP>/<pasta>/mcp`. Vem com `reserva-salas` de exemplo. |
| `ferramentas/publicar.mjs` | Publica um agente no seu nó (login pelo navegador, uma vez) e espera ele aparecer no hub. |
| `deploy/` | Implantação: `implantar.mjs`, `docker-compose.yml`, realm do Keycloak, `config.example.env`. |
| `apps/api`, `apps/web`, `apps/edge`, `packages/shared` | O código do nó, copiado do registry (veja [UPSTREAM.md](UPSTREAM.md)). Não precisa mexer. |

## Com uma IA (Claude Code, Codex, Cursor)

A skill `agentikal-no` guia a IA do começo ao fim:
1. pergunta o que o agente faz e os dados do nó;
2. escreve e testa o agente;
3. sobe a infraestrutura;
4. publica até o agente aparecer no hub.

Ela para nos passos que são seus: os logins do Cloudflare, a aprovação do hub, a criação da sua conta e o login da
publicação. Em qualquer ponto, `npm run estado` mostra o que já está pronto e o próximo passo.

| Ferramenta | Onde a skill está | Como chamar |
|---|---|---|
| Claude Code | `.claude/skills/agentikal-no/` | `/agentikal-no`, ou peça "crie e publique um agente no Agentikal" |
| Codex | `.agents/skills/agentikal-no/` | `$agentikal-no`, ou o mesmo pedido |
| Cursor | `.agents/skills/agentikal-no/` | `/agentikal-no`, ou o mesmo pedido |

Para usar fora deste repositório (a IA clona o template para você), copie a pasta da skill para a pasta de skills
do seu usuário:
- Claude Code: `~/.claude/skills/agentikal-no`;
- Codex e Cursor: `~/.agents/skills/agentikal-no`.

Quem editar a skill edita `.agents/skills/agentikal-no` e roda `npm run skill:sincronizar`, que atualiza a cópia do
Claude Code.

Em [exemplos/](exemplos/) há prompts prontos, como o de um agente que agenda shows de uma banda.

## Do zero ao agente no hub

Você precisa de:
- uma **VM** Ubuntu 22.04+ com acesso SSH por chave, como `root` ou um usuário com `sudo` sem senha. Recomendado:
  2 vCPU e 4 GB de RAM (o Keycloak usa até 1 GB);
- um **domínio no Cloudflare** (plano gratuito serve), para os quatro endereços do nó;
- nesta máquina: **Node.js 22+**, `ssh`, [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  e acesso à conta do Cloudflare.

### 1. Instale e configure

```bash
npm install
```

```bash
cp deploy/config.example.env deploy/config.env
```

Preencha `deploy/config.env`: IP e usuário da VM, a chave SSH, o nome do nó (`NOME`), um identificador curto
(`SLUG`, ex.: `minhaempresa`) e os quatro endereços:

| Variável | Exemplo | O que é |
|---|---|---|
| `SITE` | `agentes.minhaempresa.com.br` | Site do nó (Worker) |
| `API` | `api-agentes.minhaempresa.com.br` | API do nó (túnel; o Worker repassa para cá) |
| `AUTH` | `auth-agentes.minhaempresa.com.br` | Login (Keycloak) |
| `MCP` | `mcp-agentes.minhaempresa.com.br` | Os agentes (`https://<MCP>/<pasta>/mcp`) |

### 2. Peça a aprovação do nó ao hub

```bash
npm run implantar -- chave
```

O comando gera a chave do nó em `deploy/segredos/no.pem` (guarde uma cópia; nunca compartilhe) e mostra a **chave
pública**. Mande o nome do nó, o site e essa chave ao administrador do hub. Ele aprova com
`npm run federation -- node:create "<Nome>" <chave>` e devolve **`NODE_CODE`** e **`ID_PREFIX`**: preencha os dois
no `deploy/config.env`.

### 3. Entre no Cloudflare (uma vez nesta máquina)

```bash
cloudflared tunnel login
```

```bash
npx wrangler login
```

No `cloudflared tunnel login`, escolha o domínio dos endereços do `config.env`.

### 4. Suba o nó

```bash
npm run implantar -- up
```

O comando instala o Docker na VM e gera os segredos em `deploy/segredos/`. Depois cria o túnel e o DNS, envia o
código, constrói as imagens na própria VM (não precisa de Docker aqui), sobe a stack e publica o site no Worker. No
fim, confere os endereços públicos. Pode rodar de novo quantas vezes quiser: ele atualiza o que mudou.

### 5. Crie a sua conta

```bash
npm run implantar -- usuario voce@minhaempresa.com.br "Seu Nome"
```

A senha temporária aparece **uma vez**, no terminal; troque no primeiro login. O cadastro é fechado: só entra quem
você criar assim.

### 6. Publique o agente de exemplo

```bash
npm run publicar -- reserva-salas
```

Na primeira vez, o navegador abre para você entrar com a conta do passo 5. Depois o comando:
1. lê as ferramentas do agente pela URL pública;
2. publica o agente no nó;
3. espera o nó enviá-lo ao hub.

No fim, ele mostra o link no hub, com o endereço `@reserva-salas.<seu-nó>`.

## Criar os seus agentes

1. Copie `agentes/reserva-salas` para `agentes/<sua-pasta>`. O nome da pasta vira a URL.
2. Escreva as ferramentas em `agente.mjs`. No `agente.json`, preencha nome, endereço @, resumo, tags, versão e
   frases de exemplo; a descrição longa vai em `descricao.md`.
3. Teste localmente:

   ```bash
   npm run agentes:dev
   ```

   ```bash
   npm run testar -- <sua-pasta>
   ```

   Para chamar uma ferramenta: `npm run testar -- <sua-pasta> <ferramenta> '{"arg": 1}'`.
4. Suba os agentes na VM:

   ```bash
   npm run implantar -- agentes
   ```

5. Publique:

   ```bash
   npm run publicar -- <sua-pasta>
   ```

Versões são **imutáveis**. Para mudar ferramentas ou descrição, suba `versao` no `agente.json` e no `agente.mjs`
(ex.: 1.0.0 → 1.1.0), rode `implantar -- agentes` e `publicar` de novo. Mudanças de nome, resumo, tags e
visibilidade valem sem versão nova.

`"visibilidade": "unlisted"` deixa o agente só no seu nó, sem ir ao hub.

## Operação

| Comando | Para quê |
|---|---|
| `npm run implantar -- status` | Serviços na VM e resposta dos endereços públicos |
| `npm run implantar -- logs no` | Log de um serviço (`no`, `agentes`, `keycloak`, `tunnel`, `db`) |
| `npm run implantar -- backup` | Copia os bancos para `deploy/segredos/backups/` (a VM também guarda 14 dias) |
| `npm run implantar -- senha <email>` | Nova senha temporária para uma conta |
| `npm run publicar -- listar` | Seus agentes no nó e as versões |
| `npm run publicar -- sair` | Apaga o login guardado em `.publicar/` |
| `npm run estado` | O que já está pronto e o próximo passo (`-- --local` sem rede, `-- --json` para scripts) |

O painel do nó (`https://SITE`, com login) também cria agentes, publica versões e mostra a situação do envio ao hub.

## Bom saber

- **O agente pessoal do hub só conversa com hosts liberados.** O hub lista os hosts em `ASSISTANT_AGENT_HOSTS`. Para
  que as pessoas conversem com os seus agentes pelo chat do hub, peça ao administrador para incluir o seu `MCP`.
  Sem isso, os agentes aparecem no catálogo e na busca e respondem a quem os chamar direto por MCP.
- **Compromisso pede confirmação.** Ferramentas com `destructiveHint: true` (reservar, pagar, cancelar) só são
  chamadas pelo agente pessoal depois que a pessoa clica em Confirmar. Consultas levam `readOnlyHint: true`.
- **Segredos** ficam em `deploy/segredos/` e `.publicar/`, fora do git. Sem `deploy/segredos/no.pem` o nó perde a
  identidade no hub: guarde uma cópia.
- **Assistente do nó (opcional).** O site do nó tem um assistente que usa o Claude CLI. Para ligá-lo, rode o `up`
  com `CLAUDE_CODE_OAUTH_TOKEN` no ambiente (gerado por `claude setup-token`).
