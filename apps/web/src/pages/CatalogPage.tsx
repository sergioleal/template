import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { CatalogPage as CatalogData } from "@agentikal/shared";
import { api } from "../api.ts";
import { Icon } from "../components/Layout.tsx";
import { hubHost, isNodeInstance, pageTitle, useInstance } from "../instance.tsx";

const PAGE_SIZE = 24;

function buildParams(q: string, tags: string[], page: number): Record<string, string> {
  return {
    ...(q ? { q } : {}),
    ...(tags.length ? { tags: tags.join(",") } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  };
}

export function CatalogPage() {
  const instance = useInstance();
  const node = isNodeInstance(instance);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const tags = (params.get("tags") ?? "").split(",").filter(Boolean);
  const tagsKey = tags.join(",");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [input, setInput] = useState(q);
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Busca com debounce, refletida na URL para links compartilháveis.
  useEffect(() => {
    const t = setTimeout(() => {
      if (input.trim() !== q) setParams(buildParams(input.trim(), tags, 1), { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [input, q, tagsKey, setParams]);

  useEffect(() => {
    document.title = pageTitle(instance, "Catálogo");
    const qs = new URLSearchParams({ q, page: String(page), pageSize: String(PAGE_SIZE) });
    if (tagsKey) qs.set("tags", tagsKey);
    let cancelled = false;
    api.get<CatalogData>(`/api/catalog?${qs}`).then(
      (d) => !cancelled && (setData(d), setError(null)),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [q, page, tagsKey, instance]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const goTo = (p: number) => setParams(buildParams(q, tags, p));
  const toggleTag = (t: string) =>
    setParams(buildParams(q, tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t], 1));

  return (
    <>
      <section className="catalog-hero">
        <div className="container">
          <span className="eyebrow">{node ? instance.name : "Catálogo público"}</span>
          <h1>{node ? "Agentes publicados" : "Explore agentes MCP"}</h1>
          <p className="muted">
            {node ? (
              <>
                Agentes públicos da {instance.name}.
                {hubHost(instance) && <> Eles também aparecem no catálogo do hub {hubHost(instance)}.</>}
              </>
            ) : (
              "Agentes que os donos marcaram como públicos. Cada um tem ID permanente, versões e endpoints prontos para conectar."
            )}
          </p>
          <label className="catalog-search">
            <Icon d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
            <input
              type="search"
              aria-label="Buscar agentes"
              placeholder="Buscar por nome, descrição ou ID…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
            />
          </label>
        </div>
      </section>

      <div className="container page">
        {error && <div className="alert warn">{error}</div>}
        {!data && !error && <div className="catalog-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton card-skeleton" />)}</div>}

        {data && (
          <>
            {tags.length > 0 && (
              <div className="tag-row active-filters">
                <span className="muted small">Filtrando por</span>
                {tags.map((t) => (
                  <button key={t} type="button" className="badge tag accent" onClick={() => toggleTag(t)}>
                    {t} ×
                  </button>
                ))}
              </div>
            )}
            <p className="muted small catalog-count">
              {data.total === 0
                ? "Nenhum agente encontrado"
                : `${data.total} agente${data.total === 1 ? "" : "s"}${q ? ` para "${q}"` : ""}`}
            </p>

            {data.total === 0 ? (
              <div className="empty-state">
                <span className="feature-icon">
                  <Icon d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
                </span>
                <h2>{q ? "Nada por aqui" : "O catálogo ainda está vazio"}</h2>
                <p className="muted">
                  {q ? "Tente outros termos de busca." : "Quando um dono marcar um agente como público, ele aparece aqui."}
                </p>
              </div>
            ) : (
              <ul className="catalog-grid">
                {data.items.map((a) => (
                  <li key={a.id}>
                    <Link to={`/a/${a.id}`} className="catalog-card">
                      <div className="row between">
                        <span className="mini-avatar">{a.name.slice(0, 1).toUpperCase()}</span>
                        <span className="badge accent mono">{a.latest}</span>
                      </div>
                      <h3>{a.name}</h3>
                      {a.handle && <span className="agent-handle small">{a.handle}</span>}
                      <p className="muted small clamp">{a.summary || "Sem resumo."}</p>
                      {a.tags.length > 0 && (
                        <div className="tag-row">
                          {a.tags.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              role="button"
                              tabIndex={0}
                              className="badge tag"
                              onClick={(e) => {
                                e.preventDefault();
                                toggleTag(t);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  toggleTag(t);
                                }
                              }}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="catalog-card-foot">
                        <span className="muted small">
                          por {a.owner.displayName}
                          {a.origin && <span className="badge origin small-badge">via {a.origin.node.name}</span>}
                        </span>
                        <span className="row">
                          {a.remoteTypes.map((t) => (
                            <span key={t} className="badge">
                              {t}
                            </span>
                          ))}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {pages > 1 && (
              <nav className="pagination" aria-label="Paginação">
                <button className="secondary" disabled={page <= 1} onClick={() => goTo(page - 1)}>
                  ← Anterior
                </button>
                <span className="muted small">
                  Página {page} de {pages}
                </span>
                <button className="secondary" disabled={page >= pages} onClick={() => goTo(page + 1)}>
                  Próxima →
                </button>
              </nav>
            )}

            <p className="muted small center catalog-api">
              Também em JSON: <a href={`/api/catalog${q ? `?q=${encodeURIComponent(q)}` : ""}`} className="mono">GET /api/catalog</a>
            </p>
          </>
        )}
      </div>
    </>
  );
}
