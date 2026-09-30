---
name: agentikal-no
description: >-
  Cria um agente MCP e publica no Agentikal Registry (registry.agentik.al) por um nó próprio: monta o repositório
  a partir do template, escreve e testa o agente, sobe a infraestrutura numa VM com Cloudflare (túnel, DNS, Worker,
  Keycloak) e publica até o agente aparecer no hub. Use quando pedirem para criar, subir ou publicar um agente no
  Agentikal, montar um nó do registry, ou colocar agentes MCP no ar numa VM com Cloudflare. Serve também para mudar
  um agente já publicado (versão nova).
---

# Agentikal: criar o agente, a infra e subir tudo

Você vai levar a pessoa do zero até um agente MCP dela no catálogo do hub do Agentikal Registry. O caminho passa
por um **nó**: uma cópia do registry na VM da pessoa, que hospeda os agentes e os envia ao hub. Tudo o que é
técnico já está pronto no repositório template: comandos para implantar, publicar e checar o estado. O seu papel é:
- entender o que a pessoa quer;
- escrever o agente;
- rodar os comandos na ordem certa;
- parar nos passos que só a pessoa pode fazer.

## Regras (valem o tempo todo)

1. **O que é da pessoa, a pessoa faz.** Não execute nem simule estes passos; diga exatamente o que ela deve rodar ou
   fazer e espere ela confirmar:
   - `cloudflared tunnel login` e `npx wrangler login` (abrem o navegador na conta do Cloudflare dela);
   - mandar a chave pública ao administrador do hub e trazer `NODE_CODE` e `ID_PREFIX`;
   - `npm run implantar -- usuario ...` e `senha ...` (mostram uma senha temporária);
   - o login no navegador que o `npm run publicar` abre;
   - autorizar a chave SSH na VM, criar a VM e apontar o domínio para o Cloudflare.
2. **Segredos.** Não leia, não mostre e não faça commit de `deploy/segredos/`, `.publicar/` nem `*.pem`. Do
   `deploy/config.env`, só os campos de que precisar (ele não tem senhas). Nunca peça senha no chat.
3. **Publicar é público.** Antes do primeiro `npm run publicar -- <pasta>`, mostre à pessoa o nome, o endereço @, o
   resumo e as ferramentas, e espere um "sim".
4. **Não invente regra de negócio.** Preço, política, horário, integração com API de terceiros: pergunte. Se a
   pessoa quiser um exemplo fictício, deixe isso claro na descrição do agente.
5. **Comandos longos.** `npm run implantar -- up` leva de 5 a 20 minutos (build na VM). Rode com tempo limite
   generoso, ou em segundo plano acompanhando a saída. Não rode dois `up` ao mesmo tempo.
6. **Na dúvida, `npm run estado`.** Ele diz o que já está pronto e qual é o próximo passo, com quem deve agir
   (`a pessoa` ou `a IA`). Use depois de cada etapa.

## Fase 0: o repositório

Se a pasta atual já é o template (tem `ferramentas/estado.mjs` e `deploy/implantar.mjs`), pule para o `npm install`.
Se não, pergunte onde criar a pasta do projeto e rode:

```bash
git clone https://github.com/sergioleal/template <pasta-do-projeto>
```

Depois `cd <pasta-do-projeto>`, e opcionalmente `git remote remove origin` se a pessoa quiser um repositório próprio.

```bash
npm install
```

```bash
npm run estado -- --local
```

Leia o `AGENTS.md` do repositório: ele tem as regras de um agente (anotações, `agente.json`, erros, versões) e a
tabela de problemas comuns. Esta skill não repete tudo.

## Fase 1: conversa inicial (uma rodada de perguntas, agrupadas)

**Sobre o agente:**
- O que ele faz e para quem? Quem vai conversar com ele (em geral, o agente pessoal de outra pessoa no hub)?
- Quais ações ele oferece? Para cada uma: é consulta, simulação/cotação ou **compromisso** (reserva, compra,
  cancelamento, envio)?
- De onde vêm os dados: fixos no código (demo), um arquivo, um banco, uma API de terceiros (qual, com qual chave)?
- Regras de negócio: preços, prazos, limites, horários.
- Nome, endereço @ desejado e região (vira tag, ex.: `df`, `sp`).

**Sobre o nó** (se `deploy/config.env` ainda não existe):
- Nome da empresa ou projeto (`NOME`) e um identificador curto (`SLUG`).
- O domínio que está no Cloudflare. Proponha os quatro endereços (`agentes.`, `api-agentes.`, `auth-agentes.` e
  `mcp-agentes.` + domínio) e deixe a pessoa ajustar.
- A VM: provedor, IP, usuário (root ou com sudo sem senha) e qual chave SSH entra nela. Se ainda não existe VM,
  oriente a criar uma Ubuntu 22.04+ com 2 vCPU e 4 GB, com a chave pública SSH da pessoa.
- O hub: por padrão `https://registry.agentik.al`, e quem é o administrador que vai aprovar o nó.

Resuma o combinado em poucas linhas e siga.

## Fase 2: o agente (dá para fazer enquanto a infra espera a pessoa)

1. Copie `agentes/reserva-salas` para `agentes/<pasta>`. A pasta vira a URL `https://<MCP>/<pasta>/mcp`: use
   minúsculas e hífen. Pergunte se o exemplo `reserva-salas` deve continuar. Ele é público e iria para o hub junto
   com o novo. Se não for ficar, apague `agentes/reserva-salas` depois de copiar, ou mude para `"visibilidade": "unlisted"`.
