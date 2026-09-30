# Problemas conhecidos e o que fazer

Complementa a tabela "Quando algo falha" do `AGENTS.md`. Em cada caso, diga à pessoa o que aconteceu antes de agir.

## Implantação (`npm run implantar -- up`)

| Sintoma | Causa | O que fazer |
|---|---|---|
| "sem SSH em usuario@IP" | chave não autorizada, IP ou usuário errado, ou usuário sem sudo sem senha | a pessoa confere `ssh -i <chave> <usuario>@<ip>`; para usuário não root, `sudo -n true` precisa passar |
| trava muito tempo sem saída no build | normal: o build das imagens roda na VM (5 a 15 min na primeira vez) | espere; o ssh tem keepalive. Se cair, rode `up` de novo |
| "Rode `cloudflared tunnel login` antes" | falta `~/.cloudflared/cert.pem` | a pessoa roda `cloudflared tunnel login` e escolhe o domínio dos endereços |
| erro no `tunnel route dns` | o domínio escolhido no login não é o dos endereços, ou há um registro que não é CNAME com o mesmo nome | a pessoa refaz o `cloudflared tunnel login` com o domínio certo, ou apaga o registro antigo no painel do Cloudflare |
| wrangler: "Not logged in" ou "non-interactive" | login do wrangler venceu | a pessoa roda `npx wrangler login`; em automação, `CLOUDFLARE_API_TOKEN` no ambiente |
| wrangler: domínio já usado | outro Worker ou registro já usa o `SITE` | escolha outro `SITE` ou libere o domínio no painel |
| Keycloak não fica saudável | pouca memória (menos de 4 GB) ou primeiro start lento | espere 2 min e rode `status`; com 2 GB, o swap criado pelo `up` ajuda, mas 4 GB é o recomendado |
| "apt lock" no preparo | a VM recém-criada ainda está atualizando | o script espera até 5 min; rode `up` de novo se passar disso |
| site responde 403 `edge_only` | o Worker ainda não tem o `EDGE_SECRET` (o segredo entra logo depois do deploy) | espere alguns segundos; se persistir, rode `up` de novo (ele repõe o segredo) |

## Login e contas

| Sintoma | Causa | O que fazer |
|---|---|---|
| "Invalid redirect uri" no login do site ou do publicar | o `SITE` ou o `SLUG` mudou depois da primeira subida: o Keycloak só importa o realm uma vez | corrija pelo console do Keycloak (só de dentro da VM: `ssh -L 8080:localhost:8080` e `docker compose exec`), ou volte o `SITE` ao valor antigo |
| publicar: "porta 8976 ocupada" | outro login do publicar aberto, ou outro programa na porta | feche o outro processo e rode de novo |
| publicar: 401 | token vencido ou `OIDC_APP_CLIENT_ID` do nó diferente de `<SLUG>-cli` | `npm run publicar -- login`; se continuar, `npm run implantar -- up` |
| a pessoa esqueceu a senha | — | ela roda `npm run implantar -- senha <email>` |

## Hub

| Sintoma | Causa | O que fazer |
|---|---|---|
| agente não aparece no hub, log `[federation] envio falhou` com 401/403 | nó não aprovado, suspenso, ou `NODE_CODE` não bate com a chave | a pessoa confirma com o administrador do hub o código e a chave pública (`npm run implantar -- chave` mostra a mesma chave de novo) |
| log `[federation]` com erro de horário | relógio da VM adiantado ou atrasado mais de 5 min | na VM: `timedatectl set-ntp true` |
| `[federation] ... rejeitado` com `outside_namespace` ou `id_conflict` | `ID_PREFIX` ou `NODE_CODE` errados no `config.env` | corrija com os valores do administrador e rode `up`; agentes já criados com o prefixo errado precisam ser recriados |
| `HUB_URL` responde 403 `edge_only` | `HUB_URL` aponta para a API interna do hub | use o endereço público (ex.: `https://registry.agentik.al`) |
| no hub, mas o chat do hub não conversa com o agente | o host `MCP` não está em `ASSISTANT_AGENT_HOSTS` do hub | peça ao administrador do hub para liberar |

## Agente

| Sintoma | Causa | O que fazer |
|---|---|---|
| `testar` mostra "compromisso" numa consulta | faltou `readOnlyHint: true` | ajuste as `annotations`; suba a versão se já estiver publicado |
| o agente pessoal chama um compromisso sem pedir confirmação | a ferramenta está anotada como `destructiveHint: false` | anote como compromisso (`destructiveHint: true`) e publique versão nova |
| estado some ao reiniciar | dados em memória (como no exemplo) | guarde em arquivo num volume ou num banco; combine com a pessoa |
| erro 413 | corpo da requisição acima de 1 MB | ferramentas devem receber dados pequenos; referências em vez de arquivos inteiros |
