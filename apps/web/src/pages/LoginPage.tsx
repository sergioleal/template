import { useEffect } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { useAuth } from "../auth.tsx";
import { isNodeInstance, useInstance } from "../instance.tsx";

/**
 * Entrada no painel. As contas ficam no Keycloak (um realm por instância, cadastro fechado): o botão
 * leva à tela de login de lá, e a API abre a sessão na volta. Vindo de uma página protegida, segue direto.
 */
export function LoginPage() {
  const { me, login } = useAuth();
  const instance = useInstance();
  const node = isNodeInstance(instance);
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [params] = useSearchParams();
  const error = params.get("erro");

  useEffect(() => {
    // Sem erro para mostrar e vindo de uma página que exige login: vai direto ao Keycloak.
    if (!me && from && !error) login(from);
  }, [me, from, error, login]);

  if (me) return <Navigate to={from ?? "/painel"} replace />;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        {node ? (
          <span className="brand-mark lg" aria-hidden>
            {instance.name.slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <img src="/favicon.svg" alt="" width={40} height={40} />
        )}
        <h1>{node ? instance.name : "Entrar no Registry"}</h1>
        <p className="muted small">Acesse o painel para registrar e versionar seus agentes.</p>
        {error && <div className="alert warn small">{error}</div>}
        <button type="button" className="button block" onClick={() => login(from ?? "/painel")}>
          {from && !error ? "Redirecionando…" : "Entrar"}
        </button>
        <p className="muted small center">
          {node
            ? `Contas são criadas pelo administrador do registry da ${instance.name}.`
            : "O cadastro é fechado. Peça uma conta ao administrador do registry."}
        </p>
      </div>
    </div>
  );
}