2. Reescreva os três arquivos seguindo o `AGENTS.md`:
   - `agente.mjs`: `criar()` devolve um `McpServer` novo. `instructions` começa com o que o agente faz. Cada
     ferramenta tem `description` clara, `inputSchema` com `.describe()` e `annotations`:
     - consulta: `readOnlyHint: true`;
     - cotação ou simulação: `readOnlyHint: false, destructiveHint: false`;
     - compromisso: `destructiveHint: true`.
     Erros de negócio saem como `isError: true`, com o que fazer.
   - `agente.json`: nome, endereço, resumo (≤ 280), tags, `versao` igual à do `McpServer`, `descricao.md` e
     exemplos escritos como a pessoa pediria. A primeira tag é a categoria. Antes de inventar uma, veja as que já
     existem no hub com `npm run tags -- <termo>` (ex.: `npm run tags -- show`); sem `config.env`, ele consulta
     `https://registry.agentik.al`.
   - `descricao.md`: ferramentas, fluxo, regras e limitações.
3. Dependência nova: `npm install <pacote> --workspace @template/agentes`. Segredo de API de terceiros: variável de
   ambiente no serviço `agentes` do `deploy/docker-compose.yml`. Combine com a pessoa como o valor chega à VM, sem
   passar por você.
4. Teste local. Suba o servidor em segundo plano (é um processo que não termina) com `agentes:dev`. Só ele recarrega
   ao salvar; com `node agentes/servidor.mjs`, você testaria o código antigo. Ao recarregar, o estado em memória volta
   ao início. Para outra porta, use `PORT=<n>` no servidor **e** no `testar`.

   ```bash
   npm run agentes:dev
   ```

   Em outro terminal:

   ```bash
   npm run testar -- <pasta>
   ```

   ```bash
   npm run testar -- <pasta> <ferramenta> '{"campo": "valor"}'
   ```

   Teste o caminho feliz de cada ferramenta e pelo menos um erro por compromisso. Confira à mão pelo menos duas
   contas (preço, prazo). O `testar` deve dizer `agente.json ok`, sem avisos de versão ou de annotations. Argumentos
   fora do schema voltam como erro de validação do SDK (código -32602), não pela sua mensagem: descreva bem cada
   campo com `.describe()`. Regras que dependem da hora (validade, prazos) ficam testáveis se o agente aceitar uma
   variável de ambiente `AGORA` (ISO) como hora atual.

## Fase 3: a infraestrutura

Siga o `npm run estado` até ele não apontar falta na infra. Na ordem:

1. `cp deploy/config.example.env deploy/config.env` e preencha com o que a pessoa disse na fase 1. Deixe
   `NODE_CODE` e `ID_PREFIX` vazios por enquanto.
2. Gere a chave do nó:

   ```bash
   npm run implantar -- chave
   ```

   Mostre à pessoa o bloco que o comando imprime (nome, site e chave pública: nada disso é segredo) e peça para ela
   mandar ao administrador do hub. **Pause aqui.** Quando ela trouxer `NODE_CODE` e `ID_PREFIX`, preencha no
   `config.env`.
3. Peça para a pessoa rodar, no terminal dela, e avisar quando terminar:
   - `cloudflared tunnel login` (escolhendo o domínio);
   - `npx wrangler login`.
4. Confira `npm run estado`: SSH na VM precisa estar ok. Se falhar, a pessoa ajusta a chave, o IP ou o usuário.
5. Suba tudo:

   ```bash
   npm run implantar -- up
   ```

   O comando é idempotente: se falhar no meio, corrija a causa (a mensagem diz qual) e rode de novo.
6. Peça para a pessoa criar a conta dela e trocar a senha temporária no primeiro login:

   ```bash
   npm run implantar -- usuario <email> "<Nome>"
   ```

## Fase 4: publicar

1. Leve os agentes para a VM:

   ```bash
   npm run implantar -- agentes
   ```

   Confira pela URL pública:

   ```bash
   npm run testar -- <pasta> --url https://<MCP>/<pasta>/mcp
   ```

2. Mostre o resumo à pessoa (regra 3) e, com o "sim", publique:

   ```bash
   npm run publicar -- <pasta>
   ```

   Na primeira vez, avise: "vai abrir o navegador, entre com a conta que você criou". O comando espera o nó enviar
   o agente ao hub e termina com o link dele lá (`@<endereco>.<nó>`).
3. Entregue à pessoa:
   - o link no hub;
   - o link no nó;
   - duas ou três frases de exemplo para testar no chat do hub.

   Lembre: para o chat do hub conversar com o agente, o administrador do hub precisa liberar o host `MCP` em
   `ASSISTANT_AGENT_HOSTS`.
4. `npm run estado` deve terminar em "Tudo pronto".

## Mudanças depois

- **Ferramentas, descrição ou exemplos:** suba a versão (patch para correção, minor para ferramenta nova, major
  para mudança incompatível) no `agente.json` **e** no `McpServer`. Depois:
  1. teste local;
  2. `npm run implantar -- agentes`;
  3. `npm run publicar -- <pasta>`.
- **Nome, resumo, tags ou visibilidade:** edite o `agente.json` e rode `npm run publicar -- <pasta>`.
- **Mudou `deploy/config.env` ou o código do nó:** `npm run implantar -- up`.

## Quando algo dá errado

1. `npm run estado` (ou `npm run estado -- --json` para ler em estrutura).
2. `npm run implantar -- status` e `npm run implantar -- logs <no|agentes|keycloak|tunnel|db>`.
3. A tabela "Quando algo falha" do `AGENTS.md`.
4. Mais casos em [references/problemas.md](references/problemas.md).

Nunca contorne um erro desligando uma verificação (ex.: tirar o `EDGE_SECRET`, abrir portas na VM). Diga à pessoa
o que aconteceu.
