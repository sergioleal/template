import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { Me } from "@agentikal/shared";
import { api, RequestError } from "./api.ts";

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Vai ao login do Keycloak e volta para `returnTo`. */
  login: (returnTo?: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Me>("/api/auth/me")
      .then(setMe)
      .catch((err) => {
        if (!(err instanceof RequestError && err.status === 401)) console.error(err);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((returnTo = "/painel") => {
    // Navegação de verdade (não fetch): a API redireciona para o Keycloak e, no fim, de volta para cá.
    window.location.assign(`/api/auth/login?volta=${encodeURIComponent(returnTo)}`);
  }, []);

  const logout = useCallback(async () => {
    const { logoutUrl } = await api.post<{ logoutUrl: string | null }>("/api/auth/logout");
    // Encerra também a sessão no Keycloak (senão o próximo "Entrar" entra direto). Sem mexer no estado
    // antes: a página protegida voltaria ao login e cancelaria esta navegação.
    if (logoutUrl) return window.location.assign(logoutUrl);
    setMe(null);
  }, []);

  return <AuthContext.Provider value={{ me, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted">Carregando…</p>;
  if (!me) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return children;
}
