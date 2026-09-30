/**
 * Bastidores da negociação: as conversas do agente pessoal com outros agentes num turno, e as que esses
 * agentes contaram ter com outros (ex.: o @tbuilder com os fornecedores, marcadas com `via`), agrupadas por
 * agente e numeradas na ordem em que aconteceram. Cada troca mostra o que foi enviado e o que voltou,
 * e o cabeçalho de cada agente, a evolução do valor até a última oferta.
 *
 * Tudo que vem dos agentes é exibido como texto (summaryPairs) ou como Markdown sem links (AgentJson).
 */
import type { AgentTraceEntry } from "@agentikal/shared";
import { currencyIn, summaryPairs, valueText } from "./resultMarkdown.ts";
import { AgentJson } from "./UiBlocks.tsx";

const unwrap = (v: unknown): unknown => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v);
    const only = keys.length === 1 ? (v as Record<string, unknown>)[keys[0]!] : undefined;
    if (only && typeof only === "object" && !Array.isArray(only)) return only;
  }
  return v;
};

/** Valor da oferta numa resposta: valor_atual (negociação) ou valor (cotação, pedido, comprovante). */
function offerOf(result: unknown): number | null {
  const r = unwrap(result) as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const v = r.valor_atual ?? r.valor;
  return typeof v === "number" ? v : null;
}

/** Situação curta de uma resposta, para o cabeçalho do agente. */
function statusOf(e: AgentTraceEntry): string {
  if (!e.ok) return "erro";
  const r = unwrap(e.result) as Record<string, unknown> | null;
  if (r && typeof r === "object") {
    if (typeof r.status === "string") return r.status;
    if ("comprovante" in (e.result as object)) return "pago";
    if (typeof r.pedido_id === "string") return "pedido fechado";
    if (typeof r.cotacao_id === "string") return "cotado";
  }
  return "respondeu";
}

const toolLabel = (tool: string) => tool.replace(/[_-]+/g, " ");

interface Group {
  key: string;
  handle: string | null;
  name: string;
  items: { n: number; e: AgentTraceEntry }[];
}

function groupByAgent(entries: AgentTraceEntry[]): Group[] {
  const groups = new Map<string, Group>();
  entries.forEach((e, i) => {
    const key = e.agent.id || e.agent.handle || e.agent.name;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, handle: e.agent.handle, name: e.agent.name, items: [] }));
    g.items.push({ n: i + 1, e });
  });
  return [...groups.values()];
}

function Pairs({ value, currency }: { value: unknown; currency: string | null }) {
  const pairs = summaryPairs(value, currency);
  if (!pairs.length) return <span className="muted small">sem dados</span>;
  return (
    <span className="trace-pairs">
      {pairs.map((p, i) => (
        <span key={i} className="trace-pair">
          {p.label && <span className="muted">{p.label}: </span>}
          {p.value}
        </span>
      ))}
    </span>
  );
}

