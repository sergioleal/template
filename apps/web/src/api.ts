import type { ApiError } from "@agentikal/shared";
import { notifyBackendDown } from "./backend-status.ts";

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

const UNAVAILABLE: ApiError = {
  error: "service_unavailable",
  message: "Serviço temporariamente indisponível. Tente novamente em alguns minutos.",
};

/** fetch que sinaliza "backend fora do ar" (falha de rede ou o 503 do Worker) para a modal global. */
async function send(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    notifyBackendDown();
    throw new RequestError(0, UNAVAILABLE);
  }
  if (res.status === 503) {
    const data = (await res.clone().json().catch(() => null)) as ApiError | null;
    if (!data || data.error === "service_unavailable") {
      notifyBackendDown();
      throw new RequestError(503, UNAVAILABLE);
    }
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(path, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new RequestError(res.status, data ?? { error: "http_error", message: `Erro ${res.status}` });
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

/**
 * POST que responde em Server-Sent Events (turnos do assistente). EventSource não aceita POST,
 * então lemos o corpo em stream e separamos os eventos "data: ...\n\n".
 */
export async function postStream<E>(path: string, body: unknown, onEvent: (e: E) => void, signal?: AbortSignal) {
  const res = await send(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new RequestError(res.status, data ?? { error: "http_error", message: `Erro ${res.status}` });
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (data) onEvent(JSON.parse(data) as E);
    }
  }
}

/** Converte um ZodError (cliente) ou issues da API em mapa campo → mensagem. */
export function issuesToMap(issues: { path: string | (string | number)[]; message: string }[] | undefined) {
  const out: Record<string, string> = {};
  for (const i of issues ?? []) {
    const key = Array.isArray(i.path) ? i.path.join(".") : i.path;
    out[key] ??= i.message;
  }
  return out;
}
