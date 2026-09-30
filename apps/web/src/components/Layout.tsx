import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "../auth.tsx";
import { hubHost, isNodeInstance, useInstance } from "../instance.tsx";

function Brand() {
  const instance = useInstance();
  if (isNodeInstance(instance)) {
    // Nó: identidade da empresa, com a inicial na cor da marca.
    return (
      <Link to="/" className="brand node-brand">
        <span className="brand-mark" aria-hidden>
          {instance.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="brand-text">
          <span>{instance.name}</span>
          <span className="brand-sub">Registry de agentes</span>
        </span>
      </Link>
    );
  }
  return (
    <Link to="/" className="brand">
      <img src="/favicon.svg" alt="" width={26} height={26} />
      <span>
        Agentikal <span className="brand-sub">Registry</span>
      </span>
    </Link>
  );
}

/** Selo "federado com <hub>", usado no cabeçalho e no rodapé do nó. */
export function FederationBadge({ compact = false }: { compact?: boolean }) {
  const instance = useInstance();
  const host = hubHost(instance);
  if (!host || !instance.hub) return null;
  return (
    <a
      href={instance.hub.url}
      className="federation-badge"
      title="Os agentes públicos deste registry também aparecem no catálogo do hub"
      target="_blank"
      rel="noopener"
    >
      <span className="dot-live" aria-hidden />
      {compact ? host : <>Federado com {host}</>}
    </a>
  );
}

/** Layout das páginas públicas: início, login, catálogo e páginas de agente. */
export function PublicLayout() {
  const { me } = useAuth();
  const instance = useInstance();
  const node = isNodeInstance(instance);

  return (
    <div className="public-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand />
          <nav className="topnav">
            <NavLink to="/catalogo">Catálogo</NavLink>
            {node ? (
              <>
                <a href="/#mcp">Conectar via MCP</a>
                {instance.hub && (
                  <a href={instance.hub.url} target="_blank" rel="noopener">
                    Hub ↗
                  </a>
                )}
              </>
            ) : (
              <>
                <a href="/#recursos">Recursos</a>
                <a href="/#urls">URLs</a>
                <a href="/#mcp">MCP</a>
                <a href="/#como-funciona">Como funciona</a>
              </>
            )}
          </nav>
          <div className="topbar-actions">
            {me ? (
              <Link to="/painel" className="button">
                Abrir painel
              </Link>
            ) : node ? (
              <Link to="/login" className="button secondary">
                Entrar
              </Link>
            ) : (
              <>
                <Link to="/login" className="button ghost">
                  Entrar
                </Link>
                <Link to="/login" className="button">
                  Começar
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <Brand />
          {node ? (
            <span className="footer-meta muted small">
              <FederationBadge />
              <span>Feito com Agentikal Registry</span>
            </span>
          ) : (
            <span className="muted small">IDs permanentes, versões imutáveis, JSON aberto.</span>
          )}
        </div>
      </footer>
    </div>
  );
}

/** Layout do painel (área logada), com sidebar. */
export function AppLayout() {
  const { me, logout } = useAuth();
  const instance = useInstance();
  const navigate = useNavigate();
  const node = isNodeInstance(instance);
  const initials = (me?.displayName ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav">
          <span className="side-label">{node ? instance.name : "Workspace"}</span>
          <NavLink to="/painel" end>
            <Icon d="M4 5h16M4 12h16M4 19h10" /> Agentes
          </NavLink>
          <NavLink to="/painel/novo">
            <Icon d="M12 5v14M5 12h14" /> Registrar agente
          </NavLink>
          <NavLink to="/painel/assistente">
            <Icon d="M8 10h8M8 14h5M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12Z" /> Assistente
          </NavLink>
          <span className="side-label">{node ? "Publicação" : "Recursos"}</span>
          <Link to="/catalogo">
            <Icon d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /> {node ? "Catálogo" : "Catálogo público"}
          </Link>
          <Link to="/">
            <Icon d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> {node ? "Portal" : "Site público"}
          </Link>
          {node && instance.hub && (
            <a href={instance.hub.url} target="_blank" rel="noopener">
              <Icon d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /> Hub
            </a>
          )}
        </nav>
        {node && (
          <div className="side-federation">
            <span className="side-label">Federação</span>
            <FederationBadge compact />
            {instance.nodeCode && (
              <span className="muted small">
                Código do nó <code>{instance.nodeCode}</code>
              </span>
            )}
          </div>
        )}
        <div className="side-user">
          <span className="avatar">{initials}</span>
          <div className="side-user-info">
            <strong>{me?.displayName}</strong>
            <span className="muted small">{me?.email}</span>
          </div>
          <button
            className="icon-button"
            title="Sair"
            aria-label="Sair"
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            <Icon d="M15 12H4m0 0 4-4m-4 4 4 4M13 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6" />
          </button>
        </div>
      </aside>
      <div className="app-main">
        <Outlet />
      </div>
    </div>
  );
}

export function Icon({ d }: { d: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden>
      <path d={d} />
    </svg>
  );
}
