import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { OwnedAgent } from "@agentikal/shared";
import { api } from "../api.ts";
import { Icon } from "../components/Layout.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import { VisibilityBadge } from "../components/VisibilityField.tsx";
import { FederationStatusBadge, hasPendingFederation } from "../components/FederationStatusBadge.tsx";
import { hubHost, isNodeInstance, useInstance } from "../instance.tsx";

export function DashboardPage() {
  const [agents, setAgents] = useState<OwnedAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const instance = useInstance();
  const node = isNodeInstance(instance);

  useEffect(() => {
    api.get<OwnedAgent[]>("/api/agents").then(setAgents, (e: Error) => setError(e.message));
  }, []);

  // Nó: enquanto algum envio ao hub estiver pendente, recarrega para mostrar a confirmação.
  useEffect(() => {
    if (!agents || !hasPendingFederation(agents)) return;
    const t = setTimeout(() => api.get<OwnedAgent[]>("/api/agents").then(setAgents, () => {}), 2500);
    return () => clearTimeout(t);
  }, [agents]);

  const personal = agents?.find((a) => a.kind === "personal") ?? null;
  const published = useMemo(() => (agents ? agents.filter((a) => a.kind !== "personal") : null), [agents]);

  const stats = useMemo(() => {
    const all = published ?? [];
    const versions = all.flatMap((a) => a.versions);
    return {
      agents: all.length,
      public: all.filter((a) => a.visibility === "public").length,
      onHub: all.filter((a) => a.federation?.state === "synced").length,
      federationErrors: all.filter((a) => a.federation?.state === "error").length,
      versions: versions.filter((v) => v.status === "published").length,
      yanked: versions.filter((v) => v.status === "yanked").length,
    };
  }, [published]);

  const q = query.trim().toLowerCase();
  const filtered = (published ?? []).filter(
    (a) => !q || a.name.toLowerCase().includes(q) || `@${a.handle}`.includes(q) || a.id.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q),
  );

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1>Agentes</h1>
          <p className="muted">
            {node
              ? `Agentes da ${instance.name}. Os públicos são enviados automaticamente ao hub${hubHost(instance) ? ` ${hubHost(instance)}` : ""}.`
              : "Gerencie os agentes registrados na sua conta."}
          </p>
        </div>
        <Link to="/painel/novo" className="button">
          <Icon d="M12 5v14M5 12h14" /> Registrar agente
        </Link>
      </div>

      {personal && (
        <div className="panel personal-card row between">
          <div>
            <span className="muted small">Seu agente</span>
            <p className="agent-handle">@{personal.handle}</p>
            <p className="muted small">
              {personal.name}: fala com outros agentes por você no assistente, e se apresenta com este endereço.
            </p>
          </div>
          <div className="row">
            <Link to={`/painel/${personal.id}`} className="button secondary">
              Editar
            </Link>
            <Link to="/painel/assistente" className="button">
              Conversar
            </Link>
          </div>
        </div>
      )}

      <div className="stats">
        <Stat label="Agentes" value={stats.agents} />
        <Stat label="No catálogo" value={stats.public} />
        {node && <Stat label="No hub" value={stats.onHub} />}
        <Stat label="Versões publicadas" value={stats.versions} />
        <Stat label="Versões retiradas" value={stats.yanked} />
      </div>

      {error && <div className="alert warn">{error}</div>}
      {node && stats.federationErrors > 0 && (
        <div className="alert warn">
          {stats.federationErrors} agente(s) com erro no envio ao hub. Passe o mouse sobre o selo para ver o motivo.
        </div>
      )}
      {agents === null && !error && <div className="skeleton" />}

      {published?.length === 0 && (
        <div className="empty-state panel">
          <span className="feature-icon">
            <Icon d="M12 5v14M5 12h14" />
          </span>
          <h2>Nenhum agente ainda</h2>
          <p className="muted">Registre seu primeiro agente para ganhar um ID permanente e uma página pública.</p>
          <Link to="/painel/novo" className="button">
            Registrar agente
          </Link>
        </div>
      )}

      {published && published.length > 0 && (
        <div className="panel flush">
          <div className="panel-toolbar">
            <input
              className="search"
              placeholder="Buscar por nome, ID ou resumo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="muted small">{filtered.length} de {published.length}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Agente</th>
                <th className="col-id">ID</th>
                <th>Visibilidade</th>
                {node && <th>Hub</th>}
                <th>Latest</th>
                <th>Versões</th>
                <th>Atualizado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/painel/${a.id}`} className="cell-title">
                      <span className="mini-avatar">{a.name.slice(0, 1).toUpperCase()}</span>
                      <span>
                        <strong>{a.name}</strong> <span className="agent-handle small">@{a.handle}</span>
                        {a.summary && <span className="muted small block">{a.summary}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="col-id">
                    <span className="chip mono">
                      {a.id}
                      <CopyButton text={a.id} label="⧉" />
                    </span>
                  </td>
                  <td>
                    <VisibilityBadge value={a.visibility} />
                  </td>
                  {node && <td>{a.federation && <FederationStatusBadge status={a.federation} />}</td>}
                  <td>{a.latest ?<span className="badge accent mono">{a.latest}</span> : <span className="muted">—</span>}</td>
                  <td>{a.versions.length}</td>
                  <td className="muted small">{new Date(a.updatedAt).toLocaleDateString("pt-BR")}</td>
                  <td className="right">
                    <Link to={`/a/${a.id}`} className="button ghost sm">
                      Página pública ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
