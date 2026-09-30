# Imagem do nó (a mesma API do registry; o modo vem do ambiente). Build a partir da raiz do repositório:
#   docker build -f apps/api/Dockerfile -t agentes-no .
# O Claude CLI (assistente) vem incluso; autentique com CLAUDE_CODE_OAUTH_TOKEN (gerado por `claude setup-token`).

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/edge/package.json apps/edge/
RUN npm ci --workspace @agentikal/api --include-workspace-root --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @agentikal/api

FROM node:24-slim AS runtime
ARG INSTALL_CLAUDE=true
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/edge/package.json apps/edge/
RUN npm ci --omit=dev --workspace @agentikal/api --ignore-scripts && npm cache clean --force
RUN if [ "$INSTALL_CLAUDE" = "true" ]; then npm install -g @anthropic-ai/claude-code && npm cache clean --force; fi
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
WORKDIR /app/apps/api
USER node
ENV HOST=0.0.0.0
EXPOSE 3000
# Migrações ficam num serviço à parte do compose (node dist/migrate.js).
CMD ["node", "dist/server.js"]
