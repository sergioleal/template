/**
 * Renderização dos componentes do assistente. Tudo que mostra dados busca na API com a sessão do
 * usuário (o modelo só manda IDs e consultas). Formulários e confirmações executam a ação pela API
 * normal do painel — a mudança é do usuário, feita com um clique — e registram um evento na conversa.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  createAgentSchema,
  extractTools,
  publishVersionSchema,
  updateAgentSchema,
  type AgentDocument,
  type ConfirmComponent,
  type FormComponent,
  type OwnedAgent,
  type QueryResult,
  type UiComponent,
  type Visibility,
} from "@agentikal/shared";
import { api, issuesToMap, RequestError } from "../../api.ts";
import { TagsField } from "../TagsField.tsx";
import { HandleField } from "../HandleField.tsx";
import { VisibilityBadge, VisibilityField } from "../VisibilityField.tsx";
import { examplesToText, textToExamples, toolsToText, VersionFields, type VersionDraft } from "../VersionForm.tsx";
import { Chart, ResultTable, type ChartKind } from "./Chart.tsx";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { resultToMarkdown } from "./resultMarkdown.ts";

export interface BlockContext {
  /** Registra na conversa o que o usuário fez (texto do evento + referência do componente). */
  recordEvent: (text: string) => Promise<void>;
  /** Evento já registrado para este componente (ele aparece como concluído). */
  done: string | null;
  /** confirm call_agent: pede ao servidor para executar a chamada proposta (ele grava o evento). */
  callAgent: () => Promise<void>;
  /** Moeda que o agente (ID ou @) usou nas respostas do turno, para formatar os argumentos de um compromisso. */
  currencyFor?: (agent: string) => string | null;
  /** agent_cards com choose: envia a escolha do usuário como a próxima mensagem. */
  send?: (text: string) => void;
  /** A conversa já seguiu depois desta resposta (a escolha já foi feita ou deixada de lado). */
  answered?: boolean;
}

/**
 * JSON vindo de outro agente: formatado em Markdown legível, com o JSON bruto recolhido.
 * Se não for JSON válido (resultado truncado), mostra o texto como veio.
 */
export function AgentJson({ json, currency = null }: { json: string; currency?: string | null }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return <pre className="mono small agent-raw">{json}</pre>;
  }
  return (
    <>
      <div className="agent-result prose">
        {/* Conteúdo de outro agente: sem links nem imagens, nem os que o GFM cria sozinho. */}
        <Markdown remarkPlugins={[remarkGfm]} disallowedElements={["a", "img"]} unwrapDisallowed>
          {resultToMarkdown(parsed, currency)}
        </Markdown>
      </div>
      <details className="event-details">
        <summary>Ver JSON</summary>
        <pre className="mono small">{JSON.stringify(parsed, null, 2)}</pre>
      </details>
    </>
  );
}

/**
 * Texto de um evento. Eventos de chamada a agente trazem o resultado em JSON depois de ": ";
 * o resumo vira o título e o resultado aparece formatado.
 */
