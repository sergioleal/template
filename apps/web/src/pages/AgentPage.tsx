import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  LATEST,
  normalizeAgentRef,
  type AgentDocument,
  type PersonalAgentDocument,
  type VersionListDocument,
} from "@agentikal/shared";
import { api, RequestError } from "../api.ts";
import { CopyButton } from "../components/CopyButton.tsx";
import { pageTitle, useInstance } from "../instance.tsx";

type Tab = "overview" | "tools" | "endpoints" | "json";

const AUTH_LABELS = { none: "Sem autenticação", api_key: "Chave de API", oauth2: "OAuth 2.0", other: "Outra" } as const;

const ERRORS: Record<number, { title: string; text: string }> = {
  400: { title: "Endereço inválido", text: "O ID ou a versão não estão num formato válido." },
  404: { title: "Não encontrado", text: "Não existe agente ou versão com esse identificador." },
  410: { title: "Agente removido", text: "Este agente foi removido pelo dono. O ID permanece reservado." },
};

export function AgentPage() {
  const instance = useInstance();
  const { id: rawId = "", sel } = useParams();
  const navigate = useNavigate();
  const id = normalizeAgentRef(rawId);
  const [doc, setDoc] = useState<AgentDocument | PersonalAgentDocument | null>(null);
  const [versions, setVersions] = useState<VersionListDocument | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  // URLs em minúsculas ou com hífens são reescritas para a forma canônica.
  useEffect(() => {
    if (id !== rawId) navigate(sel ? `/a/${id}/v/${sel}` : `/a/${id}`, { replace: true });
  }, [id, rawId, sel, navigate]);

  const jsonPath = sel ? `/a/${id}/v/${sel}/json` : `/a/${id}/json`;

  useEffect(() => {
    setError(null);
    setDoc(null);
    api.get<AgentDocument | PersonalAgentDocument>(jsonPath).then(
      (d) => {
        setDoc(d);
        document.title = pageTitle(instance, d.kind === "personal" ? d.name : `${d.name} ${d.version}`);
      },
      (e) => setError(e instanceof RequestError ? { status: e.status, message: e.message } : { status: 0, message: String(e) }),
    );
    api.get<VersionListDocument>(`/a/${id}/versions/json`).then(setVersions, () => setVersions(null));
  }, [jsonPath, id]);

  if (error) {
    const e = ERRORS[error.status] ?? { title: "Erro", text: error.message };
    return (
      <div className="container page">
        <div className="empty-state">
          <span className="status-code">{error.status || "!"}</span>
          <h1>{e.title}</h1>
          <p className="muted">{error.status === 404 ? error.message : e.text}</p>
          {versions && error.status === 404 && (
            <Link to={`/a/${id}`} className="button">
              Ver versão latest
            </Link>
          )}
        </div>
      </div>
    );
  }
  if (!doc) return <div className="container page"><div className="skeleton" /></div>;
  if (doc.kind === "personal") return <PersonalAgentView doc={doc} />;

  const floating = !sel || sel !== doc.version;
  const primaryRemote = doc.remotes[0];
  const permalink = `${location.origin}/a/${doc.id}`;

  return (
    <div className="container page">
      <div className="agent-header">
        <div className="agent-avatar" aria-hidden>
          {doc.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="agent-heading">
          <h1>{doc.name}</h1>
          {doc.handle && (
            <p className="agent-handle">
              {doc.handle}
              <CopyButton text={doc.handle} label="⧉" />
            </p>
          )}
          {doc.summary && <p className="lead">{doc.summary}</p>}
          <div className="meta-row">
            <span className="chip mono">
              {doc.id}
              <CopyButton text={doc.id} label="⧉" />
            </span>
            {doc.visibility === "unlisted" && (
              <span className="badge" title="Este agente não aparece no catálogo; só quem tem o link acessa">
                Não listado
              </span>
            )}
            <span className="muted small">por {doc.owner.displayName}</span>
            {doc.origin && (
              <a
                href={doc.origin.url}
                className="badge origin"
                title={`Agente federado: a fonte é o registry de ${doc.origin.node.name}`}
                rel="noopener"
              >
                via {doc.origin.node.name} ↗
              </a>
            )}
            <span className="muted small">publicada em {new Date(doc.publishedAt).toLocaleDateString("pt-BR")}</span>
          </div>
          {doc.tags.length > 0 && (
            <div className="tag-row">
              {doc.tags.map((t) => (
                <Link key={t} to={`/catalogo?tags=${t}`} className="badge tag">
                  {t}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="agent-actions">
          <VersionSwitcher id={doc.id} current={doc.version} requested={sel ?? LATEST} versions={versions} />
          <a className="button secondary" href={jsonPath}>
            {"{ }"} JSON
          </a>
        </div>
      </div>

      {doc.status === "yanked" && (
        <div className="alert warn">
          <strong>Versão retirada.</strong> {doc.yankedReason || "O dono retirou esta versão."}{" "}
          <Link to={`/a/${doc.id}`}>Ver a versão latest</Link>
        </div>
      )}
      {floating && doc.status !== "yanked" && (
        <div className="alert info small">
          <span>
            <code>{sel ?? LATEST}</code> resolve para <strong className="mono">{doc.version}</strong>. Para uma
            referência imutável use{" "}
            <Link to={`/a/${doc.id}/v/${doc.version}`} className="mono">
              /a/{doc.id}/v/{doc.version}
            </Link>
          </span>
        </div>
      )}

      <div className="agent-body">
        <div>
          <div className="tabs" role="tablist">
            {(
              [
                ["overview", "Visão geral"],
                ["tools", `Ferramentas (${doc.tools.length})`],
                ["endpoints", `Endpoints (${doc.remotes.length})`],
                ["json", "JSON"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} role="tab" aria-selected={tab === key} className="tab" onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>

          <div className="tab-panel">
            {tab === "overview" && (
              <article className="prose">
                <Markdown remarkPlugins={[remarkGfm]}>{doc.description}</Markdown>
              </article>
            )}
            {tab === "tools" &&
              (doc.tools.length === 0 ? (
                <p className="muted">O dono não informou o manifesto de ferramentas desta versão.</p>
              ) : (
                <ul className="tool-list">
                  {doc.tools.map((t) => (
                    <li key={t.name}>
                      <details>
                        <summary>
                          <code className="mono strong">{t.name}</code>
                          {t.description && <span className="muted small">{t.description}</span>}
                        </summary>
                        {t.inputSchema ? (
                          <pre className="schema">{JSON.stringify(t.inputSchema, null, 2)}</pre>
                        ) : (
                          <p className="muted small">Sem inputSchema informado.</p>
                        )}
                      </details>
                    </li>
                  ))}
                </ul>
              ))}
            {tab === "endpoints" && (
              <ul className="endpoint-list">
                {doc.remotes.map((r) => (
                  <li key={r.url}>
                    <span className="badge">{r.type}</span>
                    <code className="mono grow">{r.url}</code>
                    <CopyButton text={r.url} />
                  </li>
                ))}
              </ul>
            )}
            {tab === "json" && (
              <div className="code-block">
                <div className="code-block-bar">
                  <span className="mono small">GET {jsonPath}</span>
                  <CopyButton text={JSON.stringify(doc, null, 2)} />
                </div>
                <pre>{JSON.stringify(doc, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>

        <aside className="side-card">
          <h3>Conectar</h3>
          <p className="muted small">
            Autenticação: <strong>{doc.auth ? AUTH_LABELS[doc.auth] : "não informada"}</strong>
          </p>
          {primaryRemote && (
            <>
              <p className="muted small">Endpoint MCP ({primaryRemote.type})</p>
              <div className="copy-field">
                <code className="mono">{primaryRemote.url}</code>
                <CopyButton text={primaryRemote.url} />
              </div>
            </>
          )}
          <h3>Links</h3>
          <dl className="kv">
            <dt>Permalink</dt>
            <dd>
              <Link to={`/a/${doc.id}`} className="mono small">
                /a/{doc.id}
              </Link>
              <CopyButton text={permalink} label="⧉" />
            </dd>
            <dt>Esta versão</dt>
            <dd>
              <Link to={`/a/${doc.id}/v/${doc.version}`} className="mono small">
                /v/{doc.version}
              </Link>
            </dd>
            <dt>Histórico</dt>
            <dd>
              <Link to={`/a/${doc.id}/versions`} className="small">
                {versions ? `${versions.versions.length} versão(ões)` : "Versões"}
              </Link>
            </dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function VersionSwitcher({
  id,
  current,
  requested,
  versions,
}: {
  id: string;
  current: string;
  requested: string;
  versions: VersionListDocument | null;
}) {
  const navigate = useNavigate();
  // Seletores parciais (ex.: "1" ou "1.2") aparecem como opção própria, mostrando para onde resolveram.
  const partial = requested !== LATEST && requested !== current;
  return (
    <label className="select-pill">
      <span className="muted small">versão</span>
      <select
        value={requested}
        onChange={(e) => navigate(e.target.value === LATEST ? `/a/${id}` : `/a/${id}/v/${e.target.value}`)}
      >
        <option value={LATEST}>latest{versions?.latest ? ` (${versions.latest})` : ""}</option>
        {partial && (
          <option value={requested}>
            {requested} → {current}
          </option>
        )}
        {(versions?.versions ?? [{ version: current, status: "published" as const }]).map((v) => (
          <option key={v.version} value={v.version}>
            {v.version}
            {v.status === "yanked" ? " (retirada)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Agente pessoal: o agente de uma pessoa, que age por ela pelo assistente. Sem versões nem endpoint. */
function PersonalAgentView({ doc }: { doc: PersonalAgentDocument }) {
  return (
    <div className="container page">
      <div className="agent-header">
        <div className="agent-avatar personal" aria-hidden>
          {doc.owner.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="agent-heading">
          <h1>{doc.name}</h1>
          <p className="agent-handle">
            {doc.handle}
            <CopyButton text={doc.handle} label="⧉" />
          </p>
          {doc.summary && <p className="lead">{doc.summary}</p>}
          <div className="meta-row">
            <span className="badge accent">Agente pessoal</span>
            <span className="chip mono">
              {doc.id}
              <CopyButton text={doc.id} label="⧉" />
            </span>
            <span className="muted small">de {doc.owner.displayName}</span>
            <span className="muted small">desde {new Date(doc.createdAt).toLocaleDateString("pt-BR")}</span>
          </div>
        </div>
        <div className="agent-actions">
          <a href={`/a/${doc.id}/json`} className="button secondary">
            {"{ }"} JSON
          </a>
        </div>
      </div>
      <div className="panel prose personal-note">
        <p>
          Este é o agente de <strong>{doc.owner.displayName}</strong> neste registry. Ele conversa com outros agentes em
          nome dessa pessoa, pelo assistente do registry, e se apresenta como <code className="mono">{doc.handle}</code>.
          Compromissos, como pagamentos, só acontecem depois que {doc.owner.displayName} confirma.
        </p>
        <p className="muted small">
          Não tem endpoint próprio: ninguém se conecta a ele. Um agente que recebe um pedido de {doc.handle} pode conferir
          aqui (ou no <code className="mono">get_agent</code> do MCP do registry) de quem ele é.
        </p>
      </div>
    </div>
  );
}
