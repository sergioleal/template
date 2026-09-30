/**
 * Resultado de uma ferramenta de outro agente (JSON arbitrário) → Markdown legível para o chat.
 *
 * Genérico: não conhece o formato de nenhum agente. Rótulos saem das chaves (com um dicionário para
 * as mais comuns), valores em reais quando o objeto traz `moeda: "BRL"`, datas ISO no formato local,
 * booleanos como ✓/✗, objetos aninhados em sublistas e listas de objetos planos em tabela.
 *
 * O conteúdo vem de agentes de fora: todo texto é escapado, para um agente não injetar links nem formatação.
 */

const LABELS: Record<string, string> = {
  id: "ID",
  numero: "Número",
  cnpj: "CNPJ",
  cpf: "CPF",
  descricao: "Descrição",
  valor: "Valor",
  valor_atual: "Valor atual",
  valor_proposto: "Valor proposto",
  moeda: "Moeda",
  metodo: "Método",
  pagador: "Pagador",
  pagador_no_registry: "Pagador no registry",
  contratante: "Contratante",
  responsavel: "Responsável",
  pago_em: "Pago em",
  autenticacao: "Autenticação",
  aviso: "Aviso",
  fornecedor: "Fornecedor",
  pedido_id: "Pedido",
  cotacao_id: "Cotação",
  comprovante: "Comprovante",
  pagamento: "Pagamento",
  chave: "Chave",
  vencimento: "Vencimento",
  data: "Data",
  pessoas: "Pessoas",
  local: "Local",
  inclui: "Inclui",
  negociavel: "Negociável",
  validade: "Validade",
  status: "Situação",
  mensagem: "Mensagem",
  rodadas_restantes: "Rodadas restantes",
  brinde_se_fechar_hoje: "Brinde se fechar hoje",
  endereco: "Endereço",
  verificado: "Verificado",
  nome: "Nome",
  dono: "Dono",
  tipo: "Tipo",
  erro: "Erro",
};

const CURRENCY_KEYS = /^(valor|total|preco|preço|subtotal|desconto)(_|$)/i;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Escapa o que o Markdown interpretaria (links, ênfase, código, HTML, cabeçalhos, tabelas).
 * Os autolinks do GFM (http://, www., e-mails) ignoram escapes: quem renderiza este Markdown
 * precisa bloquear links e imagens (AgentJson em UiBlocks.tsx usa disallowedElements).
 */
export function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()<>#+!|~]/g, (c) => `\\${c}`).replace(/\r?\n/g, " ");
}

