import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { CatalogPage } from "@agentikal/shared";
import { api } from "../api.ts";
import { CopyButton } from "../components/CopyButton.tsx";
import { FederationBadge, Icon } from "../components/Layout.tsx";
import { hubHost, pageTitle, useInstance } from "../instance.tsx";

/** Início de um nó: portal dos agentes da empresa, sem a landing de marketing do hub. */
export function NodeHomePage() {
  const instance = useInstance();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<CatalogPage | null>(null);
  const host = hubHost(instance);
  const mcpUrl = `${location.origin}/mcp`;

  useEffect(() => {
    document.title = pageTitle(instance, "Agentes");
    api.get<CatalogPage>("/api/catalog?pageSize=6").then(setRecent, () => setRecent(null));
  }, [instance]);

  return (
    <>
      <section className="node-hero">
        <div className="container">
          <div className="node-hero-inner">
            <div>
              <span className="eyebrow">Registry de agentes</span>
              <h1>{instance.name}</h1>
              <p className="muted lead">
                Agentes MCP publicados pela {instance.name}, com ID permanente, versões e endpoints para conectar.
                {host && <> Os agentes públicos também aparecem no catálogo do hub {host}.</>}
              </p>
              <form
                className="node-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  navigate(q.trim() ? `/catalogo?q=${encodeURIComponent(q.trim())}` : "/catalogo");
                }}
              >
                <Icon d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
                <input
                  type="search"
                  aria-label="Buscar agentes"
                  placeholder={`Buscar nos agentes da ${instance.name}…`}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <button type="submit" className="button sm">
                  Buscar
                </button>
              </form>
            </div>
            <aside className="node-hero-card">
              <span className="node-hero-stat">
                <strong>{recent ? recent.total : "—"}</strong>
                <span className="muted small">agentes publicados</span>
              </span>
              <FederationBadge />
              {instance.nodeCode && (
                <span className="muted small">
                  IDs deste registry começam com <code>ZZ{instance.nodeCode}</code>
                </span>
              )}
            </aside>
          </div>
        </div>
      </section>

      <section className="section compact">
        <div className="container">
          <div className="row between section-title-row">
            <h2>Publicados recentemente</h2>
            <Link to="/catalogo">Ver todos →</Link>
          </div>
          {recent && recent.items.length === 0 && (
            <div className="empty-state panel">
              <h3>Nenhum agente publicado ainda</h3>
              <p className="muted">Entre no painel para registrar o primeiro.</p>
              <Link to="/login" className="button">
                Entrar
              </Link>
            </div>
          )}
          <ul className="catalog-grid">
            {recent?.items.map((a) => (
              <li key={a.id}>
                <Link to={`/a/${a.id}`} className="catalog-card">
                  <div className="row between">
                    <span className="mini-avatar">{a.name.slice(0, 1).toUpperCase()}</span>
                    <span className="badge accent mono">{a.latest}</span>
                  </div>
                  <h3>{a.name}</h3>
                  <p className="muted small clamp">{a.summary || "Sem resumo."}</p>
                  <div className="catalog-card-foot">
                    <span className="muted small">{a.tools.length} ferramenta(s)</span>
                    <span className="row">
                      {a.tags.slice(0, 2).map((t) => (
                        <span key={t} className="badge tag">
                          {t}
                        </span>
                      ))}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="mcp" className="section compact alt">
        <div className="container two-col">
          <div>
            <span className="eyebrow">Conectar via MCP</span>
            <h2>Descoberta pelos seus agentes</h2>
            <p className="muted">
              Este registry é um servidor MCP: adicione-o aos agentes da {instance.name} para descobrirem, em tempo de
              execução, os agentes internos com <code>search_agents</code> e <code>get_agent</code>.
            </p>
            {instance.hub && (
              <p className="muted small">
                Para buscar também agentes de outras organizações, use o MCP do hub:{" "}
                <code>{instance.hub.url}/mcp</code>
              </p>
            )}
          </div>
          <div className="code-block">
            <div className="code-block-bar">
              <span className="mono small">{mcpUrl}</span>
              <CopyButton
                text={JSON.stringify({ mcpServers: { [slug(instance.name)]: { type: "http", url: mcpUrl } } }, null, 2)}
                label="Copiar config"
              />
            </div>
            <pre>{JSON.stringify({ mcpServers: { [slug(instance.name)]: { type: "http", url: mcpUrl } } }, null, 2)}</pre>
          </div>
        </div>
      </section>
    </>
  );
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "registry";
