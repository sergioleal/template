import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="container page">
      <div className="empty-state">
        <span className="status-code">404</span>
        <h1>Página não encontrada</h1>
        <Link to="/" className="button">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
