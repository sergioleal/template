import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env, isProduction } from "../env.ts";

/**
 * Em produção a API pode servir o build do SPA (WEB_DIST_DIR). Nas páginas públicas /a/* injetamos
 * <title> e meta tags Open Graph no index.html, para links compartilhados terem preview mesmo sem SSR.
 */
export const spaDir = env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : null;
const indexPath = spaDir ? resolve(spaDir, "index.html") : null;

let cached: string | null = null;
if (indexPath) {
  if (!existsSync(indexPath)) throw new Error(`WEB_DIST_DIR sem index.html: ${indexPath}`);
  cached = readFileSync(indexPath, "utf8");
}

// Em produção o index.html é lido uma vez; fora dela, a cada requisição, para um build novo valer sem reiniciar.
const loadTemplate = () => (isProduction || !indexPath ? cached : readFileSync(indexPath, "utf8"));

export const spaEnabled = () => cached !== null;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface PageMeta {
  title: string;
  description: string;
  url: string;
  jsonUrl?: string;
  /** Agentes não listados não devem ser indexados por buscadores. */
  noindex?: boolean;
}

export function renderSpa(meta?: PageMeta): string {
  const template = loadTemplate();
  if (!template) throw new Error("SPA não configurado");
  if (!meta) return template;
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description.slice(0, 300));
  const u = escapeHtml(meta.url);
  const head = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${u}">`,
    `<link rel="canonical" href="${u}">`,
    meta.jsonUrl ? `<link rel="alternate" type="application/json" href="${escapeHtml(meta.jsonUrl)}">` : "",
    meta.noindex ? `<meta name="robots" content="noindex">` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
  return template.replace(/<title>[\s\S]*?<\/title>/, head);
}