export function EventText({ text }: { text: string }) {
  const m = /^((?:Confirmou|Falhou) .+?\)): ([[{"].*)$/s.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      <AgentJson json={m[2]!} />
    </>
  );
}

export function UiBlock({ component, ctx }: { component: UiComponent; ctx: BlockContext }) {
  switch (component.type) {
    case "agent_cards":
      return <AgentCards source={component.source} ids={component.ids} choose={component.choose ? ctx : null} />;
    case "form":
      return <FormBlock component={component} ctx={ctx} />;
    case "confirm":
      return <ConfirmBlock component={component} ctx={ctx} />;
    case "chart":
      return <QueryBlock title={component.title} query={component.query} chart={component.chart} />;
    case "table":
      return <QueryBlock title={component.title} query={component.query} />;
  }
}

// ---------------------------------------------------------------------------

function AgentCards({ source, ids, choose }: { source: "mine" | "catalog"; ids: string[]; choose: BlockContext | null }) {
  const [items, setItems] = useState<
    ({ id: string; handle: string | null; name: string; summary: string; latest: string | null; visibility?: Visibility } | { id: string; missing: true })[] | null
  >(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    Promise.all(
      ids.map(async (id) => {
        try {
          if (source === "mine") {
            const a = await api.get<OwnedAgent>(`/api/agents/${id}`);
            return { id: a.id, handle: a.handle ? `@${a.handle}` : null, name: a.name, summary: a.summary, latest: a.latest, visibility: a.visibility };
          }
          const d = await api.get<AgentDocument>(`/a/${id}/json`);
          return { id: d.id, handle: d.handle, name: d.name, summary: d.summary, latest: d.version };
        } catch {
          return { id, missing: true as const };
        }
      }),
    ).then(setItems);
  }, [source, ids.join(",")]);

  if (!items) return <div className="skeleton chat-skeleton" />;
  if (choose) {
    // Candidatos para o usuário escolher: o botão envia "Quero conversar com @x" como a próxima mensagem.
    const closed = picked !== null || choose.answered || !choose.send;
    return (
      <ul className="chat-cards">
        {items.map((a) =>
          "missing" in a ? null : (
            <li key={a.id} className={`chat-card chat-card-choice${picked === a.id ? " picked" : ""}`}>
              <span className="row between">
                <strong>{a.name}</strong>
                {a.latest && <span className="badge accent mono">{a.latest}</span>}
              </span>
              <span className="muted small clamp">{a.summary || "Sem resumo."}</span>
              <span className="row between small">
                <Link to={`/a/${a.id}`} className="mono">
                  {a.handle ?? a.id}
                </Link>
                {picked === a.id ? (
                  <span className="trace-decision-chosen">✓ Escolhido</span>
                ) : (
                  <button
                    type="button"
                    disabled={closed}
                    onClick={() => {
                      setPicked(a.id);
                      choose.send?.(`Quero conversar com ${a.handle ?? a.name}.`);
                    }}
                  >
                    Conversar com este
                  </button>
                )}
              </span>
            </li>
          ),
        )}
      </ul>
    );
  }
  return (
    <ul className="chat-cards">
      {items.map((a) =>
        "missing" in a ? (
          <li key={a.id} className="chat-card missing">
            <code className="mono">{a.id}</code>
            <span className="muted small">não encontrado</span>
          </li>
        ) : (
          <li key={a.id}>
            <Link to={source === "mine" ? `/painel/${a.id}` : `/a/${a.id}`} className="chat-card">
              <span className="row between">
                <strong>{a.name}</strong>
                {a.latest && <span className="badge accent mono">{a.latest}</span>}
              </span>
              <span className="muted small clamp">{a.summary || "Sem resumo."}</span>
              <span className="row small">
                <code className="mono muted">{a.id}</code>
                {a.visibility && <VisibilityBadge value={a.visibility} />}
              </span>
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function DoneBanner({ text }: { text: string }) {
  return (
    <div className="chat-done">
      ✓ <EventText text={text} />
    </div>
  );
}

function FormBlock({ component, ctx }: { component: FormComponent; ctx: BlockContext }) {
  if (ctx.done) return <DoneBanner text={ctx.done} />;
  switch (component.form) {
    case "create_agent":
      return <CreateAgentForm component={component} ctx={ctx} />;
    case "publish_version":
      return <PublishVersionForm component={component} ctx={ctx} />;
    case "edit_agent":
      return <EditAgentForm component={component} ctx={ctx} />;
  }
}

type Errors = Record<string, string>;

function useSubmit(ctx: BlockContext) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setFormError(null);
    try {
      await ctx.recordEvent(await fn());
    } catch (err) {
      if (err instanceof RequestError) {
        setErrors(issuesToMap(err.body.issues));
        setFormError(err.message);
      } else if (err instanceof Error && err.message) setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, setErrors, formError, run };
}

function parseToolsText(text: string): unknown[] {
  if (!text.trim()) return [];
  try {
    return extractTools(JSON.parse(text)) as unknown[];
  } catch {
    throw new Error("O manifesto de ferramentas não é um JSON válido");
  }
}

function CreateAgentForm({ component, ctx }: { component: Extract<FormComponent, { form: "create_agent" }>; ctx: BlockContext }) {
  const init = component.initial;
  const [name, setName] = useState(init.name ?? "");
  const [handle, setHandle] = useState(init.handle?.replace(/^@/, "") ?? "");
  const [summary, setSummary] = useState(init.summary ?? "");
  const [tags, setTags] = useState<string[]>(init.tags ?? []);
  const [visibility, setVisibility] = useState<Visibility>(init.visibility ?? "unlisted");
  const [draft, setDraft] = useState<VersionDraft>({
    version: init.version ?? "1.0.0",
    description: init.description ?? "",
    remotes: init.remotes?.length ? init.remotes : [{ type: "streamable-http", url: "" }],
    auth: init.auth ?? null,
    toolsText: init.tools_json ?? "",
    examplesText: "",
  });
  const s = useSubmit(ctx);

  return (
    <form
      className="chat-form stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(async () => {
          const { toolsText, examplesText, ...version } = draft;
          const body = {
            name,
            handle: handle || undefined,
            summary,
            tags,
            visibility,
            firstVersion: { ...version, tools: parseToolsText(toolsText), examples: textToExamples(examplesText) },
          };
          const parsed = createAgentSchema.safeParse(body);
          if (!parsed.success) {
            s.setErrors(issuesToMap(parsed.error.issues));
            throw new Error("Revise os campos destacados");
          }
          const created = await api.post<OwnedAgent>("/api/agents", parsed.data);
          return `Registrou o agente "${created.name}" @${created.handle} (${created.id}), versão ${draft.version}, ${created.visibility === "public" ? "público" : "não listado"}.`;
        });
      }}
    >
      <h3>Registrar agente</h3>
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        {s.errors.name && <span className="error">{s.errors.name}</span>}
      </label>
      <HandleField value={handle} onChange={setHandle} name={name} error={s.errors.handle} />
      <label>
        Resumo
        <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={280} />
      </label>
      <TagsField value={tags} onChange={setTags} error={s.errors.tags} />
      <VisibilityField value={visibility} onChange={setVisibility} />
      <VersionFields value={draft} onChange={setDraft} errors={s.errors} errorPrefix="firstVersion" />
      {s.formError && <p className="error">{s.formError}</p>}
      <button type="submit" disabled={s.busy}>
        {s.busy ? "Registrando…" : "Registrar e publicar"}
      </button>
    </form>
  );
}

function PublishVersionForm({ component, ctx }: { component: Extract<FormComponent, { form: "publish_version" }>; ctx: BlockContext }) {
  const [agent, setAgent] = useState<OwnedAgent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<VersionDraft | null>(null);
  const s = useSubmit(ctx);

  useEffect(() => {
    api.get<OwnedAgent>(`/api/agents/${component.agent_id}`).then(
      (a) => {
        setAgent(a);
        const top = a.versions[0];
        const init = component.initial;
        setDraft({
          version: init.version ?? "",
          description: init.description ?? top?.description ?? "",
          remotes: init.remotes?.length ? init.remotes : (top?.remotes ?? [{ type: "streamable-http", url: "" }]),
          auth: init.auth ?? top?.auth ?? null,
          toolsText: init.tools_json ?? toolsToText(top?.tools ?? []),
          examplesText: examplesToText(top?.examples ?? []),
        });
      },
      (e: Error) => setLoadError(e.message),
    );
  }, [component.agent_id]);

  if (loadError) return <p className="error">Agente {component.agent_id}: {loadError}</p>;
  if (!agent || !draft) return <div className="skeleton chat-skeleton" />;

  return (
    <form
      className="chat-form stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(async () => {
          const { toolsText, examplesText, ...rest } = draft;
          const parsed = publishVersionSchema.safeParse({ ...rest, tools: parseToolsText(toolsText), examples: textToExamples(examplesText) });
          if (!parsed.success) {
            s.setErrors(issuesToMap(parsed.error.issues));
            throw new Error("Revise os campos destacados");
          }
          await api.post<OwnedAgent>(`/api/agents/${agent.id}/versions`, parsed.data);
          return `Publicou a versão ${draft.version} de "${agent.name}" (${agent.id}).`;
        });
      }}
    >
      <h3>
        Nova versão de {agent.name}{" "}
        <span className="muted small">atual: {agent.latest ?? "—"}</span>
      </h3>
      <VersionFields value={draft} onChange={setDraft} errors={s.errors} />
      {s.formError && <p className="error">{s.formError}</p>}
      <button type="submit" disabled={s.busy}>
        {s.busy ? "Publicando…" : `Publicar ${draft.version}`}
      </button>
    </form>
  );
}

