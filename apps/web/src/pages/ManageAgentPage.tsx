import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  formatSemVer,
  parseSemVer,
  publishVersionSchema,
  updateAgentSchema,
  type OwnedAgent,
  type Visibility,
} from "@agentikal/shared";
import { VisibilityBadge, VisibilityField } from "../components/VisibilityField.tsx";
import { FederationStatusBadge, hasPendingFederation } from "../components/FederationStatusBadge.tsx";
import { api, issuesToMap, RequestError } from "../api.ts";
import { draftToInput, examplesToText, toolsToText, VersionFields, type VersionDraft } from "../components/VersionForm.tsx";
import { TagsField } from "../components/TagsField.tsx";
import { HandleField } from "../components/HandleField.tsx";
import { CopyButton } from "../components/CopyButton.tsx";

/** Sugere o próximo patch a partir da versão mais alta, já com os endpoints e a descrição dela. */
function nextDraft(agent: OwnedAgent): VersionDraft {
  const top = agent.versions[0];
  const sv = top ? parseSemVer(top.version) : null;
  const version = sv
    ? formatSemVer(sv.prerelease ? { ...sv, prerelease: null } : { ...sv, patch: sv.patch + 1, prerelease: null })
    : "1.0.0";
  return {
    version,
    description: top?.description ?? "",
    remotes: top?.remotes.map((r) => ({ ...r })) ?? [{ type: "streamable-http", url: "" }],
    auth: top?.auth ?? null,
    toolsText: toolsToText(top?.tools ?? []),
    examplesText: examplesToText(top?.examples ?? []),
  };
}

export function ManageAgentPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<OwnedAgent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.get<OwnedAgent>(`/api/agents/${id}`).then(setAgent, (e: Error) => setLoadError(e.message));
  }, [id]);

  // Nó: depois de uma mudança, acompanha o envio ao hub até ele confirmar.
  useEffect(() => {
    if (!agent || !hasPendingFederation([agent])) return;
    const t = setTimeout(() => api.get<OwnedAgent>(`/api/agents/${agent.id}`).then(setAgent, () => {}), 2500);
    return () => clearTimeout(t);
  }, [agent]);

  if (loadError) return <p className="error">{loadError}</p>;
  if (!agent) return <p className="muted">Carregando…</p>;

  return (
    <div className="app-page stack-lg">
      <div>
        <p className="small breadcrumb">
          <Link to="/painel">Agentes</Link> <span className="muted">/</span> <span>{agent.name}</span>
        </p>
        <div className="page-header">
          <div>
            <h1>{agent.name}</h1>
            <p className="agent-handle">@{agent.handle}</p>
            <div className="meta-row">
              <span className="chip mono">
                {agent.id}
                <CopyButton text={agent.id} label="⧉" />
              </span>
              {agent.kind === "personal" && <span className="badge accent">Agente pessoal</span>}
              {agent.latest && <span className="badge accent">latest {agent.latest}</span>}
              {agent.kind !== "personal" && <VisibilityBadge value={agent.visibility} />}
              {agent.federation && <FederationStatusBadge status={agent.federation} />}
            </div>
          </div>
          <div className="row">
            <a href={`/a/${agent.id}/json`} className="button secondary">
              {"{ }"} JSON
            </a>
            <Link to={`/a/${agent.id}`} className="button">
              Página pública ↗
            </Link>
          </div>
        </div>
      </div>

      <DetailsForm agent={agent} onSaved={setAgent} />
      {agent.kind === "personal" ? (
        <p className="muted small">
          Este é o seu agente pessoal: é o assistente do painel falando com outros agentes por você. Ele não publica versões
          nem tem endpoint, fica sempre fora do catálogo e não pode ser removido.
        </p>
      ) : (
        <>
          <PublishForm key={agent.versions.length} agent={agent} onPublished={setAgent} />
          <VersionsTable agent={agent} onChanged={setAgent} />
        </>
      )}

      {agent.kind !== "personal" && (
        <div className="danger-zone">
          <h2>Remover agente</h2>
          <p className="muted small">
            O ID fica reservado para sempre e as URLs públicas passam a responder <code>410 Gone</code>.
          </p>
          <button
            className="danger"
            onClick={async () => {
              if (!window.confirm(`Remover ${agent.name} (${agent.id})? Não é possível desfazer.`)) return;
              await api.delete(`/api/agents/${agent.id}`);
              navigate("/painel");
            }}
          >
            Remover
          </button>
        </div>
      )}
    </div>
  );
}