function AgentLane({ g, me }: { g: Group; me: string }) {
  const { who, currency, path, last } = laneSummary(g);

  return (
    <details className="trace-agent" open>
      <summary>
        <span className="agent-handle">{who}</span>
        {g.handle && <span className="muted small"> {g.name}</span>}
        <span className="trace-meta">
          {path.length > 0 && (
            <span className="trace-path">{path.map((v) => valueText(v, "valor", currency)).join(" → ")}</span>
          )}
          <span className={`badge${last.ok ? "" : " warn"}`}>{statusOf(last)}</span>
          <span className="muted small">{g.items.length} troca(s)</span>
        </span>
      </summary>
      <ol className="trace-rows">
        {g.items.map(({ n, e }) => (
          <li key={n} className="trace-exchange">
            <div className="trace-row out">
              <div className="trace-head">
                {/* via: a troca foi de um agente que o seu chamou (ex.: o @tbuilder com um fornecedor). */}
                <span className="trace-n">#{n}</span> {e.via ? (e.via.handle ?? e.via.name) : me} → {who} ·{" "}
                <strong>{toolLabel(e.tool)}</strong>
              </div>
              <Pairs value={e.arguments} currency={currency} />
            </div>
            <div className={`trace-row in${e.ok ? "" : " failed"}`}>
              <div className="trace-head">
                {who} · {e.ok ? "respondeu" : "não aceitou a chamada"}
                <span className="muted small"> · {new Date(e.at).toLocaleTimeString("pt-BR")} · {e.ms} ms</span>
              </div>
              {typeof e.result === "string" ? <span className="small">{e.result}</span> : <Pairs value={e.result} currency={currency} />}
              {typeof e.result !== "string" && (
                <details className="event-details">
                  <summary>Resposta completa</summary>
                  <AgentJson json={JSON.stringify(e.result)} />
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Resumo de um agente: com quem, em que moeda, a evolução do valor e a última troca. */
function laneSummary(g: Group) {
  const who = g.handle ?? g.name;
  const currency = g.items.map(({ e }) => currencyIn(unwrap(e.result))).find(Boolean) ?? null;
  const offers = g.items.map(({ e }) => offerOf(e.result)).filter((v): v is number => v !== null);
  // Evolução sem repetições seguidas: 5.200 → 3.325.
  const path = offers.filter((v, i) => i === 0 || v !== offers[i - 1]);
  const last = g.items[g.items.length - 1]!.e;
  return { who, currency, path, last };
}

/**
 * Ao vivo (turno em andamento) o painel fica aberto. Com a resposta pronta ele nasce fechado, acima do
 * resultado, com uma linha por agente (último valor e situação); um clique reabre a conversa inteira.
 */
export function NegotiationTrace({ entries: all, me, live = false }: { entries: AgentTraceEntry[]; me: string | null; live?: boolean }) {
  if (!all.length) return null;
  // Decisões (kind "decision") não são trocas: vão formatadas antes da conversa com os agentes.
  const decisions = mergeDecisions(all.filter((e) => e.kind === "decision"));
  const entries = all.filter((e) => e.kind !== "decision");
  const chosen = chosenByNeed(entries);
  // Quem o agente pessoal chamou direto (sem via): marca, nas buscas dele, qual dos encontrados foi chamado.
  const called = new Set(entries.filter((e) => !e.via && e.agent.handle).map((e) => bare(e.agent.handle!)));
  const groups = groupByAgent(entries);
  return (
    <>
      {decisions.map((d, i) => (
        <Decision key={i} entry={d} chosen={chosen} called={called} />
      ))}
      {entries.length > 0 && (
    <details className={`trace${live ? " live" : ""}`} open={live}>
      <summary>
        <span className="trace-title">
          {live ? "Negociando agora" : "Conversa entre os agentes"}: {entries.length} mensagem(ns) com {groups.length} agente(s)
        </span>
        {!live && (
          <span className="trace-digest">
            {groups.map((g) => {
              const { who, currency, path, last } = laneSummary(g);
              return (
                <span key={g.key} className="trace-digest-item">
                  <span className="agent-handle">{who}</span>{" "}
                  {path.length > 0 && <span className="trace-path">{valueText(path[path.length - 1], "valor", currency)}</span>}{" "}
                  <span className="muted">{statusOf(last)}</span>
                </span>
              );
            })}
          </span>
        )}
      </summary>
      {groups.map((g) => (
        <AgentLane key={g.key} g={g} me={me ?? "seu agente"} />
      ))}
    </details>
      )}
    </>
  );
}

interface DecisionNeed {
  nome: string;
  motivo?: string;
  tags?: string[];
  encontrados?: string[];
}

const bare = (h: string) => h.replace(/^@/, "");

/** As decisões de um mesmo agente e ferramenta (ex.: as buscas do agente pessoal no turno) viram um cartão só. */
function mergeDecisions(decisions: AgentTraceEntry[]): AgentTraceEntry[] {
  const out = new Map<string, AgentTraceEntry>();
  for (const d of decisions) {
    const key = `${d.agent.handle ?? d.agent.name}|${d.tool}`;
    const prev = out.get(key);
    const needs = ((d.result ?? {}) as { necessidades?: DecisionNeed[] }).necessidades ?? [];
    if (!prev) {
      out.set(key, { ...d, result: { ...(d.result as object), necessidades: [...needs] } });
    } else {
      (prev.result as { necessidades: DecisionNeed[] }).necessidades.push(...needs);
    }
  }
  return [...out.values()];
}

/** O escolhido de cada necessidade, pelo resultado do planejar (itens[].categoria → escolhido), quando já chegou. */
function chosenByNeed(entries: AgentTraceEntry[]): Map<string, string> {
  const plan = [...entries].reverse().find((e) => e.result && typeof e.result === "object" && "itens" in (e.result as object))?.result as
    | { moeda?: string; itens?: { categoria: string; escolhido: { fornecedor: string; valor: number } | null }[] }
    | undefined;
  const currency = plan ? currencyIn(plan) : null;
  return new Map(
    (plan?.itens ?? []).filter((i) => i.escolhido).map((i) => [i.categoria, `${i.escolhido!.fornecedor} · ${valueText(i.escolhido!.valor, "valor", currency)}`]),
  );
}

/** Cartão da decisão: de que o evento precisa, por quê, com quais tags buscou, quem achou e, no fim, quem ficou. */
function Decision({ entry, chosen, called }: { entry: AgentTraceEntry; chosen: Map<string, string>; called: Set<string> }) {
  const r = (entry.result ?? {}) as { titulo?: string; necessidades?: DecisionNeed[] };
  const by = entry.via ? (entry.via.handle ?? entry.via.name) : null;
  return (
    <div className="trace-decision">
      <div className="trace-decision-head">
        <strong>{r.titulo ?? "Como os parceiros foram escolhidos"}</strong>
        <span className="muted small">
          {entry.agent.name}
          {by ? ` em nome de ${by}` : ""}
        </span>
      </div>
      <ul>
        {(r.necessidades ?? []).map((n, i) => (
          <li key={i}>
            <strong>{n.nome.charAt(0).toUpperCase() + n.nome.slice(1)}</strong>
            {n.motivo && <span className="muted"> — {n.motivo}</span>}
            <div className="trace-decision-tags">
              <span className="muted small">{n.tags?.length ? (n.tags.length > 1 ? "Tags escolhidas:" : "Tag escolhida:") : "Sem tags"}</span>
              {(n.tags ?? []).map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
            <div className="small">
              {n.encontrados?.length ? `Encontrados: ${n.encontrados.join(", ")}` : <span className="warn-text">Ninguém encontrado com essas tags</span>}
            </div>
            {(n.encontrados ?? []).some((h) => called.has(bare(h))) && (
              <div className="small trace-decision-chosen">
                Chamado: {(n.encontrados ?? []).filter((h) => called.has(bare(h))).map((h) => `@${bare(h)}`).join(", ")}
              </div>
            )}
            {chosen.get(n.nome) && <div className="small trace-decision-chosen">Escolhido: {chosen.get(n.nome)}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Moeda que um agente (ID ou @endereço) informou nas respostas do turno, se alguma informou. */
export function traceCurrency(entries: AgentTraceEntry[] | undefined, agent: string): string | null {
  const a = agent.trim().toLowerCase();
  for (const e of [...(entries ?? [])].reverse()) {
    if (e.agent.id.toLowerCase() !== a && e.agent.handle?.toLowerCase() !== a) continue;
    const c = currencyIn(unwrap(e.result));
    if (c) return c;
  }
  return null;
}