/** Rótulo legível da chave, em texto puro. */
export function labelText(key: string): string {
  const known = LABELS[key.toLowerCase()];
  if (known) return known;
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const label = (key: string) => escapeMd(labelText(key));

/** Valor legível em texto puro (para exibir como texto no React, sem Markdown). */
export function valueText(value: unknown, key: string, currency: string | null): string {
  const v = value as Json;
  if (v !== null && typeof v === "object") return Array.isArray(v) && v.every(isScalar) ? v.map((x) => valueText(x, key, currency)).join(", ") : "…";
  const s = scalar(v, key, currency);
  // scalar devolve Markdown: desfaz o escape e o código inline.
  return s.replace(/^`(.*)`$/, "$1").replace(/\\(.)/g, "$1");
}

/** Moeda informada no objeto (moeda/currency de 3 letras), se houver. */
export function currencyIn(value: unknown): string | null {
  return value && typeof value === "object" && !Array.isArray(value) ? currencyOf(value as { [k: string]: Json }, null) : null;
}

// Campos que mais contam numa troca entre agentes, nesta ordem; os demais entram depois, até o limite.
const SUMMARY_FIRST = ["status", "valor_atual", "valor", "valor_proposto", "mensagem", "argumento", "pedido_id", "numero", "data", "pessoas", "cidade", "responsavel", "pagador"];

/**
 * Resumo de uma mensagem entre agentes: os campos simples mais relevantes, como pares rótulo/valor em
 * texto puro. Objetos com uma única chave-objeto (ex.: { comprovante: {...} }) são abertos.
 */
export function summaryPairs(value: unknown, currency: string | null, max = 5): { label: string; value: string }[] {
  let v = value as Json;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v);
    const only = keys.length === 1 ? v[keys[0]!] : undefined;
    if (only && typeof only === "object" && !Array.isArray(only)) v = only;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return v === undefined ? [] : [{ label: "", value: valueText(v, "", currency) }];
  const obj = v;
  const cur = currencyOf(obj, currency);
  const keys = Object.keys(obj).filter((k) => isScalar(obj[k]!) && !(cur && (k === "moeda" || k === "currency")));
  keys.sort((a, b) => {
    const ia = SUMMARY_FIRST.indexOf(a), ib = SUMMARY_FIRST.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.slice(0, max).map((k) => ({ label: labelText(k), value: valueText(obj[k], k, cur) }));
}

function scalar(value: Json, key: string, currency: string | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "✓ sim" : "✗ não";
  if (typeof value === "number") {
    if (currency && CURRENCY_KEYS.test(key)) {
      try {
        return value.toLocaleString("pt-BR", { style: "currency", currency });
      } catch {
        // moeda desconhecida: cai no número simples
      }
    }
    return value.toLocaleString("pt-BR");
  }
  const s = String(value);
  if (ISO_DATETIME.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString("pt-BR");
  }
  if (ISO_DATE.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  // Identificadores e hashes em fonte monoespaçada.
  if (/^[A-Z]{2,4}-[0-9A-F]{4,}$/.test(s) || /^[0-9a-f]{24,}$/i.test(s) || /^@[\w.-]+$/.test(s)) return `\`${s}\``;
  return escapeMd(s);
}

const isScalar = (v: Json): v is null | boolean | number | string => v === null || typeof v !== "object";
const isFlatObject = (v: Json): v is { [k: string]: Json } =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every(isScalar);

function currencyOf(obj: { [k: string]: Json }, inherited: string | null): string | null {
  const m = obj.moeda ?? obj.currency;
  return typeof m === "string" && /^[A-Z]{3}$/.test(m) ? m : inherited;
}

function table(rows: { [k: string]: Json }[], currency: string | null): string[] {
  // A moeda some da tabela quando todas as linhas a informam: ela já aparece nos valores.
  const everyHasCurrency = rows.every((r) => currencyOf(r, currency));
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(
    (c) => !(everyHasCurrency && (c === "moeda" || c === "currency")),
  );
  const cell = (r: { [k: string]: Json }, c: string) => (r[c] === undefined ? "" : scalar(r[c]!, c, currencyOf(r, currency)));
  return [
    `| ${cols.map(label).join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${cols.map((c) => cell(r, c)).join(" | ")} |`),
  ];
}

function lines(value: Json, key: string, depth: number, currency: string | null): string[] {
  const pad = "  ".repeat(depth);
  if (isScalar(value)) return [`${pad}- ${scalar(value, key, currency)}`];
  if (Array.isArray(value)) {
    if (value.every(isScalar)) return [`${pad}- ${value.map((v) => scalar(v, key, currency)).join(", ") || "—"}`];
    return value.flatMap((v, i) => [`${pad}- **${i + 1}.**`, ...lines(v, key, depth + 1, currency)]);
  }
  const cur = currencyOf(value, currency);
  return Object.entries(value).flatMap(([k, v]) => {
    // A moeda já aparece nos valores formatados.
    if ((k === "moeda" || k === "currency") && cur) return [];
    if (isScalar(v)) return [`${pad}- **${label(k)}:** ${scalar(v, k, cur)}`];
    if (Array.isArray(v) && v.every(isScalar)) {
      return [`${pad}- **${label(k)}:** ${v.map((x) => scalar(x, k, cur)).join(", ") || "—"}`];
    }
    return [`${pad}- **${label(k)}:**`, ...lines(v, k, depth + 1, cur)];
  });
}

/**
 * Markdown do resultado. Um objeto com uma única chave-objeto (ex.: { comprovante: {...} }) vira título.
 * `currency`: moeda a usar quando o próprio objeto não informa (ex.: argumentos de um pagamento).
 */
export function resultToMarkdown(value: unknown, currency: string | null = null): string {
  const v = value as Json;
  if (typeof v === "string") return escapeMd(v);
  if (Array.isArray(v) && v.length > 0 && v.every(isFlatObject)) return table(v, currency).join("\n");
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v);
    const only = keys.length === 1 ? v[keys[0]!] : undefined;
    if (only && typeof only === "object" && !Array.isArray(only)) {
      return [`**${label(keys[0]!)}**`, "", ...lines(only, keys[0]!, 0, currency)].join("\n");
    }
  }
  return lines(v, "", 0, currency).join("\n");
}
