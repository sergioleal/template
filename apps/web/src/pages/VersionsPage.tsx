import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { normalizeAgentRef, type VersionListDocument } from "@agentikal/shared";
import { api } from "../api.ts";

export function VersionsPage() {
  const id = normalizeAgentRef(useParams().id ?? "");
  const [doc, setDoc] = useState<VersionListDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<VersionListDocument>(`/a/${id}/versions/json`).then(setDoc, (e: Error) => setError(e.message));
  }, [id]);

  return (
    <div className="container page narrow-page">
      {error && (
        <div className="empty-state">
          <h1>Não encontrado</h1>
          <p className="muted">{error}</p>
        </div>
      )}
      {doc && (
        <>
          <p className="small">
            <Link to={`/a/${doc.id}`}>← {doc.name}</Link>
          </p>
          <div className="row between">
            <h1>Histórico de versões</h1>
            <a className="button secondary" href={`/a/${doc.id}/versions/json`}>
              {"{ }"} JSON
            </a>
          </div>
          <ol className="timeline">
            {doc.versions.map((v) => (
              <li key={v.version} className={v.status === "yanked" ? "yanked" : undefined}>
                <div className="row">
                  <Link to={`/a/${doc.id}/v/${v.version}`} className="mono strong">
                    {v.version}
                  </Link>
                  {v.version === doc.latest && <span className="badge accent">latest</span>}
                  {v.status === "yanked" && <span className="badge warn">retirada</span>}
                </div>
                <span className="muted small">{new Date(v.publishedAt).toLocaleString("pt-BR")}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
