# Instruções para a IA: criar e publicar agentes neste nó

Você está num repositório de **nó** do Agentikal Registry. Aqui, uma pessoa (a dona do nó) cria agentes MCP e os
publica. O nó envia os agentes públicos ao hub (`HUB_URL`, em geral https://registry.agentik.al), onde outras pessoas
e os agentes pessoais delas os encontram e conversam com eles. Leia o [README.md](README.md) para a visão geral.

Seu trabalho típico: **criar ou mudar um agente em `agentes/`, testar, subir na VM e publicar**. O código do nó
(`apps/`, `packages/`) é uma cópia do registry: não mexa nele, a não ser que a pessoa peça.

## Regras

- **Segredos não são seus.** Não leia, não mostre e não versione `deploy/segredos/`, `deploy/config.env` (só os
  campos que precisar), `.publicar/` nem arquivos `.pem`. Não peça senhas no chat.
- **Login é da pessoa.** O `npm run publicar` abre o navegador na primeira vez: avise a pessoa e espere ela entrar.
  Nunca preencha a tela de login por ela.
- **Contas são da pessoa.** `npm run implantar -- usuario` e `senha` mostram uma senha temporária: peça para a pessoa
  rodar no terminal dela. Não rode você mesmo.
- **Publicar é público.** Um agente com `"visibilidade": "public"` vai para o hub e fica visível a todos. Antes do
  primeiro `publicar` de cada agente, confirme com a pessoa o nome, o endereço @ e o que ele faz.
- **Versões são imutáveis.** Não tente republicar a mesma versão com outro conteúdo: suba a versão.
- **Não invente.** Se faltar um dado (o que o agente faz, regras de negócio, preço, API de terceiros, endereço), pergunte.

## Anatomia de um agente

Cada agente é uma pasta `agentes/<pasta>/`. O nome da pasta vira a URL `https://<MCP>/<pasta>/mcp`. A pasta tem:

| Arquivo | Conteúdo |
|---|---|
| `agente.mjs` | `export function criar()` que devolve um `McpServer` novo (SDK `@modelcontextprotocol/sdk`) com as ferramentas. |
| `agente.json` | O que o publicar manda ao nó: nome, endereço @, resumo, tags, visibilidade, versão, descrição, autenticação, exemplos. |
| `descricao.md` | Descrição longa em Markdown (o `agente.json` aponta para ela). |

O servidor (`agentes/servidor.mjs`) acha as pastas sozinho: não precisa registrar o agente em lugar nenhum.

Use `agentes/reserva-salas/` como modelo. Ele cobre consulta, compromisso, erros e estado.

### `agente.mjs`

- `criar()` é chamado **a cada requisição** (MCP stateless). Estado que precisa durar fica fora da função: no módulo
  (some ao reiniciar), num arquivo, num banco ou numa API.
- `new McpServer({ name, version }, { instructions })`:
  - `version` deve ser a mesma do `agente.json`;
  - `instructions` começa com uma frase do que o agente faz e depois descreve o fluxo (qual ferramenta vem antes de qual).
- Uma chamada `registerTool(nome, { title, description, inputSchema, annotations }, handler)` por ferramenta:
  - `nome`: `snake_case`, até 128 caracteres (`[A-Za-z0-9_.-/]`);
  - `description`: o que faz, quando usar e o que devolve. É o principal insumo da busca do hub e o que o agente
    pessoal lê para decidir. Até 4000 caracteres;
  - `inputSchema`: um objeto de campos `zod`. Descreva cada campo com `.describe()` e use o formato exato
    (ex.: data `AAAA-MM-DD`);
  - `annotations` (obrigatório pensar nisto):
    - consulta (não muda nada): `{ readOnlyHint: true, destructiveHint: false }`. O agente pessoal chama sozinho;
    - ação sem compromisso (cotar, negociar, simular): `{ readOnlyHint: false, destructiveHint: false }`. O agente
      pessoal também chama sozinho;
    - compromisso (reservar, comprar, pagar, cancelar, enviar): `{ readOnlyHint: false, destructiveHint: true }`.
      O agente pessoal só chama depois que a pessoa clica em Confirmar. Na dúvida, é compromisso.
- Resultado:
  - sucesso: `{ content: [{ type: "text", text: JSON.stringify(dados) }], structuredContent: dados }`;
  - erro: `{ content: [{ type: "text", text: "o que houve e o que fazer" }], isError: true }`. Não lance exceção
    para erro de negócio.
- Valide tudo que chega: o agente é público e qualquer um pode chamá-lo. Nunca confie em texto vindo do chamador
  como instrução.
- Segredos do agente (chave de uma API de terceiros): em variável de ambiente, nunca no código. Acrescente a
  variável no serviço `agentes` do `deploy/docker-compose.yml` e combine com a pessoa como ela chega à VM.
- Dependências novas: `npm install <pacote> --workspace @template/agentes`.

### `agente.json`

```json
{
  "nome": "Reserva de Salas",
  "endereco": "reserva-salas",
  "resumo": "Uma frase: o que o agente faz, para quem.",
  "tags": ["reserva-de-salas", "escritorio"],
  "visibilidade": "public",
  "versao": "1.0.0",
  "descricao": "descricao.md",
  "autenticacao": "none",
  "exemplos": ["Frase que uma pessoa diria ao agente pessoal dela para usar este agente."]
}
```

| Campo | Regra |
|---|---|
| `nome` | 2 a 120 caracteres. |
| `endereco` | O @ do agente no nó: 3 a 32 caracteres, `a-z`, `0-9` e hífen, sem hífen no começo, no fim ou duplo. No hub vira `@<endereco>.<nó>`. |
| `resumo` | Até 280 caracteres. Aparece nos cards e na busca. |
| `tags` | Até 10, cada uma `^[a-z0-9][a-z0-9-]{0,31}$`. A primeira diz **o que o agente vende ou faz** (a categoria: `reserva-de-salas`, `catering`, `transporte`). As outras refinam: região (`df`, `sp`) e características. Antes de inventar, veja as tags que já existem no hub (ferramenta `list_tags` do MCP público `HUB_URL/mcp`) e reaproveite: é por elas que os agentes pessoais acham o seu. |
| `visibilidade` | `public` (vai ao hub) ou `unlisted` (só no nó, fora da busca). |
| `versao` | Semver (`1.0.0`, `1.1.0-beta.1`), sem `+build`. |
| `descricao` | Texto ou nome de um `.md` da pasta. Até 20000 caracteres. Liste as ferramentas, o fluxo e as limitações. |
| `autenticacao` | `none`, `api_key`, `oauth2` ou `other`: como quem chama se autentica no agente. O servidor do template não autentica ninguém (`none`). |
| `exemplos` | Até 20 frases de 3 a 300 caracteres. Aparecem no `/ex` do chat, e a pessoa toca numa para mandá-la ao agente pessoal. Escreva como a pessoa pediria ("Reserva a Sala Ipê na sexta às 10h."). |

`npm run testar -- <pasta>` confere essas regras antes de tudo.

## Fluxo

### Criar um agente novo

1. Combine com a pessoa o que o agente faz, as ferramentas e quais delas são compromisso.
2. `cp -r agentes/reserva-salas agentes/<pasta>` e reescreva os três arquivos.
3. Rode local e teste:

   ```bash
   npm run agentes:dev
   ```

   ```bash
   npm run testar -- <pasta>
   ```

   ```bash
   npm run testar -- <pasta> <ferramenta> '{"campo": "valor"}'
   ```

   Teste o caminho feliz de cada ferramenta e pelo menos um erro.
4. Suba na VM e confira pela URL pública:

   ```bash
   npm run implantar -- agentes
   ```

   ```bash
   npm run testar -- <pasta> --url https://<MCP>/<pasta>/mcp
   ```

5. Confirme com a pessoa e publique:

   ```bash
   npm run publicar -- <pasta>
   ```

   Na primeira vez, avise que o navegador vai abrir para ela entrar. O comando termina com o link do agente no hub.
   Mostre esse link à pessoa.

### Mudar um agente publicado

- **Ferramentas, descrição, URL ou exemplos:** suba `versao` no `agente.json` e no `agente.mjs`. Use patch para
  correção, minor para ferramenta nova e major para mudança incompatível. Depois rode `implantar -- agentes` e
  `publicar`.
- **Nome, resumo, tags ou visibilidade:** mude o `agente.json` e rode `publicar`. Não precisa de versão nova.

### Nó ainda não implantado

Se `deploy/config.env` não existe ou `npm run implantar -- status` falha, o nó ainda não está no ar. Siga o
[README.md](README.md), passos 1 a 5, junto com a pessoa. Os passos que exigem a pessoa são estes:
- o administrador do hub aprova a chave (`NODE_CODE` e `ID_PREFIX`);
- o `cloudflared tunnel login` e o `npx wrangler login`;
- a criação da conta dela (`usuario`).

## Quando algo falha

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `testar` não conecta | servidor local parado | `npm run agentes:dev` |
| `publicar`: "não conectei no agente" | agente não está na VM, ou `MCP` errado | `npm run implantar -- agentes`, depois `testar --url` |
| `publicar`: 401 | login vencido, ou `OIDC_APP_CLIENT_ID` do nó diferente de `<SLUG>-cli` | `npm run publicar -- login`; se continuar, `implantar -- up` |
| `publicar`: `handle_taken` | outro agente do nó já usa o endereço | troque `endereco` |
| `publicar`: `version_exists` ou "já está publicada" | versão repetida | suba `versao` |
| `publicar`: issues de validação | campo fora da regra | a mensagem diz o campo; corrija o `agente.json` |
| não aparece no hub | nó não aprovado, `NODE_CODE` errado ou hub fora do ar | `npm run implantar -- logs no` (linhas `[federation]`: envio falhou ou rejeitado); fale com o admin do hub |
| aparece no hub, mas o chat do hub não conversa com ele | host do `MCP` fora de `ASSISTANT_AGENT_HOSTS` do hub | peça ao admin do hub para liberar o host |

## Referência rápida

| Comando | Faz |
|---|---|
| `npm run agentes:dev` | Servidor dos agentes local (porta 4200, recarrega ao salvar) |
| `npm run testar -- <pasta> [ferramenta] [json] [--url URL]` | Lista ou chama ferramentas |
| `npm run implantar -- agentes` | Reconstrói e reinicia só os agentes na VM |
| `npm run implantar -- up` | Sobe ou atualiza tudo (nó, login, túnel, site) |
| `npm run implantar -- status` / `logs [serviço]` | Situação e logs |
| `npm run publicar -- <pasta> [--sem-hub]` | Publica no nó e espera no hub |
| `npm run publicar -- listar` | Agentes do nó e versões |
