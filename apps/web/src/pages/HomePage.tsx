import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { AGENT_ID_LENGTH, isValidAgentId, normalizeAgentId } from "@agentikal/shared";
import { useAuth } from "../auth.tsx";
import { isNodeInstance, useInstance } from "../instance.tsx";
import { NodeHomePage } from "./NodeHomePage.tsx";
import { CopyButton } from "../components/CopyButton.tsx";

const SAMPLE_ID = "ZZ4K7Q2M9XH2";

const FEATURES = [
  {
    title: "ID permanente estilo ISIN",
    text: "12 caracteres com dígito verificador. Erros de digitação são detectados antes de qualquer consulta, e o ID nunca é reutilizado.",
    icon: "M4 7h16M4 12h16M4 17h10",
  },
  {
    title: "Versionamento semântico",
    text: "Cada publicação é uma versão x.y.z imutável. Aponte para latest, para uma linha 1.x ou fixe uma versão exata.",
    icon: "M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 0c0 5-6 4-12 9",
  },
  {
    title: "Pronto para máquinas",
    text: "Toda página tem uma representação JSON em /json, com CORS aberto, cache HTTP e ETag. curl recebe JSON direto.",
    icon: "M8 7l-5 5 5 5M16 7l5 5-5 5",
  },
  {
    title: "Endpoints MCP",
    text: "Registre um ou mais endpoints (streamable-http, sse) por versão, no mesmo formato de remotes do MCP Registry.",
    icon: "M13 2 4 14h7l-1 8 9-12h-7z",
  },
  {
    title: "Retirada segura",
    text: "Retire (yank) uma versão problemática: ela sai de latest, mas quem fixou a URL exata continua vendo, com aviso.",
    icon: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  },
  {
    title: "Catálogo público opcional",
    text: "Cada conta é um tenant dono dos próprios agentes. Marque como público para entrar no catálogo, ou deixe não listado e compartilhe só o link.",
    icon: "M16 11a4 4 0 1 0-8 0m12 10a8 8 0 0 0-16 0",
  },
];

const URLS: [string, string][] = [
  [`/a/${SAMPLE_ID}`, "Página do agente na versão latest"],
  [`/a/${SAMPLE_ID}/json`, "O mesmo conteúdo em JSON"],
  [`/a/${SAMPLE_ID}/v/latest`, "Alias explícito para a última versão estável"],
  [`/a/${SAMPLE_ID}/v/1`, "Última 1.x estável"],
  [`/a/${SAMPLE_ID}/v/1.2`, "Última 1.2.x estável"],
  [`/a/${SAMPLE_ID}/v/1.2.3/json`, "Versão exata, imutável"],
  [`/a/${SAMPLE_ID}/versions`, "Histórico de versões"],
];

/** O hub mostra a landing do produto; um nó mostra o portal da empresa. */
export function HomePage() {
  return isNodeInstance(useInstance()) ? <NodeHomePage /> : <HubHomePage />;
}

function HubHomePage() {
  const { me } = useAuth();
  return (
    <>
      <section className="hero">
        <div className="hero-glow" aria-hidden />
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">Registry de agentes MCP</span>
            <h1 className="hero-title">
              Um endereço permanente para <span className="gradient-text">cada agente</span>.
            </h1>
            <p className="hero-lead">
              Registre a URL MCP do seu agente, descreva o que ele faz e receba um ID único com página pública, JSON
              para integrações e versionamento semântico.
            </p>
            <div className="hero-ctas">
              <Link to={me ? "/painel/novo" : "/login"} className="button lg">
                Registrar um agente
              </Link>
              <Link to="/catalogo" className="button lg secondary">
                Explorar catálogo
              </Link>
            </div>
            <Lookup />
          </div>
          <HeroPreview />
        </div>
      </section>

      <section id="recursos" className="section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Recursos</span>
            <h2>Feito para ser referenciado</h2>
            <p className="muted">Links que não quebram, versões que não mudam e dados que qualquer cliente lê.</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature">
                <span className="feature-icon">
                  <svg viewBox="0 0 24 24" className="icon" aria-hidden>
                    <path d={f.icon} />
                  </svg>
                </span>
                <h3>{f.title}</h3>
                <p className="muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="urls" className="section alt">
        <div className="container two-col">
          <div>
            <span className="eyebrow">Anatomia da URL</span>
            <h2>Uma URL para cada necessidade</h2>
            <p className="muted">
              URLs flutuantes (<code>latest</code>, <code>1</code>, <code>1.2</code>) acompanham novas publicações. A
              URL com a versão exata é imutável: use-a quando precisar de reprodutibilidade.
            </p>
            <div className="id-anatomy">
              <span className="seg prefix">ZZ</span>
              <span className="seg body">4K7Q2M9XH</span>
              <span className="seg check">2</span>
            </div>
            <div className="id-legend small muted">
              <span><i className="dot prefix" /> prefixo</span>
              <span><i className="dot body" /> identificador</span>
              <span><i className="dot check" /> dígito verificador</span>
            </div>
          </div>
          <div className="url-table">
            {URLS.map(([path, text]) => (
              <div key={path} className="url-row">
                <code className="mono">{path}</code>
                <span className="muted small">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ForAgents />

      <section id="como-funciona" className="section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Como funciona</span>
            <h2>Do endpoint à página pública em três passos</h2>
          </div>
          <ol className="steps">
            <li>
              <span className="step-n">1</span>
              <h3>Entre na sua conta</h3>
              <p className="muted">Contas são criadas pelo administrador; cada uma é um tenant com seus agentes.</p>
            </li>
            <li>
              <span className="step-n">2</span>
              <h3>Registre o agente</h3>
              <p className="muted">Informe nome, URL MCP, versão e uma descrição em Markdown.</p>
            </li>
            <li>
              <span className="step-n">3</span>
              <h3>Compartilhe o ID</h3>
              <p className="muted">A página e o JSON ficam no ar na hora. Publique novas versões quando quiser.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta-band">
            <div>
              <h2>Pronto para registrar seu primeiro agente?</h2>
              <p>Leva menos de um minuto.</p>
            </div>
            <Link to={me ? "/painel/novo" : "/login"} className="button lg inverse">
              {me ? "Registrar agente" : "Entrar"}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Lookup() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();
  const id = normalizeAgentId(value);
  const complete = id.length === AGENT_ID_LENGTH;
  const valid = complete && isValidAgentId(id);

  return (
    <form
      className="lookup"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) navigate(`/a/${id}`);
      }}
    >
      <label className="lookup-field" data-state={complete ? (valid ? "ok" : "bad") : undefined}>
        <span className="muted small">/a/</span>
        <input
          aria-label="ID do agente"
          placeholder="Tem um ID? Cole aqui"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20}
          spellCheck={false}
          autoCapitalize="characters"
          className="mono"
        />
        <button type="submit" className="button sm" disabled={!valid}>
          Abrir
        </button>
      </label>
      <p className="small lookup-hint" aria-live="polite">
        {complete && !valid && <span className="error">Dígito verificador não confere. Confira o ID.</span>}
      </p>
    </form>
  );
}