function EditAgentForm({ component, ctx }: { component: Extract<FormComponent, { form: "edit_agent" }>; ctx: BlockContext }) {
  const [agent, setAgent] = useState<OwnedAgent | null>(null);
  const [state, setState] = useState<{ name: string; handle: string; summary: string; tags: string[]; visibility: Visibility } | null>(
    null,
  );
  const s = useSubmit(ctx);

  useEffect(() => {
    api.get<OwnedAgent>(`/api/agents/${component.agent_id}`).then((a) => {
      setAgent(a);
      const i = component.initial;
      setState({ name: i.name ?? a.name, handle: i.handle?.replace(/^@/, "") ?? a.handle, summary: i.summary ?? a.summary, tags: i.tags ?? a.tags, visibility: i.visibility ?? a.visibility });
    });
  }, [component.agent_id]);

  if (!agent || !state) return <div className="skeleton chat-skeleton" />;
  return (
    <form
      className="chat-form stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(async () => {
          const parsed = updateAgentSchema.safeParse(state);
          if (!parsed.success) {
            s.setErrors(issuesToMap(parsed.error.issues));
            throw new Error("Revise os campos destacados");
          }
          await api.patch<OwnedAgent>(`/api/agents/${agent.id}`, parsed.data);
          return `Atualizou os dados de "${state.name}" (${agent.id}).`;
        });
      }}
    >
      <h3>Editar {agent.name}</h3>
      <label>
        Nome
        <input value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
        {s.errors.name && <span className="error">{s.errors.name}</span>}
      </label>
      <HandleField
        value={state.handle}
        onChange={(handle) => setState({ ...state, handle })}
        name={state.name}
        error={s.errors.handle}
        required
      />
      <label>
        Resumo
        <input value={state.summary} onChange={(e) => setState({ ...state, summary: e.target.value })} />
      </label>
      <TagsField value={state.tags} onChange={(tags) => setState({ ...state, tags })} error={s.errors.tags} />
      <VisibilityField value={state.visibility} onChange={(visibility) => setState({ ...state, visibility })} />
      {s.formError && <p className="error">{s.formError}</p>}
      <button type="submit" disabled={s.busy}>
        {s.busy ? "Salvando…" : "Salvar"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------

const CONFIRM_LABEL: Record<ConfirmComponent["action"], string> = {
  yank_version: "Retirar versão",
  unyank_version: "Restaurar versão",
  delete_agent: "Remover agente",
  set_visibility: "Alterar visibilidade",
  call_agent: "Confirmar",
};

function ConfirmBlock({ component: c, ctx }: { component: ConfirmComponent; ctx: BlockContext }) {
  const s = useSubmit(ctx);
  if (ctx.done) return <DoneBanner text={ctx.done} />;
  if (c.action === "call_agent") return <AgentCallConfirm component={c} ctx={ctx} />;
  const danger = c.action === "delete_agent" || c.action === "yank_version";

  const execute = () =>
    s.run(async () => {
      const id = encodeURIComponent(c.agent_id);
      switch (c.action) {
        case "yank_version":
          if (!c.version) throw new Error("Versão não informada");
          await api.post(`/api/agents/${id}/versions/${encodeURIComponent(c.version)}/yank`, { reason: c.reason ?? "" });
          return `Retirou a versão ${c.version} de ${c.agent_id}.`;
        case "unyank_version":
          if (!c.version) throw new Error("Versão não informada");
          await api.post(`/api/agents/${id}/versions/${encodeURIComponent(c.version)}/unyank`);
          return `Restaurou a versão ${c.version} de ${c.agent_id}.`;
        case "set_visibility":
          if (!c.visibility) throw new Error("Visibilidade não informada");
          await api.patch(`/api/agents/${id}`, { visibility: c.visibility });
          return `Mudou ${c.agent_id} para ${c.visibility === "public" ? "público" : "não listado"}.`;
        case "delete_agent":
          await api.delete(`/api/agents/${id}`);
          return `Removeu o agente ${c.agent_id}.`;
        case "call_agent":
          throw new Error("Tratado por AgentCallConfirm");
      }
    });

  return (
    <div className={`chat-confirm${danger ? " danger" : ""}`}>
      <p>{c.summary}</p>
      {s.formError && <p className="error">{s.formError}</p>}
      <button type="button" className={danger ? "danger" : undefined} disabled={s.busy} onClick={() => void execute()}>
        {s.busy ? "Executando…" : CONFIRM_LABEL[c.action]}
      </button>
    </div>
  );
}

/**
 * Compromisso com outro agente (ex.: pagar). Mostra exatamente o que será enviado; o servidor executa
 * a chamada que o assistente propôs, sem edição, uma vez só.
 */
function AgentCallConfirm({ component: c, ctx }: { component: ConfirmComponent; ctx: BlockContext }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const execute = async () => {
    setBusy(true);
    setError(null);
    try {
      await ctx.callAgent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="chat-confirm commitment">
      <p>{c.summary}</p>
      <p className="muted small">
        <code className="mono">{c.agent_id}</code> · <code className="mono">{c.tool}</code>
      </p>
      <div className="muted small">O que será enviado:</div>
      <AgentJson json={c.arguments_json ?? "{}"} currency={ctx.currencyFor?.(c.agent_id) ?? null} />
      {error && <p className="error">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void execute()}>
        {busy ? "Executando…" : CONFIRM_LABEL.call_agent}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function QueryBlock({ title, query, chart }: { title: string; query: unknown; chart?: ChartKind }) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(!chart);
  const key = JSON.stringify(query);

  const load = () => {
    setError(null);
    api.post<QueryResult>("/api/assistant/query", { query }).then(setResult, (e: Error) => setError(e.message));
  };
  useEffect(() => {
    load();
  }, [key]);

  const csv = () => {
    if (!result) return;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const text = [result.columns.map(esc).join(","), ...result.rows.map((r) => r.map(esc).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${title.replace(/[^\w-]+/g, "_")}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <figure className="chat-viz">
      <figcaption className="row between">
        <strong>{title}</strong>
        <span className="row">
          {chart && (
            <button type="button" className="ghost small" onClick={() => setAsTable(!asTable)}>
              {asTable ? "Ver gráfico" : "Ver tabela"}
            </button>
          )}
          <button type="button" className="ghost small" onClick={load} title="Recalcular com os dados atuais">
            Atualizar
          </button>
          <button type="button" className="ghost small" onClick={csv} disabled={!result}>
            CSV
          </button>
        </span>
      </figcaption>
      {error && <p className="error">{error}</p>}
      {!result && !error && <div className="skeleton chat-skeleton" />}
      {result && result.rows.length === 0 && <p className="muted small">A consulta não retornou dados.</p>}
      {result && result.rows.length > 0 && (asTable || !chart ? <ResultTable result={result} /> : <Chart kind={chart} result={result} />)}
      {result?.truncated && <p className="muted small">Mostrando os primeiros {result.rows.length} grupos.</p>}
    </figure>
  );
}
