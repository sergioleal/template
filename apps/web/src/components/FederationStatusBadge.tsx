import type { FederationStatus } from "@agentikal/shared";

const LABELS: Record<FederationStatus["state"], { text: string; className: string; hint: string }> = {
  synced: { text: "No hub", className: "ok", hint: "O hub tem a versão atual deste agente" },
  pending: { text: "Enviando…", className: "accent", hint: "Há mudanças a enviar; o envio é automático" },
  error: { text: "Erro no envio", className: "warn", hint: "O hub recusou ou não respondeu" },
  local: { text: "Só aqui", className: "", hint: "Não listado: não é enviado ao hub" },
};

/** Situação de um agente do nó em relação ao hub. */
export function FederationStatusBadge({ status }: { status: FederationStatus }) {
  const l = LABELS[status.state];
  const when = status.lastAttemptAt ? ` · última tentativa ${new Date(status.lastAttemptAt).toLocaleString("pt-BR")}` : "";
  return (
    <span className={`badge ${l.className}`} title={`${status.error ?? l.hint}${when}`}>
      {l.text}
    </span>
  );
}

/** Enquanto houver envio pendente, vale recarregar em poucos segundos para mostrar a confirmação. */
export const hasPendingFederation = (agents: { federation?: FederationStatus }[]) =>
  agents.some((a) => a.federation?.state === "pending");