function DetailsForm({ agent, onSaved }: { agent: OwnedAgent; onSaved: (a: OwnedAgent) => void }) {
  const personal = agent.kind === "personal";
  const [name, setName] = useState(agent.name);
  const [handle, setHandle] = useState(agent.handle);
  const [summary, setSummary] = useState(agent.summary);
  const [visibility, setVisibility] = useState<Visibility>(agent.visibility);
  const [tags, setTags] = useState<string[]>(agent.tags);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const dirty =
    name !== agent.name ||
    handle !== agent.handle ||
    summary !== agent.summary ||
    visibility !== agent.visibility ||
    tags.join(",") !== agent.tags.join(",");

  return (
    <form
      className="stack panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = updateAgentSchema.safeParse(
          personal ? { handle, summary } : { name, handle, summary, visibility, tags },
        );
        if (!parsed.success) return setErrors(issuesToMap(parsed.error.issues));
        setErrors({});
        try {
          onSaved(await api.patch<OwnedAgent>(`/api/agents/${agent.id}`, parsed.data));
          setStatus("Salvo");
        } catch (err) {
          if (err instanceof RequestError) setErrors(issuesToMap(err.body.issues));
          setStatus(err instanceof RequestError ? err.message : "Falha ao salvar");
        }
      }}
    >
      <h2>Dados do agente</h2>
      <p className="hint">Nome, endereço, resumo, tags e visibilidade valem para todas as versões e podem mudar a qualquer momento.</p>
      {/* O agente pessoal tem o mesmo nome para todo mundo; quem é quem é o endereço. */}
      {!personal && (
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          {errors.name && <span className="error">{errors.name}</span>}
        </label>
      )}
      <HandleField value={handle} onChange={setHandle} name={name} error={errors.handle} required />
      <label>
        Resumo
        <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={280} />
        {errors.summary && <span className="error">{errors.summary}</span>}
      </label>
      {!personal && <TagsField value={tags} onChange={setTags} error={errors.tags} />}
      {!personal && <VisibilityField value={visibility} onChange={setVisibility} />}
      <div className="row">
        <button type="submit" disabled={!dirty}>
          Salvar
        </button>
        {status && <span className="muted small">{status}</span>}
      </div>
    </form>
  );
}

function PublishForm({ agent, onPublished }: { agent: OwnedAgent; onPublished: (a: OwnedAgent) => void }) {
  const [draft, setDraft] = useState(() => nextDraft(agent));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="stack panel"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setFormError(null);
        const { input, toolsError } = draftToInput(draft);
        if (toolsError) return setErrors({ tools: toolsError });
        const parsed = publishVersionSchema.safeParse(input);
        if (!parsed.success) return setErrors(issuesToMap(parsed.error.issues));
        setErrors({});
        setBusy(true);
        try {
          onPublished(await api.post<OwnedAgent>(`/api/agents/${agent.id}/versions`, parsed.data));
        } catch (err) {
          if (err instanceof RequestError) {
            setErrors(issuesToMap(err.body.issues));
            setFormError(err.message);
          } else setFormError("Falha ao publicar");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Publicar nova versão</h2>
      <VersionFields value={draft} onChange={setDraft} errors={errors} />
      {formError && <p className="error">{formError}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Publicando…" : `Publicar ${draft.version || ""}`}
      </button>
    </form>
  );
}

function VersionsTable({ agent, onChanged }: { agent: OwnedAgent; onChanged: (a: OwnedAgent) => void }) {
  const toggle = async (version: string, yank: boolean) => {
    let body = {};
    if (yank) {
      const reason = window.prompt(`Motivo para retirar ${version} (opcional):`);
      if (reason === null) return;
      body = { reason };
    }
    onChanged(
      await api.post<OwnedAgent>(
        `/api/agents/${agent.id}/versions/${encodeURIComponent(version)}/${yank ? "yank" : "unyank"}`,
        body,
      ),
    );
  };

  return (
    <div className="panel">
      <h2>Versões</h2>
      <p className="hint">
        Retirar (yank) tira a versão de <code>latest</code> e dos seletores <code>x</code>/<code>x.y</code>, mas a URL
        exata continua respondendo, com aviso.
      </p>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Versão</th>
            <th>Status</th>
            <th>Publicada em</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {agent.versions.map((v) => (
            <tr key={v.version}>
              <td>
                <Link to={`/a/${agent.id}/v/${v.version}`} className="mono">
                  {v.version}
                </Link>
                {v.version === agent.latest && <span className="badge">latest</span>}
              </td>
              <td>
                {v.status === "yanked" ? (
                  <span className="badge warn" title={v.yankedReason ?? undefined}>
                    retirada
                  </span>
                ) : (
                  "publicada"
                )}
              </td>
              <td className="small">{new Date(v.publishedAt).toLocaleString("pt-BR")}</td>
              <td className="right">
                <button className="ghost small" onClick={() => toggle(v.version, v.status !== "yanked")}>
                  {v.status === "yanked" ? "Restaurar" : "Retirar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
