# Origem do código do nó

`apps/api`, `apps/web`, `apps/edge`, `packages/shared`, `tsconfig.base.json` e `.dockerignore` são uma cópia do
Agentikal Registry (repositório `sergioleal/agentikalreg`), commit `8c082b6b8a8cc4e63c41a03b395233a01666a31c`
(30/09/2026). É o mesmo código que roda o nó "Empresa Exemplo" (`REGISTRY_MODE=node`).

Diferenças em relação ao original:
- sem os seeds de demonstração (`apps/api/scripts/seed-*.ts`) e sem a demo de team building no `Dockerfile`;
- `apps/edge/wrangler.jsonc` só para desenvolvimento local; o de produção é gerado pelo `deploy/implantar.mjs`.

Para atualizar, copie de novo as mesmas pastas de um commit mais novo do registry, reaplique as diferenças acima,
rode `npm install` e `npm run typecheck`, e anote aqui o commit novo. As migrações do banco (`apps/api/drizzle`)
rodam sozinhas no próximo `npm run implantar -- up`.