function HeroPreview() {
  return (
    <div className="hero-preview" aria-hidden>
      <div className="window">
        <div className="window-bar">
          <i />
          <i />
          <i />
          <span className="mono small">GET /a/{SAMPLE_ID}/json</span>
        </div>
        <pre className="window-code">
          <span className="t-p">{"{"}</span>
          {"\n  "}
          <span className="t-k">"id"</span>: <span className="t-s">"{SAMPLE_ID}"</span>,{"\n  "}
          <span className="t-k">"name"</span>: <span className="t-s">"Assistente de Chamados"</span>,{"\n  "}
          <span className="t-k">"version"</span>: <span className="t-s">"1.4.2"</span>,{"\n  "}
          <span className="t-k">"requested"</span>: <span className="t-s">"latest"</span>,{"\n  "}
          <span className="t-k">"status"</span>: <span className="t-s">"published"</span>,{"\n  "}
          <span className="t-k">"remotes"</span>: [{"\n    "}
          {"{ "}
          <span className="t-k">"type"</span>: <span className="t-s">"streamable-http"</span>,{"\n      "}
          <span className="t-k">"url"</span>: <span className="t-s">"https://chamados.exemplo.br/mcp"</span>
          {" }"}
          {"\n  "}],{"\n  "}
          <span className="t-k">"links"</span>: {"{ "}
          <span className="t-k">"versions"</span>: <span className="t-s">"…/versions/json"</span>
          {" }"}
          {"\n"}
          <span className="t-p">{"}"}</span>
        </pre>
      </div>
      <div className="floating-card">
        <span className="badge accent">latest</span>
        <strong>1.4.2</strong>
        <span className="muted small">publicada há 2 dias</span>
      </div>
    </div>
  );
}

/** Seção para quem integra agentes: o registry como servidor MCP. */
function ForAgents() {
  const mcpUrl = `${location.origin}/mcp`;
  const config = JSON.stringify({ mcpServers: { "agentikal-registry": { type: "http", url: mcpUrl } } }, null, 2);
  return (
    <section id="mcp" className="section">
      <div className="container two-col">
        <div>
          <span className="eyebrow">Para agentes</span>
          <h2>O registry também é um servidor MCP</h2>
          <p className="muted">
            Adicione o registry ao seu agente e ele descobre, em tempo de execução, com quem precisa falar: descreve a
            necessidade em linguagem natural, recebe os candidatos com ferramentas e endpoints, e conecta direto.
          </p>
          <ul className="mcp-tools">
            <li>
              <code>search_agents</code>
              <span className="muted small">busca por intenção, com filtros de tag, transporte e autenticação</span>
            </li>
            <li>
              <code>get_agent</code>
              <span className="muted small">endpoints, autenticação e ferramentas com inputSchema</span>
            </li>
            <li>
              <code>list_versions</code>
              <span className="muted small">histórico, para fixar uma versão exata</span>
            </li>
          </ul>
        </div>
        <div className="code-block">
          <div className="code-block-bar">
            <span className="mono small">{mcpUrl}</span>
            <CopyButton text={config} label="Copiar config" />
          </div>
          <pre>{config}</pre>
        </div>
      </div>
    </section>
  );
}
