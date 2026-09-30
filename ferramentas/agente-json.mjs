/**
 * Leitura e conferência do agente.json de um agente (agentes/<pasta>/agente.json), com as mesmas regras que o nó
 * aplica ao publicar (packages/shared/src/schemas.ts, handle.ts e semver.ts). Assim o erro aparece antes, com o
 * nome do campo em português.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const REGRAS = {
  endereco: /^(?!.*--)[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/,
  tag: /^[a-z0-9][a-z0-9-]{0,31}$/,
  // semver.org sem metadados de build (+...), como o registry.
  versao: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/,
  autenticacao: ["none", "api_key", "oauth2", "other"],
  visibilidade: ["public", "unlisted"],
};

/** O agente.json, com a descrição já lida (o campo pode ser o texto ou o nome de um arquivo .md da pasta). */
export function lerAgente(dir) {
  const arquivo = join(dir, "agente.json");
  if (!existsSync(arquivo)) throw new Error(`${arquivo} não existe`);
  const a = JSON.parse(readFileSync(arquivo, "utf8"));
  let descricao = a.descricao ?? "";
  if (typeof descricao === "string" && /\.md$/.test(descricao) && existsSync(join(dir, descricao))) descricao = readFileSync(join(dir, descricao), "utf8");
  return {
    nome: a.nome,
    endereco: String(a.endereco ?? "").replace(/^@/, "").toLowerCase(),
    resumo: a.resumo ?? "",
    tags: [...new Set((a.tags ?? []).map((t) => String(t).trim().toLowerCase()))],
    visibilidade: a.visibilidade ?? "public",
    versao: a.versao,
    descricao: String(descricao).trim(),
    autenticacao: a.autenticacao ?? "none",
    exemplos: a.exemplos ?? [],
  };
}

/** Lista de problemas (vazia se o agente.json está bom). */
export function conferirAgente(dir) {
  let a;
  try {
    a = lerAgente(dir);
  } catch (e) {
    return [e.message];
  }
  const p = [];
  if (typeof a.nome !== "string" || a.nome.trim().length < 2 || a.nome.length > 120) p.push("nome: de 2 a 120 caracteres");
  if (!REGRAS.endereco.test(a.endereco)) p.push("endereco: 3 a 32 caracteres, letras minúsculas, números e hífen (sem hífen no começo, no fim ou duplo)");
  if (a.resumo.length > 280) p.push("resumo: no máximo 280 caracteres");
  if (a.tags.length > 10) p.push("tags: no máximo 10");
  for (const t of a.tags) if (!REGRAS.tag.test(t)) p.push(`tags: "${t}" inválida (minúsculas, números e hífen, até 32)`);
  if (!REGRAS.visibilidade.includes(a.visibilidade)) p.push(`visibilidade: ${REGRAS.visibilidade.join(" ou ")} (só public vai para o hub)`);
  if (!REGRAS.versao.test(String(a.versao ?? ""))) p.push("versao: semver, ex.: 1.0.0 (sem +build)");
  if (!a.descricao || a.descricao.length > 20000) p.push("descricao: obrigatória, até 20000 caracteres (texto ou nome de um .md da pasta)");
  if (!REGRAS.autenticacao.includes(a.autenticacao)) p.push(`autenticacao: ${REGRAS.autenticacao.join(", ")}`);
  if (!Array.isArray(a.exemplos) || a.exemplos.length > 20) p.push("exemplos: lista com até 20 frases");
  for (const e of a.exemplos ?? []) if (typeof e !== "string" || e.trim().length < 3 || e.length > 300) p.push(`exemplos: "${String(e).slice(0, 40)}" precisa ter de 3 a 300 caracteres`);
  return p;
}
