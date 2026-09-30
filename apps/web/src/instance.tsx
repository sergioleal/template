import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { InstanceInfo } from "@agentikal/shared";
import { api } from "./api.ts";
import { notifyBackendDown, onBackendDown } from "./backend-status.ts";

const CACHE_KEY = "registry.instance";
const FALLBACK: InstanceInfo = { mode: "hub", name: "Agentikal Registry", brandColor: null, nodeCode: null, hub: null };

const InstanceContext = createContext<InstanceInfo | null>(null);

/** Aplica a cor da marca: as demais cores de destaque derivam dela. */
function applyBrand(info: InstanceInfo) {
  const root = document.documentElement;
  root.dataset.mode = info.mode;
  if (!info.brandColor) return;
  const c = info.brandColor;
  root.style.setProperty("--accent", c);
  root.style.setProperty("--accent-hover", `color-mix(in srgb, ${c} 82%, black)`);
  root.style.setProperty("--accent-soft", `color-mix(in srgb, ${c} 12%, var(--surface))`);
  root.style.setProperty("--accent-text", `color-mix(in srgb, ${c} 70%, var(--text))`);
}

function readCache(): InstanceInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as InstanceInfo) : null;
  } catch {
    return null;
  }
}

function writeCache(info: InstanceInfo) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(info));
  } catch {
    /* armazenamento indisponível: só perdemos o cache */
  }
}

/**
 * Carrega /api/instance antes de renderizar (um nó nunca aparece com a identidade do hub). Se o
 * backend estiver fora, a aplicação renderiza mesmo assim — com a identidade da última visita, ou a
 * padrão — e a modal de serviço indisponível aparece por cima; a pessoa pode fechá-la e continuar.
 */
export function InstanceProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<InstanceInfo | null>(null);

  useEffect(() => {
    api.get<InstanceInfo>("/api/instance").then(
      (i) => {
        applyBrand(i);
        writeCache(i);
        setInfo(i);
      },
      () => {
        const cached = readCache() ?? FALLBACK;
        applyBrand(cached);
        setInfo(cached);
        notifyBackendDown();
      },
    );
  }, []);

  if (!info) return null;
  return (
    <InstanceContext.Provider value={info}>
      {children}
      <ServiceStatus />
    </InstanceContext.Provider>
  );
}

const RETRY_MS = 15_000;
type Status = "ok" | "modal" | "banner" | "recovered";

/**
 * Estado do backend para o usuário: modal quando cai (fechável), faixa discreta enquanto continua
 * fora e um aviso quando volta. Verifica sozinho a cada 15 s enquanto estiver fora.
 */
function ServiceStatus() {
  const [status, setStatus] = useState<Status>("ok");
  const [checking, setChecking] = useState(false);
  const statusRef = useRef<Status>("ok");
  statusRef.current = status;

  useEffect(
    () =>
      onBackendDown(() => {
        // Só abre a modal no começo de uma queda; se a pessoa já a fechou, fica a faixa.
        if (statusRef.current === "ok" || statusRef.current === "recovered") setStatus("modal");
      }),
    [],
  );

  const check = useCallback(async () => {
    setChecking(true);
    try {
      // fetch direto: esta verificação não deve disparar o aviso de novo.
      const r = await fetch("/api/instance", { headers: { accept: "application/json" }, cache: "no-store" });
      if (r.ok) setStatus("recovered");
    } catch {
      /* ainda fora */
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "modal" && status !== "banner") return;
    const t = setInterval(check, RETRY_MS);
    return () => clearInterval(t);
  }, [status, check]);

  useEffect(() => {
    if (status !== "recovered") return;
    const t = setTimeout(() => setStatus("ok"), 10_000);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (status !== "modal") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setStatus("banner");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status]);

  if (status === "modal") {
    return (
      <div className="svc-backdrop" onClick={() => setStatus("banner")}>
        <div
          className="svc-modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="svc-title"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="svc-icon" aria-hidden>
            !
          </span>
          <h2 id="svc-title">Serviço temporariamente indisponível</h2>
          <p className="muted">
            Não conseguimos falar com o servidor agora. Você pode continuar navegando; algumas informações podem não
            carregar até a conexão voltar. Tentamos de novo automaticamente.
          </p>
          <div className="svc-actions">
            <button type="button" className="secondary" onClick={() => void check()} disabled={checking}>
              {checking ? "Verificando…" : "Tentar agora"}
            </button>
            <button type="button" onClick={() => setStatus("banner")} autoFocus>
              Continuar navegando
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (status === "banner") {
    return (
      <div className="svc-banner" role="status">
        <span className="svc-dot" aria-hidden />
        Serviço indisponível · reconectando…
        <button type="button" className="ghost small" onClick={() => void check()} disabled={checking}>
          {checking ? "Verificando…" : "Tentar agora"}
        </button>
      </div>
    );
  }
  if (status === "recovered") {
    return (
      <div className="svc-banner ok" role="status">
        Conexão restabelecida.
        <button type="button" className="ghost small" onClick={() => location.reload()}>
          Recarregar página
        </button>
        <button type="button" className="ghost small" aria-label="Fechar aviso" onClick={() => setStatus("ok")}>
          ×
        </button>
      </div>
    );
  }
  return null;
}

export function useInstance(): InstanceInfo {
  const ctx = useContext(InstanceContext);
  if (!ctx) throw new Error("useInstance fora do InstanceProvider");
  return ctx;
}

export const isNodeInstance = (i: InstanceInfo) => i.mode === "node";

/** Host do hub para exibição ("hub.exemplo.org"). */
export const hubHost = (i: InstanceInfo) => (i.hub ? new URL(i.hub.url).host : null);

export const pageTitle = (i: InstanceInfo, ...parts: string[]) => [...parts, i.name].join(" · ");
