# Imagem dos agentes (servidor MCP). Build a partir da raiz do repositório:
#   docker build -f agentes/Dockerfile -t agentes-mcp .
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY agentes/package.json agentes/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/edge/package.json apps/edge/
RUN npm ci --omit=dev --workspace @template/agentes --ignore-scripts && npm cache clean --force
COPY agentes agentes
USER node
ENV HOST=0.0.0.0 PORT=4200
EXPOSE 4200
CMD ["node", "agentes/servidor.mjs"]
