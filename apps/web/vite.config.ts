import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { parseEnv } from "node:util";

// Lê a porta da API direto do .env da raiz (process.env.PORT, se houver, é a porta do próprio Vite).
const envFile = new URL("../../.env", import.meta.url);
const rootEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
const API = process.env.API_URL ?? `http://127.0.0.1:${rootEnv.PORT ?? 3000}`;

/**
 * Em dev o Vite serve o SPA e repassa para a API:
 *  - /api/*, /mcp e /federation      → sempre para a API
 *  - /a/<id>…/json                   → sempre para a API (documento JSON)
 *  - /a/<id>… com Accept: text/html  → SPA (o navegador abre a página)
 *  - /a/<id>… sem text/html          → API (curl recebe JSON por content negotiation)
 */
const servePublicPageAsSpa = (req: IncomingMessage) => {
  const path = (req.url ?? "").split("?")[0]!;
  if (path.endsWith("/json")) return undefined;
  if ((req.headers.accept ?? "").includes("text/html")) return "/index.html";
  return undefined;
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API },
      "/mcp": { target: API },
      "/federation": { target: API },
      "/a/": { target: API, bypass: servePublicPageAsSpa },
    },
  },
});
